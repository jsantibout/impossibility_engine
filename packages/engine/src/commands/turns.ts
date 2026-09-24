/**
 * The turn boundary, and everything it collects.
 *
 * A turn ending is not one thing. It raises the repeat saves its effects owe,
 * the area effects a persistent spell is due, the damage something scheduled
 * for this moment, and a death save. Raising is derived, because nobody
 * decides that a turn ended; rolling is commanded, because the reducer cannot
 * roll.
 *
 * `settleAreaEffects` is here rather than in `spell-resolution.ts` because
 * it is the settlement of a debt the *turn* raised, and three different
 * operations reach it — a boundary, a creature's own move, and an area that
 * arrived somewhere.
 */

import {
  type Ability,
  type CharacterId,
  type ConditionName,
  err,
  ok,
  type Result,
  type RollMode,
  type Skill,
} from '@ie/shared';
import { type Bonus, type ModeSource } from '../bonuses.js';
import { type D20TestResult, rollAbilityCheck, rollSavingThrow } from '../checks.js';
import { currentCombatant, extraActionsOwedAtTurnStart, spendAction } from '../combat.js';
import { type CheckContext } from '../conditions.js';
import { isDue, timeView, type TurnMoment } from '../time.js';
import {
  mayAttempt,
  pendingSaveKey,
  type GrantedPayout,
  type PendingSave,
  type ScheduledDamage,
} from '../timers.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { RECHARGE_DIE, rechargeMade, rechargeOfLine } from '../monster.js';
import { rollRecorded } from '../rolls.js';
import { needsCasterSheet, statedChoice, statedDamageType } from '../spell-definitions.js';
import {
  type AreaMoment,
  castingIdOf,
  castingNumber,
  type OwedAreaEffect,
  spellOfSource,
} from '../spells.js';
import { actionRulesOn, effectiveConditions, rollModesFor, sheetAsItStands } from '../standing.js';
import { healingRuleOf, isDown, maximisedHealing, rollDeathSave } from '../vitals.js';
import { type Supply } from './casting.js';
import { type DamageComponent } from '../attack.js';
import { creatureOf, unknownCreature, ZERO_HIT_POINTS } from './command.js';
import { grantTemporaryHpTo, healCreature, strandedSummons } from './creatures.js';
import { dealSpellDamage } from './damage.js';
import { mayAct, pendingCastingsOf, pendingSavesOf } from './holds.js';
import {
  checkBonuses,
  recordD20Test,
  rollSpellDice,
  savingSupport,
  spentRollModifiers,
} from './rolls.js';
import { resolveEffects } from './spell-resolution.js';
import { type SpellTargetOutcome } from './targeting.js';
import { grapplerOf, grapplesOn, attachmentsOf } from './unarmed.js';
import { attachedTo } from '../state.js';

/** One turn-boundary save, rolled and settled. */
export interface ResolvedRepeatSave {
  readonly effectKey: string;
  readonly target: CharacterId;
  readonly ability: Ability;
  readonly dc: number;
  readonly label: string;
  readonly save: D20TestResult;
  readonly success: boolean;
}

export interface TurnResolution {
  readonly events: readonly GameEvent[];
  /** Saves rolled here. Empty when none were owed, or none could be rolled. */
  readonly saves: readonly ResolvedRepeatSave[];
  /** Saves left outstanding, because no generator was supplied. */
  readonly pending: readonly PendingSave[];
  /**
   * True when this command id had already been applied.
   *
   * **Two commands share this shape**, and the distinction matters to a
   * caller: `resolveTurn` had already advanced the turn, and
   * `resolvePendingSaves` had already rolled the saves it was sent for. In
   * both cases no events come back, and in neither does that mean the world
   * owes nothing — a retry that lands three boundaries later is looking at a
   * world owing the *next* save, which is why `pending` is reported beside
   * this rather than emptied along with `events`.
   */
  readonly duplicate?: boolean;
}

/**
 * Every scheduled hit whose moment has arrived, in a stable order.
 *
 * A query, so a caller may look before advancing. Due-ness is a function of
 * the turn counts alone: a schedule whose anchor has left the fight is never
 * due, and a derived pass drops it — the moment did not arrive, so the damage
 * is forgiven rather than collected.
 */
export function dueDamageOf(state: GameState): readonly (ScheduledDamage & { readonly key: string })[] {
  const view = timeView(state);
  return Object.keys(state.scheduledDamage)
    .sort()
    .flatMap((key) => {
      const scheduled = state.scheduledDamage[key];
      if (scheduled === undefined || !isDue(view, scheduled.deadline)) return [];
      return [{ ...scheduled, key }];
    });
}

/**
 * Roll and apply every scheduled hit that has fallen due.
 *
 * The damage arrives as ordinary `damage-taken` events through the same
 * `dealSpellDamage` every spell uses, so the target's Resistance, its
 * Temporary Hit Points, its Concentration save and its dropping to 0 all
 * behave exactly as they would from any other source. The only extra event is
 * the one that clears the debt.
 */
function collectDueDamage(
  state: GameState,
  supply: Supply,
): Result<readonly GameEvent[]> {
  const due = dueDamageOf(state);
  if (due.length === 0) return ok([]);

  const events: GameEvent[] = [];
  let current = state;

  for (const scheduled of due) {
    const victim = current.creatures[scheduled.target];
    // Gone from the game entirely — not merely out of the fight, which the
    // derived pass already forgave. Nothing to hurt, so clear the debt.
    if (victim === undefined) {
      const cleared: GameEvent = { type: 'scheduled-damage-collected', key: scheduled.key };
      events.push(cleared);
      current = applyEvent(current, cleared);
      continue;
    }

    // The sheet contributes nothing: `rollSpellDice` keeps only the components
    // whose source is the spell, and the delayed hit is flat dice with no
    // ability modifier. The victim's own is used because the caster may be
    // dead by now — Acid Arrow is Instantaneous and the acid does not care.
    const rolled = rollSpellDice(
      supply,
      victim.sheet,
      scheduled.label,
      scheduled.damageType,
      scheduled.notation,
    );
    if (!rolled.ok) return rolled;

    const hurt = dealSpellDamage(current, scheduled.target, rolled.value, scheduled.label, supply, {
      by: scheduled.by,
    });
    if (!hurt.ok) return hurt;

    // Cleared first, so the log reads as the debt being settled and then the
    // damage landing — and so a `damage-taken` that drops the target cannot
    // leave the schedule behind if anything later throws.
    const cleared: GameEvent = { type: 'scheduled-damage-collected', key: scheduled.key };
    events.push(cleared, ...hurt.value.events);
    current = [cleared, ...hurt.value.events].reduce(applyEvent, current);
  }

  return ok(events);
}

/** One creature's payout, and the arrangement that owes it. */
interface DuePayout {
  readonly target: CharacterId;
  /**
   * Whose boundary this fell due at, which is the creature the arrangement is
   * on — and, where {@link GrantedPayout.to} names somebody else, the one
   * dealing the damage. SRD Stirge is drinking, and a blow with no dealer is a
   * blow nothing can answer or attribute.
   */
  readonly holder: CharacterId;
  readonly payout: GrantedPayout;
}

/**
 * What a creature's own boundary hands it, read off the arrangements it holds.
 *
 * SRD Heroism: "gains Temporary Hit Points equal to your spellcasting ability
 * modifier **at the start of each of its turns**." The recipient's boundary and
 * nobody else's, which is why this takes one creature rather than walking the
 * ongoing castings: the question a boundary asks is about whoever is starting
 * or finishing a turn.
 *
 * **Read at settlement, not at the moment.** A casting that ended earlier in
 * this same boundary — a scheduled hit that broke its Concentration, an area
 * effect that dropped its caster — has already taken its grant back, and the
 * creature is owed nothing by a spell that is over. That is the same answer
 * `settleAreaEffects` gives for a debt whose casting has gone, arrived at
 * without a debt to forgive.
 *
 * A dead recipient is skipped rather than refused: they take no turns, and a
 * boundary that threw would wedge the fight over a sentence about Temporary
 * Hit Points.
 *
 * **`who` is optional because either half of a boundary can be nobody's.** The
 * beginning of a turn can be: the boundary's own settlements can end the
 * fight, and a fight that has ended has no turn beginning for anything to be
 * due at. The *ending* can be too, and at exactly one moment — the boundary a
 * fight opens on, where the first combatant's turn starts and no turn has
 * finished for an end-of-turn payout to fall due at.
 */
function payoutsAt(
  state: GameState,
  who: CharacterId | undefined,
  at: TurnMoment,
): readonly DuePayout[] {
  if (who === undefined) return [];
  const creature = state.creatures[who];
  if (creature === undefined || creature.vitals.dead) return [];
  return creature.payouts
    .filter((payout) => payout.at === at && holdStillStands(state, who, payout.source))
    // **Whose boundary and who pays are two roles**, and a printed hold is the
    // first sentence that puts them on two creatures: SRD Stirge collects at
    // its own turn and the damage lands on whoever it is drinking from. See
    // {@link GrantedPayout.to}.
    .map((payout) => ({ target: payout.to ?? who, holder: who, payout }));
}

/**
 * Whether a payout filed under a **hold** is still owed.
 *
 * SRD Animated Rug of Smothering pays out "until the grapple ends", and a
 * grapple ends by a rule the fold cannot raise — a successful escape lifts the
 * Grappled instance and nothing releases what the hold hung beside it. That is
 * the same absence `lapsedGrapples` is about, and the same answer `carrying`
 * gives a conjured item whose casting ran out: **the lifetime is derived
 * rather than folded**, read off the source at the moment the boundary looks.
 *
 * Read off the source, because that is where every other reader of a hold
 * reads it: `grapplesOn`, `lapsedGrapples` and `escapeGrapple` all find one by
 * the `grapple:<who>` its instance is filed under, and an attach by
 * `attach:<who>`. A source naming neither is not a hold and is always owed.
 */
function holdStillStands(state: GameState, holder: CharacterId, source: string): boolean {
  const grappler = grapplerOf(source);
  if (grappler !== null) {
    // The ordinary form: the arrangement is on the creature being held, which
    // is what SRD's "each of its turns" names. The other way round — a line
    // collecting at the grappler's own boundary — is a hold that stands while
    // that creature is holding anybody, because the source names the grappler
    // and not the other end.
    if (holder === grappler) {
      return Object.keys(state.creatures).some((who) =>
        grapplesOn(state, who as CharacterId).some((held) => held.grappler === grappler),
      );
    }
    return grapplesOn(state, holder).some((held) => held.grappler === grappler);
  }
  const other = attachedTo(source);
  if (other === null) return true;
  // Either end of the attach may be holding the arrangement — the Stirge's is
  // on the stirge and a line that wrote it the other way round would put it on
  // the target — so the question is whether the pair is still attached at all.
  return (
    attachmentsOf(state, holder).some((one) => one.to === other) ||
    attachmentsOf(state, other).some((one) => one.to === holder)
  );
}

/**
 * Everything this boundary hands over: the finishing creature's end, then the
 * beginning creature's start.
 *
 * The same order `settleAreaEffects` settles its own two moments in, and for
 * the same reason — they are a round apart, and one `turn-advanced` raises
 * both.
 */
function payoutsDue(
  state: GameState,
  ended: CharacterId | undefined,
  begun: CharacterId | undefined,
): readonly DuePayout[] {
  return [...payoutsAt(state, ended, 'end-of-turn'), ...payoutsAt(state, begun, 'start-of-turn')];
}

/**
 * Hand over what the boundary owes, through the doors every other spell uses.
 *
 * `grantTemporaryHpTo`, `healCreature` and `dealSpellDamage` — so a payout of
 * damage meets the target's Resistance, puts their Concentration at risk and
 * drops them to 0 exactly as any other damage would, and a payout of healing
 * caps at the maximum and lifts the unconsciousness that having no hit points
 * caused. There is no second hit-point calculator here.
 *
 * **The die is thrown at the boundary**, not at the cast: a payout that repeats
 * throws a new one each turn, and the notation is what the grant carries. The
 * *recipient's* sheet is handed to `rollSpellDice` for the reason a scheduled
 * hit's is — the components kept are the ones whose source is the spell, and
 * the caster may be dead by now — so the sheet contributes nothing and the
 * roll cannot fail for want of a caster.
 */
function settleTurnPayouts(
  state: GameState,
  supply: Supply,
  due: readonly DuePayout[],
): Result<readonly GameEvent[]> {
  const events: GameEvent[] = [];
  let current = state;
  // **Where the generator stood before this boundary threw anything**, read
  // once and written back once at the end — `forcePrintedSave`'s shape, and
  // for its reason: everything below draws from one generator and a single
  // `rolls-issued` covers the lot.
  //
  // The bracket encloses the whole loop rather than the branch that rolls the
  // payout's own dice, because that branch is not the only thing here that
  // turns it: `dealSpellDamage` makes the Concentration save a hit provokes,
  // so a payout carrying nothing but a flat number can still move the stream.
  const issuedBefore = supply.issuer.count;

  for (const { target, holder, payout } of due) {
    const recipient = current.creatures[target];
    // Settling an earlier payout can kill the creature the next one is for —
    // one fight, one combatant, a curse that drops them — so this is re-read
    // each pass rather than taken from the list.
    if (recipient === undefined || recipient.vitals.dead) continue;

    const label = spellOfSource(payout.source);
    // The same three words `resolveHealEffect` and `resolveTempHpEffect` label
    // their own rolls with, so one spell reads the same in the log whether the
    // dice were thrown at the cast or at a boundary.
    const type =
      payout.damageType ?? (payout.payout === 'healing' ? 'healing' : 'temporary');

    let rolled = payout.flat;
    let components: readonly DamageComponent[] = [];
    if (payout.dice !== undefined) {
      // **And what the recipient's own running effects say about the dice**,
      // where what is being handed over is hit points. SRD Beacon of Hope
      // maximises "any healing", and a Regenerate paying out at the start of a
      // turn is healing arriving a minute after the cast that arranged it —
      // the case the phrase is about. A payout of damage or of Temporary Hit
      // Points reads nothing: neither is regaining hit points.
      const maximise =
        payout.payout === 'healing' && healingRuleOf(recipient.healingRules) === 'maximised'
          ? [maximisedHealing('the maximum possible')]
          : [];
      const dice = rollSpellDice(supply, recipient.sheet, label, type, payout.dice, maximise);
      if (!dice.ok) return dice;
      components = dice.value;
      rolled += components.reduce((sum, component) => sum + component.total, 0);
    }
    if (rolled <= 0) continue;

    if (payout.payout === 'damage') {
      const whole: readonly DamageComponent[] =
        payout.flat === 0
          ? components
          : [...components, { source: label, type, roll: null, flat: payout.flat, total: payout.flat }];
      // The caster is named so the hit can be answered and attributed, and is
      // omitted rather than guessed at when the casting has outlived them.
      const castingId = castingIdOf(payout.source);
      // A casting names its caster; a printed hold names nobody, and the
      // creature whose boundary this is *is* the one dealing it — SRD Stirge
      // drinks at the start of its own turn. Where the two are the same
      // creature there is nothing to attribute and the field stays empty, as
      // it always has for a payout that lands on its own holder.
      const by =
        castingId === null
          ? payout.to === undefined
            ? undefined
            : holder
          : current.ongoing[castingId]?.caster;
      const hurt = dealSpellDamage(current, target, whole, label, supply, {
        ...(by === undefined ? {} : { by: by as CharacterId }),
      });
      if (!hurt.ok) return hurt;
      events.push(...hurt.value.events);
      current = hurt.value.events.reduce(applyEvent, current);
      continue;
    }

    const paid =
      payout.payout === 'healing'
        ? healCreature(current, target, rolled)
        : grantTemporaryHpTo(current, target, rolled);
    if (!paid.ok) return paid;
    events.push(...paid.value);
    current = paid.value.reduce(applyEvent, current);
  }

  // A log that does not say how far the generator moved is a log that rewinds
  // on replay: a session resumed from it rebuilds the stream from where the
  // last record left it, and the next command draws the same faces under the
  // same roll ids. **No log carries this hole**, because no SRD payout throws
  // dice — every one of them hands over a printed number or an ability
  // modifier — so this is a determinism defect fixed and not a migration.
  if (supply.issuer.count > issuedBefore) {
    events.push({
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    });
  }

  return ok(events);
}

/**
 * What a turn boundary owes in payouts, paid or refused — the whole of it, so
 * that every boundary answers the same way.
 *
 * Two boundaries reach it. `resolveTurn` is the ordinary one: a turn ends, the
 * next begins, and both halves may be owed something. `beginCombat` is the
 * other, and it is a boundary for the same reason `startCombat` has said in a
 * comment since the beginning — "the first combatant's turn starts with the
 * fight". Nothing has ended there, so it passes no creature for the end.
 *
 * **The `Supply` is optional and the refusal is the alternative to it.** A
 * payout is not a debt in state — see {@link GrantedPayout} — because the
 * boundary reads the arrangement off the creature and settles it in one
 * breath; so a boundary that cannot settle one must not pass it, and there is
 * nowhere to leave it for later. Both boundaries therefore refuse with
 * `payout_owed` rather than advancing quietly past a sentence of the SRD's,
 * and a caller with a payout in the room supplies the generator and asks
 * again. A boundary that owes nothing needs nothing, which is why both may be
 * called with no `Supply` at all.
 */
export function settleBoundaryPayouts(
  state: GameState,
  supply: Supply | undefined,
  ended: CharacterId | undefined,
  begun: CharacterId | undefined,
): Result<readonly GameEvent[]> {
  const due = payoutsDue(state, ended, begun);
  if (due.length === 0) return ok([]);

  if (supply === undefined) {
    return err(
      'payout_owed',
      `${due.length} payout(s) fall due at this boundary; advancing needs a generator to settle them`,
    );
  }

  return settleTurnPayouts(state, supply, due);
}

/**
 * The d6 the start of a creature's turn owes each of its expended lines.
 *
 * SRD *Monsters*: "Recharge X–Y ... At the start of each of the monster's
 * turns, roll 1d6. If the roll is within the number range given in the
 * notation, the monster regains the use of that part." So the die belongs to
 * the *line*, one per expended line, and a creature holding two rolls twice.
 *
 * **The order is the expended list's, which is sorted**, so two replays of one
 * log throw the same dice in the same order at the same creature.
 *
 * **Nothing is rolled for a line whose notation names no die.** The book's
 * other notation is a rest and only a rest; a boundary that threw a die for it
 * would move the generator for a recovery that could not happen, which is the
 * quiet way a replay stops matching — the same rule `declareDawn` states about
 * a pool with nothing spent.
 *
 * A line the sheet no longer prints is skipped rather than refused: the
 * expended state is a list of names and a sheet can be restated, and a
 * boundary is the wrong place to stop a fight over one.
 *
 * **Exported for the two boundaries that raise a turn's beginning** —
 * `resolveTurn` and the fight opening in `beginCombat` — so a creature whose
 * breath weapon is spent gets its die at both rather than only at the one
 * somebody remembered. That is the argument `settleBoundaryPayouts` makes about
 * itself, and this is the same moment by the same two doors.
 */
export function settleStartOfTurnRecharges(
  state: GameState,
  supply: Supply | undefined,
  begun: CharacterId | undefined,
): Result<readonly GameEvent[]> {
  if (begun === undefined) return ok([]);
  const creature = state.creatures[begun];
  if (creature === undefined || creature.vitals.dead) return ok([]);

  const due = creature.expendedLines.filter((line) => {
    const recharge = rechargeOfLine(creature.sheet, line);
    return recharge !== null && recharge.kind === 'die';
  });
  if (due.length === 0) return ok([]);

  if (supply === undefined) {
    return err(
      'recharge_owed',
      `${begun} starts its turn owing ${due.length} recharge roll(s); advancing needs a generator to throw them`,
    );
  }

  const events: GameEvent[] = [];
  for (const line of due) {
    const recharge = rechargeOfLine(creature.sheet, line);
    if (recharge === null) continue;
    const issuedBefore = supply.issuer.count;
    const rolled = rollRecorded(supply.issuer, supply.rng, RECHARGE_DIE);
    if (!rolled.ok) return rolled;
    const made = rechargeMade(recharge, rolled.value.total);
    events.push(
      {
        type: 'roll-recorded',
        who: begun,
        // The line's own heading, which is the string the block prints and the
        // one the refusal and the log already use.
        label: `${line} recharge (${RECHARGE_DIE})`,
        natural: rolled.value.total,
        total: rolled.value.total,
        contributions: [],
        outcome: made ? 'back' : 'still spent',
      },
      {
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      },
      // A die that missed is a roll and nothing else: the line is where it
      // was, and the log holds the throw that left it there.
      ...(made ? [{ type: 'printed-line-recharged' as const, id: begun, line }] : []),
    );
  }

  return ok(events);
}

/**
 * The extra actions the start of a creature's turn is owed by a running
 * effect.
 *
 * SRD Haste: "it gains an additional action **on each of its turns**." The
 * rule stands on the creature — the ninth sourced grant, hung and released
 * like every other — and the budget it feeds is the turn's, which only a
 * combat event writes. So this is the seam where the two meet, and it is a
 * command's rather than the fold's for that reason alone: `fold/combat.ts`
 * folds a budget through `must(event, grantTurnBudget(...))`, and a derived
 * pass that wrote one would be writing the event rather than applying it.
 *
 * **One a turn and never two.** `beginTurn` hands the creature a fresh budget,
 * so an extra action nobody spent goes with the turn it was granted for; there
 * is nothing to de-duplicate against and nothing accumulates.
 *
 * **Nothing is rolled and nothing can refuse**, which is why it takes no
 * `Supply` and returns no debt: the only refusal `grantTurnBudget` has is
 * about whose turn it is, and this is called with the creature whose turn has
 * just begun. A dead creature is skipped rather than refused, on
 * {@link settleStartOfTurnRecharges}' rule about a sheet that has moved on.
 *
 * **Exported for the two boundaries that raise a turn's beginning** —
 * `resolveTurn` and the fight opening in `beginCombat` — so a hasted creature
 * that a fight starts on gets its action at both rather than only at the one
 * somebody remembered. That is the argument `settleBoundaryPayouts` and
 * `settleStartOfTurnRecharges` both make about themselves.
 */
export function settleStartOfTurnGrants(
  state: GameState,
  begun: CharacterId | undefined,
): readonly GameEvent[] {
  if (begun === undefined) return [];
  const creature = state.creatures[begun];
  if (creature === undefined || creature.vitals.dead) return [];

  return extraActionsOwedAtTurnStart(actionRulesOn(state, begun)).map((action) => ({
    type: 'turn-budget-granted',
    id: begun,
    source: action.source,
    action: {
      ...(action.except === undefined ? {} : { except: action.except }),
      ...(action.only === undefined ? {} : { only: action.only }),
    },
  }));
}

/** Every turn-boundary save still owed, in a stable order. */
/**
 * An ability check a spell offers against something it is still doing.
 *
 * The SRD writes this twenty times — see through an illusion, tear free of the
 * tentacles, disbelieve the terrain — and it is a *different* mechanism from
 * the repeat save beside it, however alike the sentences read. A repeat save
 * is raised by the turn boundary and owed whether anybody remembers it; this
 * is attempted because the table said somebody tried. Nothing raises it and no
 * turn blocks on it, which is the whole reason it needs no pending-debt
 * machinery.
 *
 * **The division of authority is the point.** Maestro decides that a guard
 * peers at the illusion, or that the Restrained ogre heaves against the
 * tentacles — that is fiction, and the engine has no business inventing it.
 * Everything after that is arithmetic the engine owns and the caller may not
 * supply: which ability, which skill, the proficiency and Expertise on that
 * skill, the conditions the roller is under, the Advantage and Disadvantage
 * they carry, the die, and the DC the spell was cast at.
 */
export interface AvailableCheck {
  /** The timer it belongs to, and the handle a caller names it by. */
  readonly effectKey: string;
  /** Who may attempt it. */
  readonly by: CharacterId;
  readonly ability: Ability;
  readonly skill: Skill | null;
  readonly dc: number;
  readonly onSuccess: 'none' | 'end-on-target';
  readonly label: string;
}

/**
 * The checks this creature could attempt right now.
 *
 * The read side of {@link resolveEffectCheck}, and the same shape as
 * `eligibleTargets`: a shortlist for the layer that decides *whether* somebody
 * tries, with every number already worked out so that layer never has to.
 */
export function availableChecks(state: GameState, who: CharacterId): readonly AvailableCheck[] {
  return Object.keys(state.timers)
    .sort()
    .flatMap((effectKey): AvailableCheck[] => {
      const timer = state.timers[effectKey];
      if (timer?.check === undefined) return [];
      if (!mayAttempt(timer, who)) return [];
      return [
        {
          effectKey,
          by: who,
          ability: timer.check.ability,
          skill: timer.check.skill ?? null,
          dc: timer.check.dc,
          onSuccess: timer.check.onSuccess,
          label: timer.check.label,
        },
      ];
    });
}

export interface EffectCheckCommand extends CommandIdentity {
  /** Which ongoing effect is being tested, from {@link availableChecks}. */
  readonly effectKey: string;
  /**
   * Advantage or Disadvantage the table knows about and the engine does not.
   *
   * A mode, never a result. Everything the engine can see — the roller's
   * conditions, their armour, the features standing on them — it reads for
   * itself.
   */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Named modifiers the table supplies: Guidance's 1d4, a tool's bonus. */
  readonly bonuses?: readonly Bonus[];
  /**
   * Which senses this particular attempt leans on.
   *
   * A *fact* about the attempt, not a result: SRD Blinded "automatically fails
   * an ability check that requires sight", and whether this one does is
   * something only the table knows. Minor Illusion is the reason it is not a
   * property of the spell — it creates "a sound **or** an image", so the same
   * definition covers a check a blind creature can make and one it cannot.
   *
   * The caller says which sense; the engine owns what that costs.
   */
  readonly senses?: CheckContext;
}

export interface EffectCheckResolution {
  readonly events: readonly GameEvent[];
  /** The roll, or null when this command id had already been applied. */
  readonly check: D20TestResult | null;
  readonly success: boolean;
  /** What the success did, so a narrating layer need not work it out. */
  readonly onSuccess: 'none' | 'end-on-target';
  /** True when this command id had already been applied. */
  readonly duplicate?: boolean;
}

/**
 * Attempt the check a spell offers against one of its ongoing effects.
 *
 * The caller says *who tries*, and nothing else that matters: the ability, the
 * skill, the DC, the modifiers and the die are all the engine's, and the
 * consequence is applied by the reducer from the recorded outcome rather than
 * by the caller from a number it chose.
 *
 * **It goes through `rollAbilityCheck`**, which is the only ability-check
 * calculator in the engine and was — until this command — reachable from no
 * command at all. Proficiency, Expertise, the armour penalties, a Blinded
 * creature's automatic failure on a sight-dependent check and the
 * exhaustion penalty all apply because that function applies them, not because
 * this one remembered to.
 *
 * **It costs the Action in combat**, because every SRD instance of this shape
 * says so — "can take an action to make a Strength (Athletics) check", "must
 * take the Study action to inspect your appearance". Outside combat there is
 * no economy to spend, exactly as with a casting.
 */
export function resolveEffectCheck(
  state: GameState,
  who: CharacterId,
  command: EffectCheckCommand,
  supply: Supply,
): Result<EffectCheckResolution> {
  // Before validation, as always: a retry must report the duplicate rather
  // than the world its own first run made — a freed creature asking again
  // would otherwise be told there is nothing to escape from.
  return once(state, `effect-check:${who}`, command, () => {
    return { events: [], check: null, success: false, onSuccess: 'none', duplicate: true };
  }, (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, who);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, who);
    if (creature === null) return unknownCreature(who);

    // The engine's own timers are complete knowledge: it wrote every one of
    // them. So an effect key nobody has heard of is a refusal, not a request —
    // there is no fact out in the fiction that would make it exist.
    const timer = state.timers[command.effectKey];
    if (timer === undefined) {
      return err('unknown_effect', `nothing ongoing is filed under ${command.effectKey}`);
    }
    const check = timer.check;
    if (check === undefined) {
      return err('no_check', `${command.effectKey} offers no check to attempt`);
    }
    if (!mayAttempt(timer, who)) {
      return err(
        'not_yours_to_attempt',
        `${command.effectKey} is on somebody else, and only they can shake it off`,
      );
    }

    // Nothing is rolled until the whole operation is known to be valid, so a
    // refusal costs neither the Action nor a turn of the generator. Out of
    // combat there is no economy to spend, exactly as with a casting.
    const combat = state.combat;
    const inCombat = combat !== null && combat.budgets[who] !== undefined;
    if (inCombat) {
      const spent = spendAction(combat, who, creature.conditions, {
        rules: actionRulesOn(state, who),
      });
      if (!spent.ok) return spent;
    }

    const issuedBefore = supply.issuer.count;
    // A feature that grants Advantage on this very skill — SRD Remarkable
    // Athlete: "Advantage on ... Strength (Athletics) checks", which is exactly
    // what tearing free of Black Tentacles asks for.
    const query = {
      family: 'ability-check' as const,
      roller: who,
      ability: check.ability,
      ...(check.skill === undefined ? {} : { skill: check.skill }),
      // **And what this check is about**, which is the axis a saving throw has
      // had since Brave and the one an ability check had no answer for. The
      // timer being settled holds it — a `condition` target is one condition
      // instance on one creature — so it is derived rather than restated, by
      // the same `conditionEndedBy` the turn boundary's repeated save uses.
      // SRD Powerful Build's "any ability check you make to end the Grappled
      // condition" is the sentence this lets a grant pick out.
      aboutConditions: conditionEndedBy(state, command.effectKey),
    };
    const fromFeatures = rollModesFor(state, query).modes;

    // **The sheet as it stands**, so a Belt of Giant Strength is behind the
    // heave that tears free of the tentacles. Asked here, where the state is,
    // and handed to `checks.ts`, which takes a sheet and holds none.
    const sheet = sheetAsItStands(state, who) ?? creature.sheet;
    const rolled = rollAbilityCheck(supply.issuer, supply.rng, sheet, check.ability, {
      dc: check.dc,
      ...(check.skill === undefined ? {} : { skill: check.skill }),
      conditions: effectiveConditions(state, who),
      modes: [...fromFeatures, ...(command.modes ?? [])],
      ...(command.senses === undefined ? {} : { conditionContext: command.senses }),
      // A worn item's "+1 bonus to ability checks", read rather than
      // remembered — the rule the modes above already follow.
      bonuses: checkBonuses(state, who, command.bonuses, check.skill),
    });
    if (!rolled.ok) return rolled;

    const events: GameEvent[] = [
      { type: 'rolls-issued', count: supply.issuer.count - issuedBefore, rng: supply.rng.snapshot() },
    ];

    // The stamp rides on the roll, which happens whether the check succeeds or
    // fails — the same reasoning that put `resolveAttack`'s stamp on the roll
    // rather than on the damage a miss never deals.
    events.push({
      ...recordD20Test(
        who,
        check.label,
        rolled.value,
        rolled.value.success ? 'sees through it' : 'no wiser',
      ),
      ...(stamp === null ? {} : { command: stamp }),
    });

    // **And the one-shot grants this check used up**, beside the roll and
    // whatever the outcome — SRD Help's "the next ability check they make
    // with the chosen skill" counts rolls and not successes, which is the
    // reading the attack rollers have always taken of the same field.
    events.push(...spentRollModifiers(state, query));

    // The Action goes whether or not the check lands: SRD spends it on the
    // attempt, not on the success.
    if (inCombat) events.push({ type: 'action-spent', id: who });

    // A check whose success changes nothing the engine holds emits no settling
    // event: there is no state for one to settle. The knowledge is the table's,
    // and the roll that produced it is in the log for anybody who asks why.
    if (check.onSuccess !== 'none') {
      events.push({
        type: 'effect-check-resolved',
        effectKey: command.effectKey,
        by: who,
        success: rolled.value.success,
      });
    }

    return ok({
      events,
      check: rolled.value,
      success: rolled.value.success,
      onSuccess: check.onSuccess,
    });
  });
}

/**
 * Which of two owed effects is settled first.
 *
 * **The previous creature's turn ends before the next one's begins**, and one
 * `turn-advanced` raises both. That is not a tie the keys may break: an
 * Insect Plague that drops a caster at the end of one turn ends the Web
 * somebody else was about to start their turn in, and the engine either gets
 * that right or settles whichever happened to sort first.
 *
 * `entry` sits between them because it is neither — whatever happened in
 * between — and because no guard lets it stand beside a boundary anyway.
 */
const MOMENT_ORDER: Readonly<Record<AreaMoment, number>> = {
  'end-of-turn': 0,
  // Both are things that happened between the boundaries, and the SRD orders
  // neither against the other. The area's own move is the authoritative
  // operation that raised its debt, and a creature cannot move while that debt
  // stands, so the two only ever meet in a log nothing here would write — an
  // order is given so that log still folds the same way twice.
  'area-moved': 1,
  entry: 2,
  'start-of-turn': 3,
};

/** What one settlement did. */
export interface AreaEffectResolution {
  readonly events: readonly GameEvent[];
  /** The debts discharged, in the order they were settled. */
  readonly settled: readonly OwedAreaEffect[];
  readonly outcomes: readonly SpellTargetOutcome[];
  /** Checks the rules call for that the engine still cannot make. */
  readonly unverified: readonly string[];
}

/**
 * Deal what the persistent areas owe.
 *
 * SRD writes these as clauses on the spell — "ends its turn there", "the first
 * time a creature enters the webs on a turn" — so what settles is **the spell
 * itself**, at the level and route the casting was made with, through the same
 * machinery an ordinary casting runs. There is no second save calculator here
 * and no second damage resolver, and the caller supplies no DC, no roll and no
 * outcome: it may only say that an already-owed effect should now be dealt.
 *
 * Its own command rather than a step inside the move that caused it, because
 * the move does not always have a generator: `declineOpportunity` completes
 * somebody else's declared move and has no dice to roll with. A debt that only
 * the moving command could settle would wedge the fight on exactly that path.
 *
 * Nothing is recomputed. Whether the creature was inside the area was decided
 * when the moment happened; by now they may have been thrown clear, and a
 * settlement that asked again would forgive a save the rules had already
 * called for.
 */
export function settleAreaEffects(
  state: GameState,
  supply: Supply,
  command: CommandIdentity = {},
): Result<AreaEffectResolution> {
  // Before every guard below, as always: a retry arrives at the world its own
  // first run made, and reporting "nothing is owed" for a settlement that has
  // already happened is the confusion command ids exist to prevent.
  return once(state, 'settle-area', command, () => {
    return { events: [], settled: [], outcomes: [], unverified: [] };
  }, (stamp) => {
    if (state.owedAreaEffects.length === 0) {
      return ok({ events: [], settled: [], outcomes: [], unverified: [] });
    }

    const events: GameEvent[] = [];
    const settled: OwedAreaEffect[] = [];
    const outcomes: SpellTargetOutcome[] = [];
    const unverified: string[] = [];
    let current = state;
    let first = true;

    // **The queue is re-read every time, never snapshotted**, and that is the
    // whole of the temporal guarantee at this end: settling the finishing
    // creature's end is what *brings about* the next creature's start, so the
    // start debts do not exist when this command begins. Taking the list once
    // would settle the end and leave the start standing.
    //
    // Bounded because a loop over state that raises state is a loop that has to
    // be able to stop: each pass discharges one debt and the turn stamp keeps
    // the same casting from catching the same creature again, so the ceiling is
    // reached only by a log nothing here could have written.
    for (let pass = 0; pass < 64; pass += 1) {
      const owed = nextOwed(current);
      if (owed === null) break;

      const discharge: GameEvent = {
        type: 'area-effect-settled',
        castingId: owed.castingId,
        target: owed.target as CharacterId,
        moment: owed.moment,
        ...(first && stamp !== null ? { command: stamp } : {}),
      };
      first = false;

      const record = current.ongoing[owed.castingId];
      const definition = record === undefined ? null : supply.content.spell(record.spellId);
      // **The clause is the record's, not the book's**, which is the same rule
      // the detectors have followed since the casting began pinning its area:
      // a spell already cast does not change when the catalogue does. This read
      // was the half IE-007 left behind — `areaTrigger.effects` and `.label`
      // were pinned and nothing read them — so a correction to Web's saving
      // throw reached a debt that had already been raised, which is history
      // rewritten through data.
      //
      // Nothing can be owed that the record cannot answer: `areaDefinitionOf`
      // raises a debt only where the record carries both an area and a clause,
      // and `upgradeOngoing` fills both from the catalogue for a pre-versioned
      // record as it enters the fold. So this is the fact the detector used.
      const trigger = record?.areaTrigger;
      const casterId = (record?.caster ?? null) as CharacterId | null;
      const caster = casterId === null ? null : creatureOf(current, casterId);

      // **A casting whose caster has gone still owes what it owes.** SRD Grease
      // runs its minute whether or not the wizard does, and the DC it rolls
      // against was pinned when it was conjured — so the save happens. What
      // cannot happen is an effect that needs the caster's *sheet* to throw
      // dice, and that is said out loud rather than silently forgiven. No
      // registered spell can reach it: every non-Concentration area trigger is
      // a bare saving throw, and the area-trigger suite asserts it.
      if (record === undefined || definition === null || trigger === undefined) {
        events.push(discharge);
        current = applyEvent(current, discharge);
        settled.push(owed);
        continue;
      }
      if (caster === null && trigger.effects.some(needsCasterSheet)) {
        unverified.push(
          `${record.spell} caught ${owed.target}, and resolving it needs dice thrown from a sheet ${record.caster} took with them; nothing was rolled`,
        );
        events.push(discharge);
        current = applyEvent(current, discharge);
        settled.push(owed);
        continue;
      }

      const resolved = resolveEffects(current, casterId!, caster, definition, {
        // Pinned at the casting: a Cleric who levels does not upcast a swarm
        // that has been buzzing since the first round.
        castLevel: record.level,
        route: null,
        numbers: record.numbers,
        targets: [owed.target as CharacterId],
        unverified,
        supply,
        castingId: record.castingId,
        events: [discharge],
        // Both halves off the record and neither off the book: which field the
        // caster's answer replaces was settled at the cast, and asking the
        // catalogue here would let an edit change how a running casting's
        // pinned answer lands — the failure this function's own preamble
        // records about Web's saving throw.
        effects: statedChoice(
          statedDamageType(trigger.effects, record.damageType),
          record.choice?.of,
          record.choice?.value,
        ),
        label: trigger.label,
      });
      if (!resolved.ok) return resolved;

      events.push(...resolved.value.events);
      current = resolved.value.events.reduce(applyEvent, current);
      outcomes.push(...resolved.value.outcomes);
      settled.push(owed);
    }

    return ok({ events, settled, outcomes, unverified });
  });
}

/**
 * The next effect to settle: the earliest moment, then the oldest casting.
 *
 * **The previous creature's turn ends before the next one's begins**, and one
 * `turn-advanced` can leave both owed. That is not a tie the keys may break,
 * so the moment decides and everything else is only there to make the answer
 * deterministic where the SRD offers no order at all.
 *
 * `entry` sits between them because it is neither — whatever happened in
 * between — and because no guard lets it stand beside a boundary anyway.
 */
function nextOwed(state: GameState): OwedAreaEffect | null {
  let best: OwedAreaEffect | null = null;
  for (const owed of state.owedAreaEffects) {
    if (
      best === null ||
      MOMENT_ORDER[owed.moment] < MOMENT_ORDER[best.moment] ||
      (MOMENT_ORDER[owed.moment] === MOMENT_ORDER[best.moment] &&
        (castingNumber(owed.castingId) < castingNumber(best.castingId) ||
          (owed.castingId === best.castingId && owed.target.localeCompare(best.target) < 0)))
    ) {
      best = owed;
    }
  }
  return best;
}

/**
 * The condition a repeat save would **end**, read off the timer that owes it.
 *
 * SRD writes "avoid or end" as one sentence — Dwarven Resilience, Fey
 * Ancestry, Brave and Protection from Poison all do — so a grant that reaches
 * the save a casting forced has to reach the save the boundary repeats. What
 * that save is about is not on the debt and deliberately is not: a
 * {@link PendingSave} says what is *owed*, and the timer it names already
 * holds the answer, because a `condition` target is one condition instance on
 * one creature. Reading it here rather than copying it onto the debt is the
 * rule `effectKey` itself follows — one fact, one place, nothing to disagree.
 *
 * Empty for every other kind of timer, which a condition-keyed selector reads
 * as a miss: a casting's own deadline and a feature's activation end nothing
 * a creature is suffering from, so a save repeated against one is about no
 * condition at all.
 */
export function conditionEndedBy(state: GameState, effectKey: string): readonly ConditionName[] {
  const target = state.timers[effectKey]?.target;
  if (target === undefined || target.kind !== 'condition') return [];
  const held = state.creatures[target.on]?.conditions.instances ?? [];
  const instance = held.find((one) => one.id === target.instance);
  return instance === undefined ? [] : [instance.condition];
}

/**
 * What a failed repeat leaves behind, where the SRD writes a failure that acts.
 *
 * SRD Sleep: "at which point it must repeat the save. If the target fails the
 * second save, the target has the Unconscious condition for the duration." The
 * Cockatrice's bite writes the same shape with no spell anywhere in it, which
 * is why {@link RepeatSave.onFailure} is a bare condition name and this reads
 * it off the timer rather than off anything that knows what a spell is.
 *
 * **Two events, and the second sentence is the first one's consequence.** The
 * deeper condition lands under the **same source** — a casting's mark, an
 * item's label, a caller's own string — so whatever released the first one
 * releases this one, and no second lifetime has to be arranged. The shallow
 * condition is lifted by that source, which is what makes this a *deepening*
 * rather than a creature holding both: Unconscious carries Incapacitated, and
 * an Incapacitated instance already standing under the same source would keep
 * the implication from being recorded and outlive the cause that carried it.
 *
 * **And the timer goes with the instance**, which is the half that stops the
 * boundary asking again: `condition-removed` drops every deadline hung on what
 * it lifted, so the repeat is repeated once — the SRD's "the second save" —
 * and no event of its own is needed to say so.
 *
 * Nothing at all where the hook writes no failure branch, which is every
 * repeat save the engine had before this: a failure that does nothing is still
 * the commonest answer in the book.
 */
function deepenedBy(state: GameState, pending: PendingSave): readonly GameEvent[] {
  const timer = state.timers[pending.effectKey];
  const deeper = timer?.repeatSave?.onFailure;
  if (timer === undefined || deeper === undefined || timer.target.kind !== 'condition') return [];

  // What is being deepened, read the way `conditionEndedBy` reads it: the
  // instance the timer names, on the creature it names. An instance already
  // gone — cured between the boundary and the roll — is nothing to deepen,
  // and the save was owed against an effect that is no longer there.
  const shallow = conditionEndedBy(state, pending.effectKey);
  if (shallow.length === 0) return [];

  return [
    ...shallow.map(
      (condition): GameEvent => ({
        type: 'condition-removed',
        id: pending.target,
        condition,
        source: pending.source,
      }),
    ),
    {
      type: 'condition-applied',
      id: pending.target,
      condition: deeper.condition,
      source: pending.source,
    },
  ];
}

/**
 * The damage a boundary deals **before** it rolls the save it owes.
 *
 * SRD Searing Smite: "the target takes 1d6 Fire damage **and then** makes a
 * Constitution saving throw." The order is the rule and not a courtesy — the
 * fire lands whether or not the save is made, so a spell that ends on this
 * turn's success still burns on the turn it ends.
 *
 * **Through `dealSpellDamage`, which is the whole point of doing it here**: the
 * target's Resistance and Immunity, the Temporary Hit Points it eats through,
 * the Concentration it puts at risk and its dropping to 0 all behave exactly
 * as they do for a Fire Bolt, because it is the same funnel. The notation is
 * the one the casting pinned, so no catalogue is opened at the boundary, and
 * the dice are thrown now rather than at the cast — the rule
 * {@link ScheduledDamage} and {@link GrantedPayout} both keep.
 *
 * Read off the **timer** rather than carried on the debt, which is the rule
 * `conditionEndedBy` and `deepenedBy` already follow: a {@link PendingSave}
 * says what is owed, and what the effect is owes it.
 *
 * Nothing at all for every repeat save that deals none, which is every one the
 * engine raised before this.
 */
function burnBeforeTheSave(
  state: GameState,
  pending: PendingSave,
  supply: Supply,
): Result<readonly GameEvent[]> {
  const payout = state.timers[pending.effectKey]?.repeatSave?.beforeTheSave;
  if (payout === undefined) return ok([]);

  const victim = state.creatures[pending.target];
  // Gone from the game between the boundary and the roll. The save above is
  // refused for the same absence; this simply has nobody to burn.
  if (victim === undefined || victim.vitals.dead) return ok([]);

  const label = spellOfSource(pending.source);
  // The recipient's own sheet, for the reason a scheduled hit takes one: the
  // components kept are the ones whose source is the spell, so the sheet
  // contributes nothing and the roll cannot fail for want of a caster who may
  // be dead by now.
  const rolled =
    payout.dice === undefined
      ? ok([] as readonly DamageComponent[])
      : rollSpellDice(supply, victim.sheet, label, payout.damageType, payout.dice);
  if (!rolled.ok) return rolled;

  const flat = payout.flat ?? 0;
  const components: readonly DamageComponent[] =
    flat === 0
      ? rolled.value
      : [
          ...rolled.value,
          { source: label, type: payout.damageType, roll: null, flat, total: flat },
        ];
  if (components.length === 0) return ok([]);

  // The caster is named so the hit can be answered and attributed, and is
  // omitted rather than guessed at when the casting has outlived them — the
  // reading `settleTurnPayouts` takes of the same question.
  const castingId = castingIdOf(pending.source);
  const by = castingId === null ? undefined : state.ongoing[castingId]?.caster;
  const hurt = dealSpellDamage(state, pending.target, components, label, supply, {
    ...(by === undefined ? {} : { by: by as CharacterId }),
  });
  if (!hurt.ok) return hurt;
  return ok(hurt.value.events);
}

/**
 * Roll the turn-boundary saves a state already owes.
 *
 * The deferred half of {@link resolveTurn}: a caller who advanced without a
 * generator comes back here. The debt is in state, so this works after a
 * reload, on a different machine, a week later.
 */
export function resolvePendingSaves(
  state: GameState,
  supply: Supply,
  command: CommandIdentity = {},
): Result<TurnResolution> {
  // Before the debt is even read. This command **rolls dice**, and the world
  // it lands in is not the world its first run left: a boundary or two later
  // the same creature owes the *next* repeat save, and an unidentified retry
  // would roll that one instead — freeing a creature nobody decided to free.
  return once(state, 'pending-saves', command, () => {
    // **A retry is not an empty world.** Rolling nothing and emitting nothing
    // is the guarantee; reporting nothing is a different claim, and a false
    // one — a retry that lands three boundaries later is looking at a world
    // that owes the *next* save. So `duplicate` says which of the two empty
    // answers this is, and `pending` says what is still owed, exactly as it
    // would to a caller who had never sent the command at all.
    return { events: [], saves: [], pending: pendingSavesOf(state), duplicate: true };
  }, (stamp) => {
    const owed = pendingSavesOf(state);
    if (owed.length === 0) return ok({ events: [], saves: [], pending: [] });

    const events: GameEvent[] = [];
    const saves: ResolvedRepeatSave[] = [];
    const issuedBefore = supply.issuer.count;
    // **The world a payout leaves behind, and nothing else's.** Every save
    // below is still weighed against the state the boundary raised it in —
    // which is what every save this command ever rolled was weighed against —
    // and the one thing that can move between them is damage dealt by this
    // same loop. So this is threaded through the payouts and read by them, and
    // a boundary that owes no damage is byte-for-byte the command it was.
    let burnt = state;

    for (const pending of owed) {
      const creature = state.creatures[pending.target];
      if (creature === undefined) {
        return unknownCreature(pending.target, 'owes a save but is not in this game');
      }

      // **The damage first, where the sentence deals some**, and then the die.
      // SRD Searing Smite prints the order and the order is the rule.
      const burning = burnBeforeTheSave(burnt, pending, supply);
      if (!burning.ok) return burning;
      events.push(...burning.value);
      burnt = burning.value.reduce(applyEvent, burnt);

      // And what the fire left: a casting the damage ended — its caster's
      // Concentration broken by a hit it dealt them — has taken its timer with
      // it, and `dropOrphanedSaves` has already dropped this debt. Rolling
      // against it would write an `effect-save-resolved` for a save nothing is
      // pending, which is a log the fold refuses.
      if (burnt.pendingSaves[pendingSaveKey(pending.effectKey, pending.turn)] === undefined) {
        continue;
      }

      // **"Avoid or end", and this is the ending.** SRD Dwarven Resilience
      // grants Advantage on saving throws "to avoid **or end** the Poisoned
      // condition", so the repeat a boundary raises is the same sentence as
      // the save the casting forced, read one turn later.
      //
      // **Derived from the timer rather than carried on the debt**, which is
      // the rule this file already follows about `effectKey`: a `PendingSave`
      // is what is owed, and what it is about is a fact the timer already
      // holds — its `condition` target names the instance this save would end.
      // A field on the debt would be a second copy of an answer, free to
      // disagree with the first.
      const support = savingSupport(
        state,
        pending.target,
        creature,
        pending.ability,
        supply,
        conditionEndedBy(state, pending.effectKey),
        // **And whether a spell put it there**, which SRD Magic Resistance
        // reads: "Advantage on saving throws against spells and other magical
        // effects." The repeat is a save against whatever is holding the
        // creature, and `PendingSave.source` already says what that is — a
        // `Hold Person#cast:3` for a casting, an `item:<id>` or a bare ruling
        // for anything else. `castingIdOf` is the engine's own reader of that
        // format and not a branch on a name, which is why the answer is
        // derived here rather than carried on the debt.
        castingIdOf(pending.source) !== null,
      );
      // The sheet as it stands: a save the boundary repeats is a save, and an
      // item that sets the ability it is made with is worn or it is not at the
      // moment the die is thrown.
      const sheet = sheetAsItStands(state, pending.target) ?? creature.sheet;
      const save = rollSavingThrow(supply.issuer, supply.rng, sheet, pending.ability, {
        dc: pending.dc,
        conditions: support.conditions,
        modes: support.modes,
        bonuses: support.bonuses,
      });
      if (!save.ok) return save;

      events.push(
        recordD20Test(
          pending.target,
          pending.label,
          save.value,
          save.value.success ? 'shakes it off' : 'still held',
        ),
        {
          type: 'effect-save-resolved',
          effectKey: pending.effectKey,
          turn: pending.turn,
          success: save.value.success,
        },
        // **And what a failure buys, where the SRD writes a failure that
        // buys something.** After the resolution and not before it: the
        // resolution is what clears the debt, and a removal that dropped the
        // timer first would leave `dropOrphanedSaves` to discard a save
        // nobody had answered.
        ...(save.value.success ? [] : deepenedBy(state, pending)),
      );
      saves.push({
        effectKey: pending.effectKey,
        target: pending.target,
        ability: pending.ability,
        dc: pending.dc,
        label: pending.label,
        save: save.value,
        success: save.value.success,
      });
    }

    // One generator position for the whole boundary, recorded once — and the
    // stamp rides here, because this is the event the command always emits when
    // it does anything at all. A save that ends an effect writes
    // `effect-save-resolved`; one that fails does not, and `roll-recorded` is
    // per save rather than per command. An event that always happens is where a
    // stamp has to ride.
    events.splice(0, 0, {
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
      ...(stamp === null ? {} : { command: stamp }),
    });

    return ok({ events, saves, pending: [] });
  });
}

/**
 * End the current turn, and settle whatever ending it owes.
 *
 * SRD effects that "repeat the save at the end of each of its turns" are
 * everywhere, and leaving them to the caller means leaving them to be
 * forgotten. So the turn itself knows: advancing raises the saves the boundary
 * owes, and this rolls them.
 *
 * Given no generator the saves stay in state as a pending resolution — and the
 * engine then **refuses to advance another turn** until they are settled.
 * That is the difference between a debt and a leak: forgetting stops the game
 * rather than quietly dropping a rule. `resolvePendingSaves` clears it.
 *
 * A summons whose casting has ended is a debt of the same kind and refuses
 * for the same reason, cleared by `dismissStrandedSummons`; it is the one
 * that is **derived** rather than filed, because unlike an owed area effect
 * it is a question about the world as it stands rather than a record of a
 * moment that has passed.
 *
 * A success ends the effect on that target, or the whole casting, as the
 * effect's own hook says. Either way the caster's Concentration, the other
 * targets, and anything an unrelated source put there are left alone.
 */
export function resolveTurn(
  state: GameState,
  supply?: Supply,
  command: CommandIdentity = {},
): Result<TurnResolution> {
  // A retried advance is the duplicate nobody notices. It doubles no effect
  // and spends no resource — it **skips a combatant's whole turn**, and the
  // log it leaves behind is perfectly well-formed. The check comes before
  // every other, so a retry reports the duplicate rather than reporting
  // whatever the first advance made true.
  return once(state, 'turn', command, () => {
    return { events: [], saves: [], pending: [], duplicate: true };
  }, (stamp) => {
    if (state.combat === null) return err('no_combat', 'no combat is running');

    if (state.pendingMove !== null) {
      return err(
        'move_pending',
        `${state.pendingMove.mover} is mid-move and still owes an Opportunity Attack; settle it before the turn moves on`,
      );
    }

    if (state.pendingAttack !== null) {
      return err(
        'attack_pending',
        `${state.pendingAttack.attacker} has a hit whose damage is still unrolled; settle it before the turn moves on`,
      );
    }

    // Damage that has been rolled and not dealt is the newest debt of this
    // shape, and the loudest one to get wrong: advancing past it would leave a
    // creature un-hit by a blow that had already landed, with the roll sitting
    // in the log.
    if (state.pendingDamage !== null) {
      return err(
        'damage_pending',
        `${state.pendingDamage.target} has damage rolled against them that nobody has settled; settle it before the turn moves on`,
      );
    }

    // A D20 Test whose effects have not occurred. Nobody is obliged to push it,
    // but until somebody says so the number is not final — and a turn that moved
    // on would take the chance to push it with it.
    if (state.pendingTest !== null) {
      return err(
        'test_pending',
        `${state.pendingTest.who} has a D20 Test whose effects are still unsettled; settle it before the turn moves on`,
      );
    }

    // A declared casting is engine debt in exactly the way a held attack is: the
    // action is spent, the slot is not, and nothing has taken effect. Advancing
    // past it would strand a spell that the rules say is still being cast.
    //
    // **An instant window only.** A casting held open so a Counterspell can
    // answer it is open for a moment under one caller's control, and there is
    // nothing for a turn to do but wait. A casting of a minute or more is the
    // opposite: SRD measures it in turns, so the turn is exactly what it needs
    // — and refusing to advance past one was the recorded wedge, since in
    // combat the clock it settles on is *derived from turns wrapping*. So the
    // rite is skipped here and answered at the boundary instead, by the
    // per-turn Magic action and the derived failure that reads it.
    //
    // `completesAt` is what tells the two apart, for the reason
    // `settlementEvents` reads it rather than `castingTime`. With IE-038's
    // keyed record this is per casting rather than per record count, so a rite
    // standing beside an unsettled window blocks on the window alone, and the
    // reason names them because with several open "the casting" says nothing a
    // caller could act on.
    const declared = pendingCastingsOf(state).filter(
      (casting) => casting.completesAt === undefined,
    );
    if (declared.length > 0) {
      return err(
        'casting_pending',
        `${declared
          .map((casting) => `${casting.caster} has declared ${casting.spell} (${casting.castingId})`)
          .join('; ')} and ${declared.length === 1 ? 'it has' : 'they have'} not taken effect; settle ${declared.length === 1 ? 'it' : 'them'} before the turn moves on`,
      );
    }

    const outstanding = pendingSavesOf(state);
    if (outstanding.length > 0) {
      return err(
        'saves_pending',
        `${outstanding.length} turn-boundary save(s) are still owed; resolve them before the turn moves on`,
      );
    }

    // **A creature standing on a casting that is over.** SRD summons go when
    // their spell does, and a casting ends four ways nobody commands — a
    // deadline, a Concentration broken by unconsciousness, a trigger, the
    // caster leaving — so the fold finds the ending and emits nothing, and the
    // departure itself is a batch (`removeCreatureEverywhere`) because the
    // leaver's holds have to be settled before its key goes. Those two halves
    // cannot meet inside the reducer, and until now nothing joined them: the
    // order advanced past a hound whose spell had ended and the hound went on
    // holding its rung, attacking and being attacked.
    //
    // So it is a debt, on `owedAreaEffects`' pattern and for its reason — the
    // engine's posture is that forgetting a rule stops the game rather than
    // quietly losing it. **Derived rather than filed**, which is the one way
    // it differs: an area debt records a moment that has passed and could not
    // be recomputed, while this is a question about the world as it stands and
    // `strandedSummons` answers it from `creatures` and `ongoing` alone. A
    // field would be a second copy of an answer the state already gives.
    //
    // **Asked of the world this command begins in, and not again afterwards.**
    // The boundary's own settlements can end a casting — an area effect that
    // drops a caster — and re-checking after the batch would mean discarding
    // events that have already happened. The debt is derived, so it is simply
    // standing when the *next* advance asks, which is exactly where
    // `owedAreaEffects` leaves one raised at a boundary too.
    const stranded = strandedSummons(state);
    if (stranded.length > 0) {
      return err(
        'summons_stranded',
        `${stranded.join(', ')} ${stranded.length === 1 ? 'is' : 'are'} still standing on a casting that has ended; dismissStrandedSummons takes ${stranded.length === 1 ? 'it' : 'them'} away before the turn moves on`,
      );
    }

    // What a persistent area caught somebody doing, still undealt. Advancing
    // past it would carry the debt into a turn whose boundary may raise another,
    // and a creature would be two saves behind by the time anybody looked. The
    // creature named is the one whose turn is ending, and the area half of the
    // policy is global anyway.
    const owedNow = mayAct(state, currentCombatant(state.combat).id);
    if (owedNow !== null) return owedNow;

    const advanced: GameEvent[] = [
      { type: 'turn-advanced', ...(stamp === null ? {} : { command: stamp }) },
    ];
    let after = advanced.reduce(applyEvent, state);

    // A hit the last turn promised — SRD Acid Arrow's "at the end of its next
    // turn". Collected **before** everything below it, for two reasons that both
    // matter: the damage can break a Concentration, which ends the very effect
    // whose repeat save this boundary would otherwise raise; and in a fight with
    // one combatant the creature ending its turn is the creature beginning the
    // next, so acid that drops it to 0 must land before the Death Save is asked
    // for.
    if (dueDamageOf(after).length > 0) {
      if (supply === undefined) {
        return err(
          'damage_owed',
          `${dueDamageOf(after).length} scheduled hit(s) fall due at this boundary; advancing needs a generator to roll them`,
        );
      }
      const collected = collectDueDamage(after, supply);
      if (!collected.ok) return collected;
      advanced.push(...collected.value);
      after = collected.value.reduce(applyEvent, after);
    }

    // What the boundary's areas owe: the finishing creature's end first, then
    // the beginning creature's start. `settleAreaEffects` orders by the moment
    // rather than by anything about how the debts were filed, which is the whole
    // of the temporal guarantee — an Insect Plague that drops a caster at the
    // end of one turn ends the Web the next creature was about to start theirs
    // in, and the debt goes with the casting.
    //
    // **Before the Death Saving Throw**, deliberately. Both are "at the start of
    // your turn" and the SRD orders neither, but only one order leaves room for
    // a start-of-turn *heal* to matter — Aura of Life's shape — and an ordering
    // that makes a future rule unreachable is the wrong one to pick by accident.
    if (after.owedAreaEffects.length > 0) {
      if (supply !== undefined) {
        const dealt = settleAreaEffects(after, supply);
        if (!dealt.ok) return dealt;
        advanced.push(...dealt.value.events);
        after = dealt.value.events.reduce(applyEvent, after);
      }
    }

    // What the boundary's running castings hand over: SRD Heroism's Temporary
    // Hit Points "at the start of each of its turns". No save to raise and no
    // area to be standing in — the arrangement is on the creature, and the
    // boundary is the only thing that reads it.
    //
    // **After the areas and before the Death Saving Throw.** The areas first
    // because their debts were already standing when this command began and a
    // payout is derived here; the death save last for the reason the areas are
    // ahead of it too — only that order leaves room for a start-of-turn *heal*
    // to matter, which is exactly what a payout of healing is.
    //
    // **Whose turn ended and whose began are read off the two combat states**,
    // never off the creature the caller named: the same two moments
    // `settleAreaEffects` orders, a round apart.
    // The fight is running — `no_combat` refused above, and the guard beside it
    // already reads `currentCombatant(state.combat)` — so the turn that ended
    // has an owner. The turn that *begins* may not: the boundary's own
    // settlements can end the fight, and a fight that has ended has no turn
    // beginning for a payout to fall due at.
    //
    // The paying and the refusal are `settleBoundaryPayouts`', which is also
    // what the boundary a fight *opens* on calls — one answer to "what does
    // this moment hand over", rather than two that could drift apart.
    const ending = currentCombatant(state.combat).id;
    const beginning = after.combat === null ? undefined : currentCombatant(after.combat).id;
    const paid = settleBoundaryPayouts(after, supply, ending, beginning);
    if (!paid.ok) return paid;
    advanced.push(...paid.value);
    after = paid.value.reduce(applyEvent, after);

    // SRD *Monsters*: "At the start of each of the monster's turns, roll 1d6."
    // Beside the payouts because it is the same half of the boundary — what
    // the creature whose turn is beginning is owed — and after them rather
    // than before for no reason the rules give: a recharge touches no hit
    // points, so it cannot move the death save below it or be moved by the
    // healing above it, and the position is free. Beside the payouts is where
    // a reader will look for it.
    const recharged = settleStartOfTurnRecharges(after, supply, beginning);
    if (!recharged.ok) return recharged;
    advanced.push(...recharged.value);
    after = recharged.value.reduce(applyEvent, after);

    // SRD Haste: "it gains an additional action on each of its turns." The
    // third thing this half of the boundary hands the creature whose turn is
    // beginning, beside the payouts and the recharge — and the only one that
    // throws nothing and can refuse nothing, so it needs neither the generator
    // nor a debt of its own.
    const granted = settleStartOfTurnGrants(after, beginning);
    advanced.push(...granted);
    after = granted.reduce(applyEvent, after);

    // SRD: "Whenever you start your turn with 0 Hit Points, you must make a
    // Death Saving Throw." Whenever — nobody decides it, so the turn owes it the
    // same way it owes an effect's repeat save, and for the same reason.
    const owed = deathSaveOwedBy(after);
    if (owed !== null) {
      if (supply === undefined) {
        return err(
          'death_save_owed',
          `${owed} starts their turn at 0 hit points and owes a Death Saving Throw; advancing needs a generator to roll it`,
        );
      }
      const rolled = rollTheDeathSave(after, owed, supply);
      if (!rolled.ok) return rolled;
      advanced.push(...rolled.value);
      after = rolled.value.reduce(applyEvent, after);
    }

    const raised = pendingSavesOf(after);

    if (raised.length === 0) return ok({ events: advanced, saves: [], pending: [] });
    if (supply === undefined) return ok({ events: advanced, saves: [], pending: raised });

    const settled = resolvePendingSaves(after, supply);
    if (!settled.ok) return settled;

    return ok({
      events: [...advanced, ...settled.value.events],
      saves: settled.value.saves,
      pending: [],
    });
  });
}

/**
 * Whose turn has just begun at 0 hit points, if anybody's.
 *
 * SRD is precise about who rolls: a creature at 0 that is neither Stable nor
 * dead. A monster is none of these — it "dies the instant it drops to 0" — so
 * there is never one to ask.
 */
function deathSaveOwedBy(state: GameState): CharacterId | null {
  const combat = state.combat;
  if (combat === null) return null;

  const whose = currentCombatant(combat).id;
  const creature = state.creatures[whose];
  if (creature === undefined) return null;
  if (creature.vitals.dead || creature.vitals.stable) return null;
  return isDown(creature.vitals) ? whose : null;
}

/**
 * Roll it, and record what it was.
 *
 * Through `rollDeathSave` rather than an ordinary saving throw, because this
 * one is tied to no ability score: SRD, "Unlike other saving throws, this one
 * isn't tied to an ability score." It still takes modes and bonuses — Beacon
 * of Hope grants Advantage on it explicitly — which is why the roll starts
 * from zero rather than skipping the machinery.
 */
function rollTheDeathSave(
  state: GameState,
  who: CharacterId,
  supply: Supply,
): Result<GameEvent[]> {
  const creature = state.creatures[who];
  if (creature === undefined) return unknownCreature(who, 'has no record here');

  const issuedBefore = supply.issuer.count;
  // SRD Beacon of Hope grants Advantage on Death Saving Throws by name, and a
  // death save is its own roll family precisely because it is tied to no
  // ability — so an ability-keyed grant on saving throws must not reach it.
  const standing = rollModesFor(state, { family: 'death-save', roller: who }).modes;
  const rolled = rollDeathSave(supply.issuer, supply.rng, creature.vitals, {
    modes: [...standing, ...(supply.modes ?? [])],
    ...(supply.bonuses === undefined ? {} : { bonuses: supply.bonuses }),
    // SRD Luck reaches a death save like any other D20 Test, and this is the
    // one roller handed `Vitals` rather than a sheet — so the sheet is read
    // here and the face travels in. See `DeathSaveOptions.reroll`.
    reroll: (sheetAsItStands(state, who) ?? creature.sheet).rerollsD20On ?? null,
  });
  if (!rolled.ok) return rolled;

  return ok([
    {
      type: 'death-save-recorded',
      id: who,
      natural: rolled.value.roll.natural,
      ...(rolled.value.roll.total === rolled.value.roll.natural
        ? {}
        : { total: rolled.value.roll.total }),
    },
    // SRD: a natural 20 "regains 1 Hit Point", and unconsciousness lasts only
    // "until you regain any Hit Points". The lifting is emitted here rather
    // than derived in the reducer, for the same reason healing emits it: the
    // reducer replays a record, and only the cause that put them down is
    // lifted — a character who was also put to Sleep stays asleep.
    ...(rolled.value.revived
      ? [
          {
            type: 'condition-removed' as const,
            id: who,
            condition: 'unconscious' as const,
            source: ZERO_HIT_POINTS,
          },
        ]
      : []),
    {
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    },
  ]);
}

