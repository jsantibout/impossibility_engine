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
  err,
  ok,
  type Result,
  type RollMode,
  type Skill,
} from '@ie/shared';
import { type Bonus, type ModeSource } from '../bonuses.js';
import { type D20TestResult, rollAbilityCheck, rollSavingThrow } from '../checks.js';
import { currentCombatant, spendAction } from '../combat.js';
import { type CheckContext } from '../conditions.js';
import {
  isDue,
  mayAttempt,
  type PendingSave,
  type ScheduledDamage,
  timeView,
} from '../duration.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { definitionFor, needsCasterSheet, statedDamageType } from '../spell-definitions.js';
import { type AreaMoment, castingNumber, type OwedAreaEffect } from '../spells.js';
import { effectiveConditions, rollModesFor } from '../standing.js';
import { isDown, rollDeathSave } from '../vitals.js';
import { type ConcentrationSaveSupply } from './casting.js';
import { creatureOf, unknownCreature, ZERO_HIT_POINTS } from './command.js';
import { dealSpellDamage } from './damage.js';
import { mayAct, pendingCastingsOf, pendingSavesOf } from './holds.js';
import { recordD20Test, rollSpellDice, savingSupport } from './rolls.js';
import { resolveEffects } from './spell-resolution.js';
import { type SpellTargetOutcome } from './targeting.js';

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
  supply: ConcentrationSaveSupply,
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
  supply: ConcentrationSaveSupply,
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
      const spent = spendAction(combat, who, creature.conditions);
      if (!spent.ok) return spent;
    }

    const issuedBefore = supply.issuer.count;
    // A feature that grants Advantage on this very skill — SRD Remarkable
    // Athlete: "Advantage on ... Strength (Athletics) checks", which is exactly
    // what tearing free of Black Tentacles asks for.
    const fromFeatures = rollModesFor(state, {
      family: 'ability-check',
      roller: who,
      ability: check.ability,
      ...(check.skill === undefined ? {} : { skill: check.skill }),
    }).modes;

    const rolled = rollAbilityCheck(supply.issuer, supply.rng, creature.sheet, check.ability, {
      dc: check.dc,
      ...(check.skill === undefined ? {} : { skill: check.skill }),
      conditions: effectiveConditions(state, who),
      modes: [...fromFeatures, ...(command.modes ?? [])],
      ...(command.senses === undefined ? {} : { conditionContext: command.senses }),
      ...(command.bonuses === undefined ? {} : { bonuses: command.bonuses }),
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
  supply: ConcentrationSaveSupply,
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
      const definition = record === undefined ? null : definitionFor(record.spellId);
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
        effects: statedDamageType(trigger.effects, record.damageType),
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
 * Roll the turn-boundary saves a state already owes.
 *
 * The deferred half of {@link resolveTurn}: a caller who advanced without a
 * generator comes back here. The debt is in state, so this works after a
 * reload, on a different machine, a week later.
 */
export function resolvePendingSaves(
  state: GameState,
  supply: ConcentrationSaveSupply,
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

    for (const pending of owed) {
      const creature = state.creatures[pending.target];
      if (creature === undefined) {
        return unknownCreature(pending.target, 'owes a save but is not in this game');
      }

      const support = savingSupport(state, pending.target, creature, pending.ability, supply);
      const save = rollSavingThrow(supply.issuer, supply.rng, creature.sheet, pending.ability, {
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
 * A success ends the effect on that target, or the whole casting, as the
 * effect's own hook says. Either way the caster's Concentration, the other
 * targets, and anything an unrelated source put there are left alone.
 */
export function resolveTurn(
  state: GameState,
  supply?: ConcentrationSaveSupply,
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
    // **Still global, and still reading every one of them.** In combat every
    // pending casting is an instant window under one caller's control; IE-041
    // makes the long casting's obligation per-casting, and this is what that
    // task narrows. The reason names them, because with several open "the
    // casting" says nothing a caller could act on.
    const declared = pendingCastingsOf(state);
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
  supply: ConcentrationSaveSupply,
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

