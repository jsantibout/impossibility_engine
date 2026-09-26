/**
 * The actions that change what a turn can do.
 *
 * Dash, Disengage, Dodge, Hide, and Ready with the release that answers it.
 * Ready is why this module sits at the top: releasing a readied spell runs the
 * whole casting path, and holding one runs part of it at the moment of
 * readying.
 *
 * **Three of them take a price now.** SRD Cunning Action and SRD Adrenaline
 * Rush buy a Dash, a Disengage or a Hide with a Bonus Action, so each of those
 * commands takes a `from` and refuses one nothing has allowed — rather than
 * holding a permission it could never be asked to honour, which is the defect
 * `STATABLE_PRICES` exists to prevent.
 */

import { type CommandIdentity, once } from '../idempotency.js';
import {
  ABILITY_NAMES,
  type Ability,
  asCharacterId,
  type CharacterId,
  type ContextRequest,
  err,
  needsContext,
  ok,
  type Result,
  type RollMode,
  type Skill,
} from '@ie/shared';
import { DODGE, DODGE_ACTION, READY, READY_ACTION } from '../actions.js';
import {
  ACTION_TITLES,
  allowedActions,
  allowsPrice,
  canUseFeatureThisTurn,
  currentCombatant,
  dash,
  isStatablePrice,
  disengage,
  permitsGrantedAction,
  refuseObjectHandling,
  MULTIATTACK_LEDGER,
  spendAction,
  spendAttack,
  spendBonusAction,
  spendReaction,
  useFreeInteraction,
  type ActionSlot,
  type GrantedActionRule,
  type NamedAction,
  type TurnBudget,
} from '../combat.js';
import { type Bonus, type ModeSource } from '../bonuses.js';
import { type StatedAction, type StatedBonusAction } from '../character.js';
import { formNamed, wrongFormFor } from '../forms.js';
import { grapplesOn } from './unarmed.js';
import { pullToward } from './spell-effect-movement.js';
import type { CreatureSize, PrintedSaveEffect } from '@ie/srd';
import { roomInside } from '../elsewhere.js';
import { rollAbilityCheck, type D20TestResult } from '../checks.js';
import { isDown } from '../vitals.js';
import {
  actionRulesOn,
  canSee,
  conditionImmunitiesOf,
  effectiveConditions,
  requirementsHold,
  rollModesFor,
  sheetAsItStands,
  speedOf,
  standingFor,
  type StandingRequirement,
} from '../standing.js';
import { checkBonuses, recordD20Test, spentRollModifiers } from './rolls.js';
import {
  forcePrintedSaveOn,
  type PrintedSaveOnACreature,
  withDeclaredDamage,
} from './printed-save-clauses.js';
import { hasCondition, isIncapacitated } from '../conditions.js';
import {
  applyEvent,
  type GameEvent,
  type GameState,
  type ReadiedAction,
  type ReadiedResponse,
} from '../events.js';
import {
  coverBetween,
  type CoverDegree,
  distanceBetween,
  obscurementAt,
  type Placement,
  type Point,
  positionOf,
  sizeAtMost,
} from '../positioning.js';
import { effectiveSizeOf } from '../size.js';
import {
  affectedByPrintedLine,
  attacksInAction,
  describeMultiattack,
  describePerDay,
  describeRecharge,
  LEGENDARY_MOMENT,
  LEGENDARY_POOL,
  legendaryLineOf,
  multiattackAllows,
  multiattackOf,
  multiattackUses,
  perDayTallyKey,
  printedLineSource,
  printedSaveOf,
  statedActionOf,
  statedBonusActionOf,
  statedBonusActionsUsed,
  withFormSpeeds,
} from '../monster.js';
import { heldByObject } from '../state.js';
import { remaining, tallied, type SlotKind } from '../resources.js';
import { type Content } from '../content.js';
import { durationSecondsAt, untilDispelledAt } from '../spell-definitions.js';
import { endOfCurrentTurn, startOfNextTurn } from '../time.js';
import { OBJECT_CREATURE_TYPE } from '../objects.js';
import type { MonsterTreeStride } from '@ie/srd';
import { castSpell, chooseRoute, type Supply, nextCastingId } from './casting.js';
import { creatureOf, sceneFor, unknownCreature } from './command.js';
import { routeLabel } from './item-casting.js';
import { applyConditionTo, schedule } from './conditions.js';
import { type AttackResolution, resolveAttack } from './attacks.js';
import { grantTemporaryHpTo } from './creatures.js';
import { rollRecorded } from '../rolls.js';
import { caughtIn, hazardSource } from '../hazards.js';
import { featureTimer } from './features.js';
import { mayAct } from './holds.js';
import { teleportTo } from './teleport.js';
import { type MoveResolution, moveWithin } from './movement.js';
import { castOrRelease } from './spell-resolution.js';
import {
  aimedIdentity,
  type AimedRolls,
  type CastSpellRequest,
  declaredFacts,
  type SpellResolution,
  type SpellTargetOutcome,
} from './targeting.js';

/**
 * Which slot the caller is offering to pay a Dash out of.
 *
 * The same shape as {@link DisengageOptions}, for the same reason and with the
 * same refusals: SRD Cunning Action and SRD Adrenaline Rush both say "you can
 * take the Dash action as a Bonus Action", and a permission the command could
 * not be *asked* for would land on the creature and be spent as an Action
 * anyway — which is the defect `STATABLE_PRICES` was written to close, found
 * once already on this file's other command.
 */
export interface DashOptions extends AllowanceChoice {
  readonly from?: ActionSlot;
}

/**
 * Which of the allowances a creature holds the caller means, and what else the
 * one spend is buying.
 *
 * **Both fields exist because a creature really holds more than one.** An Orc
 * Rogue 2 holds SRD Adrenaline Rush and SRD Cunning Action, each of which
 * offers a Dash as a Bonus Action and only one of which charges for it; a Monk
 * 2 holds Monk's Focus, which offers the Disengage free *and* in a priced pair
 * with the Dodge. Unsaid, `allowsPrice` takes the cheapest — the only default
 * that can never spend a resource for something the book gives away — so the
 * two fields are how a caller asks for the other thing on purpose.
 *
 * They are on the same object because they answer one question between them:
 * *which allowance*. `usingFeature` names it outright and `alsoTaking` names
 * it by what it buys, and a caller may write both.
 */
export interface AllowanceChoice {
  /**
   * The feature whose allowance to take, by the source `actionRulesOn` gives
   * it — a feature's own id, or a casting's source.
   *
   * SRD Adrenaline Rush pays Temporary Hit Points for the use it charges, so
   * an Orc who wants them says so rather than having the price chosen for
   * them. A feature that grants no such allowance is `no_such_allowance`.
   *
   * **And it is how a bundle's second action is taken.** Where the price is
   * the book's — a Dodge costs an Action — this names the extra action a
   * bundle handed the turn, which is spent instead of the turn's own. See
   * {@link alsoTaking}.
   */
  readonly usingFeature?: string;
  /**
   * The other actions this one spend is buying — SRD Patient Defense's "both
   * the Disengage and the Dodge actions as a Bonus Action".
   *
   * The allowance taken must reach every one of them, so naming the Dodge here
   * is what tells the priced pair from the free Disengage beside it. The
   * others are handed to the turn as granted actions, narrowed to themselves,
   * and are spent for nothing before the turn ends.
   */
  readonly alsoTaking?: readonly NamedAction[];
}

/**
 * SRD Dash: "you gain extra movement for the current turn. The increase equals
 * your Speed after applying any modifiers."
 */
/**
 * What an allowance charges besides the slot, asked before anything is spent.
 *
 * SRD Adrenaline Rush is the printing: a Dash bought out of a Bonus Action
 * costs one of a Proficiency Bonus's worth of uses and pays Temporary Hit
 * Points equal to the same. `actionRulesOn` hands both on the rule, already
 * numbers, so a price the holder cannot pay refuses here with nothing charged
 * — and an allowance that prints no price, which is every other one in the
 * book, charges nothing and says nothing.
 */
function priceOfAllowance(
  resources: Parameters<typeof remaining>[0],
  id: CharacterId,
  held: GrantedActionRule,
  /** The action being taken now, so the rest of a bundle can be handed over. */
  taking: NamedAction,
): Result<GameEvent[]> {
  const events: GameEvent[] = [];
  if (held.spends !== undefined) {
    if (remaining(resources, held.spends) < 1) {
      return err('exhausted', `${id} has no uses of ${held.label} left to buy that with`);
    }
    events.push({ type: 'resource-spent', id, key: held.spends, amount: 1 });
  }
  if (held.temporaryHitPoints !== undefined && held.temporaryHitPoints > 0) {
    events.push({ type: 'temporary-hp-granted', id, amount: held.temporaryHitPoints });
  }
  // **The rest of the bundle, handed to the turn.** SRD Patient Defense's one
  // Bonus Action and one Focus Point buy two actions, and the second is a
  // `GrantedAction` narrowed to itself — the existing vocabulary, so nothing
  // new can be spent on the wrong thing and nothing survives the turn. The
  // Monk names the grant when they take it; see `AllowanceChoice.usingFeature`.
  if (held.rule.kind === 'allows') {
    for (const also of allowedActions(held.rule)) {
      if (also === taking) continue;
      events.push({
        type: 'turn-budget-granted',
        id,
        source: held.source,
        action: { only: [also] },
      });
    }
  }
  return ok(events);
}

export function takeDash(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
  options: DashOptions = {},
): Result<GameEvent[]> {
  return once(state, `dash:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (state.combat === null) {
      return err('not_in_combat', 'there is no movement budget to add to outside combat');
    }

    // The caller asks for the cheaper price and the engine rules on whether
    // they may have it, exactly as a Disengage does below: an allowance nobody
    // invokes changes nothing, and the engine never spends a slot the caller
    // did not name.
    const from: ActionSlot = options.from ?? 'action';
    if (from !== 'action' && !isStatablePrice('dash', from)) {
      return err(
        'no_such_price',
        `Dash cannot be paid for out of ${from}; this command charges an action, or a Bonus Action where something has allowed it`,
      );
    }
    const rules = actionRulesOn(state, id);
    const priced: GameEvent[] = [];
    if (from !== 'action') {
      const allowed = allowsPrice(id, 'dash', from, rules, choiceOf(options));
      if (!allowed.ok) return allowed;
      const price = priceOfAllowance(creature.resources, id, allowed.value, 'dash');
      if (!price.ok) return price;
      priced.push(...price.value);
    }

    // Validate the whole operation before any of it is emitted: the action has
    // to be there to spend, and the increase has to be one this creature can
    // actually receive.
    const spend = { rules, as: 'dash' as const };
    const granted = from === 'action' ? options.usingFeature : undefined;
    const mismatch = refuseGrantMismatch(state, id, granted, 'dash');
    if (mismatch !== null) return mismatch;
    const spent =
      from === 'bonus-action'
        ? spendBonusAction(state.combat, id, creature.conditions, spend)
        : spendAction(state.combat, id, creature.conditions, spend, granted);
    if (!spent.ok) return spent;
    const dashed = dash(spent.value, id, speedOf(state, id));
    if (!dashed.ok) return dashed;

    return ok([
      from === 'bonus-action'
        ? { type: 'bonus-action-spent', id }
        : { type: 'action-spent', id, ...(granted === undefined ? {} : { grant: granted }) },
      ...priced,
      { type: 'dash-taken', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/**
 * What the caller said about which allowance pays for this, where they said
 * anything — see {@link AllowanceChoice}.
 *
 * A helper rather than the object itself, so a command with no such option
 * still passes the same empty answer and `allowsPrice` has one signature.
 */
const choiceOf = (options: AllowanceChoice): AllowanceChoice => ({
  ...(options.usingFeature === undefined ? {} : { usingFeature: options.usingFeature }),
  ...(options.alsoTaking === undefined ? {} : { alsoTaking: options.alsoTaking }),
});

/**
 * Whether an extra action this turn was handed may be spent on this action —
 * and the refusal where it may not.
 *
 * **It is the command's question and not the reducer's**, and that asymmetry
 * is the whole reason this function exists. `spendAction` matches a named
 * grant on its source alone, because `fold/combat.ts` folds `action-spent`
 * with no idea which action it was; so the narrowing every `GrantedAction`
 * carries — SRD Action Surge's `except` and SRD Expeditious Retreat's `only` —
 * is checked exactly where the answer is known, by whoever is taking the
 * action. One function, because a command that forgot to ask would spend a
 * Patient Defense's Dodge on a Dash and void the clause it was granted under.
 *
 * Null where nothing is named, where there is no combat, and where the
 * creature holds no such grant at all: the last is `spendAction`'s
 * `no_such_grant` rather than this one's sentence, so a caller who names a
 * grant nobody handed them is told that and not this.
 */
function refuseGrantMismatch(
  state: GameState,
  id: CharacterId,
  granted: string | undefined,
  as: NamedAction,
): Result<never> | null {
  if (granted === undefined || state.combat === null) return null;
  const held = (state.combat.budgets[id]?.extraActions ?? []).filter(
    (extra) => extra.source === granted,
  );
  if (held.length === 0 || held.some((extra) => permitsGrantedAction(extra, as))) return null;
  return err(
    'action_forbidden',
    `the extra action ${granted} handed ${id} is not the ${ACTION_TITLES[as]} action`,
  );
}

/** Which slot the caller is offering to pay a Disengage out of. */
export interface DisengageOptions extends AllowanceChoice {
  /**
   * SRD Conjure Woodland Beings: "you can take the Disengage action **as a
   * Bonus Action** for the spell's duration."
   *
   * Absent means what the book charges, which is an Action — so an allowance
   * a caller never invokes changes nothing, and the engine never quietly
   * spends a slot nobody named. Stating one the caller does not hold is a
   * rules-legal refusal (`action_not_allowed`), not a silent downgrade to the
   * ordinary price: a caller asking for the Bonus Action wanted to keep the
   * Action, and charging it anyway would be the wrong answer told quietly.
   */
  readonly from?: ActionSlot;
}

/**
 * SRD Disengage: "your movement doesn't provoke Opportunity Attacks for the
 * rest of the current turn."
 */
export function takeDisengage(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
  options: DisengageOptions = {},
): Result<GameEvent[]> {
  return once(state, `disengage:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (state.combat === null) {
      return err('not_in_combat', 'there are no Opportunity Attacks to avoid outside combat');
    }

    // SRD Conjure Woodland Beings: "you can take the Disengage action as a
    // Bonus Action for the spell's duration." **The caller asks for the
    // cheaper price and the engine rules on whether they may have it** — an
    // allowance nobody invokes changes nothing, exactly as a Dodge nobody
    // takes does, and the engine never spends a slot the caller did not name.
    const from: ActionSlot = options.from ?? 'action';

    // **A price with no spender is refused, not quietly rounded to the
    // ordinary one.** The ternary below charges an Action for anything that
    // is not a Bonus Action, so a caller asking to Disengage out of their
    // Reaction used to have their *Action* taken — the substitution the
    // options type promises never to make, arriving through a fall-through.
    // `STATABLE_PRICES` is the one map of what a command will charge, and
    // `checkSpellDefinition` refuses an allowance against the same one; this
    // is the door, because a caller may state a price with no definition
    // anywhere in it.
    if (from !== 'action' && !isStatablePrice('disengage', from)) {
      return err(
        'no_such_price',
        `Disengage cannot be paid for out of ${from}; this command charges an action, or a Bonus Action where something has allowed it`,
      );
    }
    const priced: GameEvent[] = [];
    if (from !== 'action') {
      const allowed = allowsPrice(
        id,
        'disengage',
        from,
        actionRulesOn(state, id),
        choiceOf(options),
      );
      if (!allowed.ok) return allowed;
      const price = priceOfAllowance(creature.resources, id, allowed.value, 'disengage');
      if (!price.ok) return price;
      priced.push(...price.value);
    }

    const spend = { rules: actionRulesOn(state, id), as: 'disengage' as const };
    const granted = from === 'action' ? options.usingFeature : undefined;
    const mismatch = refuseGrantMismatch(state, id, granted, 'disengage');
    if (mismatch !== null) return mismatch;
    const spent =
      from === 'bonus-action'
        ? spendBonusAction(state.combat, id, creature.conditions, spend)
        : spendAction(state.combat, id, creature.conditions, spend, granted);
    if (!spent.ok) return spent;
    const taken = disengage(spent.value, id);
    if (!taken.ok) return taken;

    return ok([
      from === 'bonus-action'
        ? { type: 'bonus-action-spent', id }
        : { type: 'action-spent', id, ...(granted === undefined ? {} : { grant: granted }) },
      ...priced,
      { type: 'disengage-taken', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

/** Which line the caller is taking, by the heading the block prints it under. */
/**
 * What a stated line hands the turn, where its sentence is a move — W7-B9.
 *
 * Two of the book's sentences under these headings are SRD rules the engine
 * already spends, at a heading's price:
 *
 * - **a jump bought** — SRD Bulette's Leap, "jumps up to 30 feet by spending
 *   10 feet of movement", which is SRD *Jump*'s allowance. `GrantedJump`
 *   carries both numbers for the spell and `checkJump` reads it; what the
 *   heading adds is the lifetime, and it is the one the hit riders file: a
 *   `grants` deadline at the end of the current turn, so the jump is this
 *   turn's and not every later turn's for free.
 * - **a move granted** — SRD Giant Seahorse's Bubble Dash, SRD Weretiger's
 *   Prowl and the three Charges, which are SRD Tactical Shift's sentence at
 *   a heading's price: feet handed to the turn under the line's own source,
 *   the printed fraction of the printed Speed pinned at the spend, and spent
 *   by a move that names the line (`MoveCommand.usingLine`). Where the book
 *   offers two Speeds the larger is pinned and the move re-checks the cap
 *   against the one it names. Prowl's "can take the Hide action" is an extra
 *   action narrowed to the Hide — the vocabulary SRD Patient Defense's Dodge
 *   already uses — priced from the Bonus Action this spend already cost.
 *
 * The clauses the line hands over — "While underwater", "straight toward an
 * enemy it can see" — come back for the table with the spend, so a caller is
 * told what was applied and what was not. A line that is neither returns
 * nothing and the caller's blanket hand-over stands.
 */
function grantsOfPrintedLine(
  state: GameState,
  id: CharacterId,
  line: StatedAction | StatedBonusAction,
): Result<{ readonly events: GameEvent[]; readonly unverified: string[]; readonly applied: boolean }> {
  const events: GameEvent[] = [];
  const unverified: string[] = [];
  const source = printedLineSource(id, line.name);

  if (line.jumps !== undefined) {
    const deadline = schedule(state, { kind: 'grants', on: id, source }, endOfCurrentTurn);
    if (!deadline.ok) return deadline;
    events.push(
      {
        type: 'jump-allowance-granted',
        id,
        allowance: { source, feet: line.jumps.feet, costsMovement: line.jumps.costsMovement },
      },
      deadline.value,
    );
  }

  if (line.dashes !== undefined) {
    const { fraction, modes, thenHide, handedOver } = line.dashes;
    // The largest of the Speeds the line names, pinned: SRD Xorn's "its Speed
    // or Burrow Speed" is one grant, and the move names which it took.
    const feet = Math.max(
      ...modes.map((mode) => {
        const whole = speedOf(state, id, mode);
        return fraction === 'half' ? Math.floor(whole / 2) : whole;
      }),
    );
    if (feet > 0) {
      events.push({ type: 'movement-granted', id, source, feet });
    } else {
      unverified.push(`${line.name} moves ${id} up to a fraction of a Speed it has none of; nothing was handed over`);
    }
    if (thenHide === true) {
      events.push({ type: 'turn-budget-granted', id, source, action: { only: ['hide'] } });
    }
    for (const clause of handedOver) {
      unverified.push(
        `${line.name}: "${clause}" is the table's to judge; the engine hands the move over as the line prints it and applies the rest`,
      );
    }
  }

  // **The move and the swing a blow on a Bloodied creature buys** — SRD Gnoll
  // Warrior's Rampage and SRD Giant Hyena's. The trigger is read here and
  // nowhere else, because it is the one thing about this line that is not a
  // grant: "immediately after dealing damage to a creature that is **already**
  // Bloodied" is a fact about a blow that has already landed, and
  // `LastDamage.wasBloodied` is the record of it. A line taken without the
  // trigger is refused rather than granted-and-reported, because the whole
  // sentence is conditional on it. (W7-B11)
  if (line.rampages !== undefined) {
    const { fraction, attack, attacks } = line.rampages;
    const mauled = bloodiedByThisTurn(state, id);
    if (mauled === null) {
      return err(
        'no_bloodied_blow',
        `${line.name} follows a blow ${id} has dealt this turn to a creature that was already Bloodied, and there has been none`,
      );
    }
    const whole = speedOf(state, id);
    const feet = fraction === 'half' ? Math.floor(whole / 2) : whole;
    if (feet > 0) {
      events.push({ type: 'movement-granted', id, source, feet });
    } else {
      unverified.push(
        `${line.name} moves ${id} up to a fraction of a Speed it has none of; nothing was handed over`,
      );
    }
    events.push({
      type: 'turn-budget-granted',
      id,
      source,
      attacks: { remaining: attacks, unarmedOnly: false },
    });
    // **Which attack is reported rather than enforced.** `GrantedAttacks`
    // narrows by `unarmedOnly` and by nothing else — the SRD's own narrowing
    // and the only one printed anywhere — so a grant that claimed to hold the
    // swing to one heading would be a field nothing reads.
    unverified.push(
      `${line.name} follows ${id}'s blow on ${mauled} and buys ${attacks === 1 ? 'one' : String(attacks)} ${attack} attack${attacks === 1 ? '' : 's'}; the engine hands the turn ${attacks} attack outside the Attack action and does not hold the swing to that heading`,
    );
  }

  // **The light a use switches on, and which this same use switches off** — SRD
  // Magmin's Ignited Illumination: "The magmin sets itself ablaze or
  // extinguishes its flames." One sentence and one line for both directions, so
  // the direction is read off the world rather than stated: a magmin that is
  // ablaze puts itself out, and one that is not lights up. What the events flip
  // is `activeFeatures`, because the light is a `light` standing grant gated on
  // this line being active — the shape `activatedLight` reads and SRD Sacred
  // Weapon's glow already compiles to. No patch is written anywhere: `lightAt`
  // derives it from the sheet on every read. (W7-B11)
  if (line.togglesLight !== undefined) {
    // **The key is read off the sheet**, where the adapter put it, rather than
    // rebuilt here: it is derived from the *stat block's* id and this command
    // holds the creature's. One string, minted once, and no second spelling of
    // the rule that mints it.
    const glow = (state.creatures[id]?.sheet.standing ?? []).find(
      (effect) => effect.name === line.name && effect.grant.kind === 'light',
    );
    if (glow === undefined) {
      unverified.push(
        `${line.name} switches a light on and this creature's sheet carries none for it; nothing was lit`,
      );
    } else {
      const ablaze = state.creatures[id]?.activeFeatures.includes(glow.feature) === true;
      events.push(
        ablaze
          ? { type: 'feature-ended', id, feature: glow.feature, reason: 'dismissed' }
          : { type: 'feature-activated', id, feature: glow.feature },
      );
      unverified.push(
        ablaze
          ? `${line.name} put ${id}'s flames out; the light it was shedding is gone`
          : `${line.name} set ${id} ablaze; the light it sheds is on until the line is taken again`,
      );
    }
  }

  return ok({
    events,
    unverified,
    applied:
      line.jumps !== undefined ||
      line.dashes !== undefined ||
      line.rampages !== undefined ||
      line.togglesLight !== undefined,
  });
}

/**
 * Somebody this creature has damaged **this turn** who was already Bloodied
 * when the blow landed, or null.
 *
 * SRD Rampage's trigger, and the whole of it. Three facts and every one of them
 * is already in state: who dealt the damage, when, and whether the creature was
 * past half its Hit Points *before* it — see `LastDamage.wasBloodied`, which is
 * why `isBloodied` asked now would be the wrong question.
 *
 * "Immediately after" is read the way {@link damageWindowOpen} reads it and for
 * the same reason: the finest grain the engine has for *now* is the turn, and
 * outside combat the clock stands in for it. A gnoll whose Bonus Action comes
 * after a round has gone by has missed the moment.
 *
 * The creatures are asked in id order so two victims in one turn give one
 * answer rather than whichever the record happened to hold first; which of them
 * is named changes nothing mechanical and it is reported, so a stable order is
 * what keeps two replays from reading differently.
 */
/**
 * The clause a heading printed that the engine could **not** turn into a gate,
 * as the sentence a door hands back — or null.
 *
 * SRD prints "Requires X" on two headings and the adapter compiles a gate for
 * one of them: the Night Hag's "Requires Soul Bag" names the noun of her own
 * `carries-printed-object` trait, and the Erinyes' "Requires Magic Rope" names a
 * rope nothing in the game holds. Refusing that line for ever would be a printed
 * action nothing could ever take; performing it silently would be the engine
 * claiming to have checked. So it is performed and *said*, which is what
 * `unverified` is for and what every other unenforceable fact about a heading
 * already gets. See `carryingRequirement`. (W7-B11)
 */
function unenforcedRequirementOf(line: {
  readonly name: string;
  readonly requires?: readonly StandingRequirement[];
  readonly requiresObject?: string;
}): string | null {
  const wanted = line.requiresObject;
  if (wanted === undefined) return null;
  if ((line.requires ?? []).some((one) => one.kind === 'while-carrying')) return null;
  return `${line.name} requires ${wanted}, and nothing on this creature's block gives it one — whether it still has ${wanted} is the table's`;
}

/**
 * Why this creature may not take the line its heading put a condition on, or
 * null.
 *
 * SRD Night Hag: "Nightmare Haunting (1/Day; **Requires Soul Bag**)".
 * `requirementsHold` is the reader — the same one a standing effect, a strike
 * style and a granted spell route are asked through — so "does this creature
 * still have the thing" has exactly one answer however it is asked, and all four
 * doors that spend a heading ask it.
 *
 * **It reads the compiled requirement and never the heading's word**, which is
 * what keeps it from refusing a line the engine cannot check: the book prints the
 * clause on two headings and only one of them names a thing the game holds, so
 * the adapter compiles a gate for one and `unenforcedRequirementOf` says the
 * other out loud. See `carryingRequirement`.
 *
 * The **source** handed to it is the line's own name, which is what
 * `while-worn` and `while-attuned` would look an item up by. Neither of those is
 * a requirement a heading can carry, so nothing reads it here; a homebrew
 * heading that asked for one would withhold rather than grant, which is the
 * conservative direction `requirementsHold` already documents.
 *
 * The reason names the requirement in the book's own words where it can, because
 * a caller told only "unmet" cannot go and do anything about it. (W7-B11)
 */
function missingRequirementFor(
  state: GameState,
  id: CharacterId,
  line: { readonly name: string; readonly requires?: readonly StandingRequirement[] },
): string | null {
  if (line.requires === undefined || line.requires.length === 0) return null;
  if (requirementsHold(state, id, line.requires, line.name)) return null;
  const carrying = line.requires.find((one) => one.kind === 'while-carrying');
  return carrying === undefined
    ? `${line.name} states a condition ${id} does not meet`
    : `${line.name} requires ${carrying.object}, and ${id} has none`;
}

function bloodiedByThisTurn(state: GameState, id: CharacterId): CharacterId | null {
  for (const key of Object.keys(state.creatures).sort()) {
    const hurt = state.creatures[key]?.lastDamage ?? null;
    if (hurt === null || hurt.by !== id || hurt.wasBloodied !== true) continue;
    if (hurt.turn !== (state.combat?.turnsTaken ?? null)) continue;
    if (hurt.elapsed !== state.elapsed) continue;
    return key as CharacterId;
  }
  return null;
}

export interface StatedBonusActionCommand extends CommandIdentity {
  readonly line: string;
}

export interface StatedBonusActionOutcome {
  readonly events: readonly GameEvent[];
  /**
   * What the line says, handed back rather than applied — see
   * `AttackResolution.unverified`.
   *
   * **Always, and that is the whole report.** The SRD prints seventy-five of
   * these lines and the engine executes none of them: they cast a spell, force
   * a saving throw, take another action, move, shape-shift, teleport, or are
   * prose. A spend that said only "the Bonus Action is gone" would leave a
   * caller believing the creature had done something.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Take one of the lines a creature's stat block prints under **Bonus
 * Actions**.
 *
 * It spends the Bonus Action, writes down which line was taken, and hands the
 * sentence back. It executes nothing: a line that casts Misty Step does not
 * cast it here, a line that forces a save does not roll it, and a line that
 * says the creature Dashes does not Dash — those are seven mechanisms wearing
 * one heading, and half of one of them would be worse than none. Making the
 * spend visible is what this is for, because until it existed the seventy-five
 * lines the book prints were a section of the stat block nothing above the
 * engine could touch.
 *
 * **Which line is recorded because something reads it.** A Multiattack the
 * book gates on one — "three Slam attacks if it used Hasten this turn" — has
 * no other way to ask, and the ledger it asks is the once-per-turn one every
 * other per-turn count already uses.
 *
 * **A heading that carries a recharge is spent once.** SRD *Monsters*: "a
 * monster can use the stat block part once", and thirteen of the book's Bonus
 * Action lines print the notation. So the line is checked against what this
 * creature has expended, refused with what would bring it back, and written
 * down as spent beside the Bonus Action it cost.
 *
 * **And a heading that prints *N/Day* is spent a stated number of times.**
 * "Divine Aid (2/Day)", "Misty Step (3/Day)" — twelve of the book's Bonus
 * Action lines, which is more than any other section carries. It is a
 * different rule from the recharge and it is checked in the same place: a
 * count of what this creature has used today against the number the block
 * prints, before the economy, refused with the clock that clears it. The two
 * checks never both bite, because no SRD heading prints both notations.
 */
export function takeStatedBonusAction(
  state: GameState,
  id: CharacterId,
  command: StatedBonusActionCommand,
): Result<StatedBonusActionOutcome> {
  return once(
    state,
    `stated-bonus-action:${id}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no Bonus Action to spend outside combat');
      }

      // Read off the sheet, which is where `creature-added` pinned the block's
      // own lines; nothing here opens a catalogue and nothing branches on the
      // name it finds.
      const line = statedBonusActionOf(creature.sheet, command.line);
      if (line === null) {
        return err(
          'no_such_line',
          `no Bonus Action called ${command.line} is printed on this creature's stat block`,
        );
      }

      // **A line the block prints for one of its forms only.** SRD Weretiger:
      // "Prowl (Tiger or Hybrid Form Only)", which is the one Bonus Action in
      // the book that prints the clause. Before the economy, for the reason
      // everything on this command is.
      const wrongForm = wrongFormFor(creature, line);
      if (wrongForm !== null) return err('wrong_form', wrongForm);

      // **And what the heading requires**, asked here for the reason the form
      // is: four doors spend one heading and they must not disagree about
      // whether it may be taken. No SRD Bonus Action prints the clause; a
      // homebrew one would. (W7-B11)
      const missing = missingRequirementFor(state, id, line);
      if (missing !== null) return err('requirement_unmet', missing);

      // **A line already used and not yet back.** Before the economy, because
      // a refusal after the Bonus Action is gone is a refusal with a
      // footprint — the rule every other argument on this command follows.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }

      // **And a line whose day's worth is gone.** The book's other notation,
      // on the other clock, refused in the same place and for the same reason
      // — before the economy, so the refusal has no footprint. No SRD heading
      // prints both, so the order of the two checks settles nothing.
      //
      // The count is a `Tally` tagged `dawn`, which is the shape `resources.ts`
      // already holds; the *ceiling* is the block's, read off the sheet here,
      // because a tally has none and its own doc says whoever reads the count
      // decides what a high one costs.
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      // SRD: "You can't take more than one Bonus Action on a turn", which is
      // the primitive's own rule and the reason nothing else has to say it —
      // so a second line in one turn is refused here, whichever line it is.
      const spent = spendBonusAction(state.combat, id, creature.conditions, {
        rules: actionRulesOn(state, id),
      });
      if (!spent.ok) return spent;

      // What the line hands the turn, where its sentence is a move — W7-B9.
      const granted = grantsOfPrintedLine(state, id, line);
      if (!granted.ok) return granted;

      return ok({
        events: [
          { type: 'bonus-action-spent', id },
          // SRD *Monsters*: "a monster can use the stat block part once."
          // Only where the block prints the notation — an ordinary line is
          // taken every turn and writes nothing here.
          ...(recharge === null
            ? []
            : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
          // And one of the day's uses, where the block prints a number of
          // them. The event a tally is already counted through — nothing new
          // in the union, and the morning that clears it is the
          // `resources-restored` a dawn already writes.
          ...(perDay === null
            ? []
            : [
                {
                  type: 'resource-spent' as const,
                  id,
                  key: perDayTallyKey(line.name),
                  amount: 1,
                  tally: 'dawn' as const,
                },
              ]),
          {
            type: 'stated-bonus-action-taken',
            id,
            // The **printed** heading rather than what the caller typed, so the
            // log and the block say the same string however it was asked for.
            line: line.name,
            turn: state.combat.turnsTaken,
            ...(stamp === null ? {} : { command: stamp }),
          },
          ...granted.value.events,
        ],
        // A line whose sentence the engine applied says only what it did not;
        // every other line is handed over whole, as it always was.
        unverified: [
          ...(granted.value.applied
            ? granted.value.unverified
            : [`${id}'s block prints "${line.name}: ${line.text}" — the engine does not apply that; a DM does`]),
          // And the clause the heading printed that the engine could not gate
          // on — W7-B11. Said rather than enforced, because enforcing it would
          // refuse a printed line for ever.
          ...(unenforcedRequirementOf(line) === null ? [] : [unenforcedRequirementOf(line)!]),
        ],
        duplicate: false,
      });
    },
  );
}

/** Which line the caller is taking, by the heading the block prints it under. */
export interface StatedActionCommand extends CommandIdentity {
  readonly line: string;
}

export interface StatedActionOutcome {
  readonly events: readonly GameEvent[];
  /**
   * What the line says, handed back rather than applied — see
   * {@link StatedBonusActionOutcome.unverified}, which this is the other half
   * of.
   *
   * **Always, and that is the whole report.** Two hundred-odd of these lines
   * are printed across a third of the SRD's bestiary and *this command*
   * executes no part of any of them: they cast a spell, shape-shift, swallow,
   * teleport, force a saving throw, or are prose. A spend that said only "the
   * Action is gone" would leave a caller believing the creature had done
   * something.
   *
   * **The last of those is no longer only handed over**, which is the one
   * qualification this paragraph owes: a line whose sentence is the book's
   * save template carries a DC and dice the engine can roll, and
   * {@link forcePrintedSave} is the door that rolls them. This command is
   * still the door that does not, for every line including that one — a DM
   * who would rather adjudicate the breath has lost nothing — so what comes
   * back here is still the whole sentence and still a claim about nothing.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Take one of the lines a creature's stat block prints under **Actions** that
 * the parser read nothing out of.
 *
 * The Actions section's other half. A line the parser *read* is an attack and
 * `resolveAttack` takes it, at the numbers the block prints; this is every
 * other line under that heading — and until it existed they were a section of
 * the stat block a caller could see named and could not touch, which is the
 * absence `takeStatedBonusAction` was written to close one section along.
 *
 * It spends the Action, writes down which line was taken, and hands the
 * sentence back. It executes nothing: a line that breathes a Cone of cold does
 * not roll the save, a line that says the creature casts a spell does not cast
 * it, and a line that swallows somebody moves nobody. Those are seven
 * mechanisms wearing one heading, and half of one of them would be worse than
 * none.
 *
 * **A second line on the same turn is refused by the economy**, which is the
 * one place that rule lives: a creature takes one Action on a turn, and
 * `spendAction` has always said so. Nothing is written into the once-per-turn
 * ledger, because nothing reads it — the gate a Multiattack prints names a
 * Bonus Action.
 *
 * **A heading that carries a recharge is spent once.** SRD *Monsters*: "a
 * monster can use the stat block part once", and seventy-one of these lines
 * print the notation — most of the book's, and every one of them inert until
 * something could expend a line by taking it. So the line is checked against
 * what this creature has expended, refused with what would bring it back, and
 * written down as spent beside the Action it cost.
 *
 * **And a per-day limit is enforced too**, which is the gap its Bonus Action
 * sibling used to name beside it: an *N/Day* notation is a different rule on a
 * different clock — a count between dawns, not a die at a boundary — so it is
 * a count checked against the number the block prints, refused in the same
 * position, and cleared by a sunrise rather than by a rest. Ten of these lines
 * print one.
 */
export function takeStatedAction(
  state: GameState,
  id: CharacterId,
  command: StatedActionCommand,
): Result<StatedActionOutcome> {
  return once(
    state,
    `stated-action:${id}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no Action to spend outside combat');
      }

      // Read off the sheet, which is where `creature-added` pinned the block's
      // own lines; nothing here opens a catalogue and nothing branches on the
      // name it finds.
      const line = statedActionOf(creature.sheet, command.line);
      if (line === null) {
        // **It says what was searched and claims nothing about where else the
        // heading might be.** Four things reach this refusal — a heading no
        // block prints, an attack, a sequence, and a line printed under
        // another section — and a reason that named only the first of them
        // would be telling a caller its Multiattack is an attack.
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions with nothing the engine could read beneath it; a heading the parser did read, and a heading printed under another section, are each taken by the command that owns them`,
        );
      }

      // **A line the block prints for one of its forms only.** SRD Vampire:
      // "Grave Strike (Vampire Form Only)". Before the economy for the reason
      // everything on this command is: a refusal after the Action is gone is a
      // refusal with a footprint.
      const wrongForm = wrongFormFor(creature, line);
      if (wrongForm !== null) return err('wrong_form', wrongForm);

      // **And a line the heading says needs something.** SRD Night Hag:
      // "Nightmare Haunting (1/Day; Requires Soul Bag)", asked through the one
      // reader every standing requirement is asked through, and in the same
      // position and for the same reason as the form above it. (W7-B11)
      const missing = missingRequirementFor(state, id, line);
      if (missing !== null) return err('requirement_unmet', missing);

      // **A line already used and not yet back.** Before the economy, because
      // a refusal after the Action is gone is a refusal with a footprint — the
      // rule every other argument on this command follows.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }

      // **And a line whose day's worth is gone.** Ten of these lines print the
      // other notation — a Dretch's Fetid Cloud, a Treant's Animate Trees, a
      // Sphinx's Roar — and it is a different clock: a count between dawns
      // rather than a die at a boundary. Refused in the same position and for
      // the same reason, before the economy; counted as a `dawn` tally, with
      // the ceiling read off the block. See `perDayTallyKey`.
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      const spent = spendAction(state.combat, id, creature.conditions, {
        rules: actionRulesOn(state, id),
      });
      if (!spent.ok) return spent;

      // What the line hands the turn, where its sentence is a move — W7-B9.
      // SRD Seahorse prints its Bubble Dash under this heading.
      const granted = grantsOfPrintedLine(state, id, line);
      if (!granted.ok) return granted;

      return ok({
        events: [
          { type: 'action-spent', id },
          // SRD *Monsters*: "a monster can use the stat block part once."
          // Only where the block prints the notation — an ordinary line is
          // taken every turn and writes nothing here.
          ...(recharge === null
            ? []
            : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
          // And one of the day's uses, where the block prints a number of
          // them — a `dawn` tally, counted through the event tallies already
          // use. See `perDayTallyKey`.
          ...(perDay === null
            ? []
            : [
                {
                  type: 'resource-spent' as const,
                  id,
                  key: perDayTallyKey(line.name),
                  amount: 1,
                  tally: 'dawn' as const,
                },
              ]),
          {
            type: 'stated-action-taken',
            id,
            // The **printed** heading rather than what the caller typed, so the
            // log and the block say the same string however it was asked for.
            line: line.name,
            ...(stamp === null ? {} : { command: stamp }),
          },
          ...granted.value.events,
        ],
        unverified: [
          ...(granted.value.applied
            ? granted.value.unverified
            : [`${id}'s block prints "${line.name}: ${line.text}" — the engine does not apply that; a DM does`]),
          // And the clause the heading printed that the engine could not gate
          // on — W7-B11. Said rather than enforced, because enforcing it would
          // refuse a printed line for ever.
          ...(unenforcedRequirementOf(line) === null ? [] : [unenforcedRequirementOf(line)!]),
        ],
        duplicate: false,
      });
    },
  );
}

/** Which line the caller is forcing, and who it caught. */
export interface PrintedSaveCommand extends CommandIdentity {
  readonly line: string;
  /**
   * The creatures the line reached, named by the caller.
   *
   * **The one fact the table supplies, and it is not a number the engine
   * owns.** "Each creature in a 15-foot Cone" wants an origin and a facing
   * nobody has declared, and a Cone measured out of a sentence would be the
   * Engine inventing a fact rather than adjudicating one. So the head count
   * is the DM's decision — the kind their door is *for* — and everything a
   * die decides stays here. Absent or empty is asked about rather than
   * refused, because a missing fact is not a wrong one.
   */
  readonly targets?: readonly CharacterId[];
  /**
   * The creatures named here **consent** to the line.
   *
   * SRD Vampire Spawn's Bite: "one creature within 5 feet **that is willing**
   * or that has the Grappled, Incapacitated, or Restrained condition." The
   * three conditions are the engine's own to check and willingness is nobody's
   * but the table's — a creature holding still for a bite is fiction, and no
   * state this engine keeps could answer it.
   *
   * **A decision the rules leave open, which is what a DM's door is for**, and
   * it is said about the creatures rather than about the call: a line may
   * catch several, and "everybody here agreed" is not what the sentence means.
   * Absent is the ordinary case, and a line whose targeting clause names no
   * such restriction never reads it.
   */
  readonly willing?: readonly CharacterId[];
  /**
   * The worn or held object the line targets, by its catalogue id.
   *
   * SRD Rust Monster's Antennae: "one nonmagical metal object—armor or a
   * weapon—worn or carried by a creature within 5 feet of itself." The
   * template names the holder and the prelude names a thing, and a creature
   * may be wearing mail and holding a sword — so which the antennae touch is
   * the table's decision, exactly as the head count is, and a call on such a
   * line that names none is asked. One the target is not wearing or holding is
   * refused before anything is spent.
   */
  readonly object?: string;
}

/**
 * What the line did to one creature standing in it.
 *
 * **Declared beside the executor rather than here**, because the same record
 * comes back from a save a *moment* forced — see `forcePrintedSaveOn`, which
 * is the one body both doors land through. Re-exported so nothing above the
 * engine has to learn that it moved.
 */
export type { PrintedSaveOnACreature } from './printed-save-clauses.js';

export interface PrintedSaveOutcome {
  readonly events: readonly GameEvent[];
  /** One entry per creature named, in the order the caller named them. */
  readonly outcomes: readonly PrintedSaveOnACreature[];
  /**
   * The part of the line the engine did not settle — always the targeting
   * clause, because who stands in a Cone is the table's answer and the
   * caller's list is what it said.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Force the saving throw a creature's stat block prints, at the DC and dice
 * the block prints.
 *
 * `_Dexterity Saving Throw:_ DC 12, each creature in a 15-foot Cone.
 * _Failure:_ 17 (5d6) Fire damage. _Success:_ Half damage.` is a template as
 * regular as `_Melee Attack Roll:_`, printed on a third of the bestiary, and
 * every number in it is the book's. A DC the caller stated would be a caller
 * stating the rules, and a die face the caller stated would be worse; both
 * come out of the block and out of `rolls.ts` respectively.
 *
 * **It is the second door on one line, not a replacement for the first.**
 * {@link takeStatedAction} and {@link takeStatedBonusAction} spend the slot
 * and hand the sentence back, for every line including this one, and they
 * still do — a DM who would rather adjudicate the breath themselves has lost
 * nothing. This door is for the caller that wants the engine to roll, and it
 * refuses `line_states_no_save` for a line whose sentence says something the
 * reader could not structure.
 *
 * **The economy is the one the hand-over door already spends**, in the same
 * order and for the same reason: the recharge and the day's uses are checked
 * *before* the slot, so a refusal leaves no footprint, and the same event goes
 * into the log, because the same line was taken.
 *
 * **Which slot is the heading's answer, not this command's.** The book writes
 * the template under **Actions** and under **Bonus Actions** — the Gorgon's
 * Trample, the Elephant's, the Mammoth's — and a heading in a stat block says
 * what the line under it costs. So both sections are searched, Actions first,
 * and the spend and the event follow the section the line was found in:
 * `takeStatedAction`'s pair for one, `takeStatedBonusAction`'s for the other.
 *
 * **No Reaction window opens**, which is the stated limit every spell's
 * damage already records: `dealSpellDamage` is the path, Uncanny Dodge
 * answers a sword, and a breath weapon is not one. So nothing here can close
 * a `damage-rolled` a defender was offered — there is none to close, and the
 * fold's one-held-roll rule is never asked to hold a Cone's worth.
 *
 * SRD Evasion is read off each **target**, because it is a defence: the
 * Rogue standing in the Cone is the one who evades it, exactly as they evade
 * a Fireball.
 */
export function forcePrintedSave(
  state: GameState,
  id: CharacterId,
  command: PrintedSaveCommand,
  supply: Supply,
): Result<PrintedSaveOutcome> {
  return once(
    state,
    `printed-save:${id}`,
    command,
    () => ({ events: [], outcomes: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        // Which slot the line costs is the heading's answer and the heading
        // has not been read yet, so the refusal names neither.
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      // Read off the sheet, where `creature-added` pinned the block's own
      // lines; nothing here opens a catalogue and nothing branches on a name.
      //
      // **Two sections, because the book writes the template under both.**
      // The Gorgon's Trample is a Bonus Action and the Winter Wolf's breath is
      // an Action, and what the heading changes is what the line *costs* —
      // which is exactly what is read off it below and nothing else. Actions
      // first, and no SRD block prints one heading under both — which is a
      // fact about the transcription and is asserted over the corpus in
      // `packages/srd/src/parse/monster-saves.test.ts` rather than assumed
      // here, because Actions winning a collision silently would refuse a
      // savable Bonus Action line with `line_states_no_save`.
      const action = statedActionOf(creature.sheet, command.line);
      const bonus = action === null ? statedBonusActionOf(creature.sheet, command.line) : null;
      const line: StatedAction | StatedBonusAction | null = action ?? bonus;
      if (line === null) {
        // **A trait's heading is looked up before the refusal is written**, so
        // a caller who names a Death Burst is told *why* rather than told the
        // block does not print it. The block does print it; it is a line
        // nobody spends, which is the next refusal down and a different
        // instruction to the caller.
        if (printedSaveOf(creature.sheet, command.line) !== null) {
          return err(
            'save_is_triggered',
            `${command.line} is forced by a moment rather than by a use — the engine raises it when that moment comes and rolls it with the saves a boundary owes; nobody spends it`,
          );
        }
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions with nothing the engine could read beneath it; a heading the parser did read as an attack, and a heading printed under another section, are each taken by the command that owns them`,
        );
      }

      // **And what the heading requires**, before the save and before the
      // economy: this is the door the Erinyes' Entangling Rope actually comes
      // through, and four doors on one heading must not disagree about whether
      // it may be taken. (W7-B11)
      const missingHere = missingRequirementFor(state, id, line);
      if (missingHere !== null) return err('requirement_unmet', missingHere);

      const printed = line.save;
      if (printed === undefined) {
        return err(
          'line_states_no_save',
          `${line.name} states no saving throw this engine could read; take it with the door that hands the sentence over, and a DM applies what it says`,
        );
      }

      // **A line that moves first is not a save over a head count** — W7-B9.
      // SRD Bulette's Deadly Leap and SRD Centaur Trooper's Trampling Charge
      // roll their save for each creature whose space the mover entered, and
      // the lattice decides who that was; a caller naming targets here would
      // be a Trample nobody moved for. `takePrintedMove` is the door.
      if (printed.movesThen !== undefined) {
        return err(
          'line_moves_first',
          `${line.name} moves ${id} before its save, and who it catches is whoever's space was entered; take it with the door that moves the creature, and name the destination or the route rather than the targets`,
        );
      }

      // **A line whose save a *moment* forces is not a line a creature takes.**
      // SRD Magmin's Death Burst goes off when the magmin dies and SRD Ghast's
      // Stench catches whoever begins a turn in it; a door that spent an Action
      // to set either off would be a creature detonating itself on purpose.
      // The fold raises those and `resolvePendingSaves` rolls them, which is
      // the split this whole family is built on: raising is derived, rolling is
      // commanded.
      if (printed.trigger !== undefined) {
        return err(
          'save_is_triggered',
          `${line.name} is forced by a moment rather than by a use — the engine raises it when that moment comes and rolls it with the saves a boundary owes; nobody spends it`,
        );
      }

      // **The one word the block declined to print**, asked for before
      // anything is spent: a refusal after the Action is gone is a refusal
      // with a footprint, which is the order the recharge and the day's uses
      // are already checked in below.
      const withType = withDeclaredDamage(state, id, line.name, printed);
      if (!withType.ok) return withType;
      const answered = withType.value;

      // Who it caught, which is the table's to say. Asked for rather than
      // refused: a head count nobody has stated is a fact that is missing
      // rather than a call that is wrong.
      const targets = command.targets ?? [];
      if (targets.length === 0) {
        return needsContext(
          'undeclared_targets',
          `${line.name} reads "${printed.targets}", and nobody has said which creatures that is`,
          [
            {
              kind: 'creature',
              subject: id,
              need: `the creatures ${line.name} caught — the line reads "${printed.targets}"`,
              because:
                'an area is measured from an origin and a facing the engine has not been told; the saving throws are its own',
              satisfyWith: 'forcePrintedSave again with its targets filled in',
            },
          ],
        );
      }
      for (const target of targets) {
        if (state.creatures[target] === undefined) return unknownCreature(target);
      }

      // **Who the line may be forced on at all**, where the targeting clause
      // says — SRD Vampire Spawn's Bite: "one creature within 5 feet that is
      // willing or that has the Grappled, Incapacitated, or Restrained
      // condition." The conditions are the engine's own; the willingness is
      // the table's, and a fact nobody has stated is *asked for* rather than
      // decided, which is the reading `undeclared_targets` above already takes.
      const restriction = printed.onlyIfTargetHas;
      if (restriction !== undefined) {
        const consenting = command.willing ?? [];
        const ineligible = targets.filter(
          (target) =>
            !consenting.includes(target) &&
            !restriction.conditions.some((condition) =>
              hasCondition(state.creatures[target]!.conditions, condition),
            ),
        );
        if (ineligible.length > 0) {
          const held = restriction.conditions.join(', ');
          return restriction.orWilling === true
            ? needsContext(
                'undeclared_consent',
                `${line.name} reaches "${printed.targets}", and ${ineligible.join(', ')} holds none of ${held} — nobody has said whether they are willing`,
                ineligible.map((target) => ({
                  kind: 'creature' as const,
                  subject: target,
                  need: `whether ${target} is willing to let ${id} do this`,
                  because: `${line.name} reaches a creature that is willing or that has one of ${held}, and ${target} has none of them`,
                  satisfyWith: `forcePrintedSave again naming ${target} in its willing list`,
                })),
              )
            : err(
                'target_not_eligible',
                `${line.name} reaches "${printed.targets}", and ${ineligible.join(', ')} holds none of ${held}`,
              );
        }
      }

      // **The object the line is aimed at**, where the line names one. SRD
      // Rust Monster's Antennae reaches "one nonmagical metal object—armor or
      // a weapon—worn or carried by a creature", and the save is the holder's:
      // which thing is the table's to say, asked for rather than guessed at,
      // and one the target is not wearing or holding is refused here, before
      // anything is spent, rather than reported after the Action is gone.
      if (printed.targetsObject === true) {
        if (command.object === undefined) {
          return needsContext(
            'undeclared_object',
            `${line.name} wears down an object its target is wearing or holding, and nobody has said which`,
            targets.map((target) => ({
              kind: 'creature' as const,
              subject: target,
              need: `which of ${target}'s worn or held objects ${line.name} is aimed at`,
              because: `${line.name} reaches "${printed.targets}" — a creature may be wearing mail and holding a sword, and the line touches one of them`,
              satisfyWith: 'forcePrintedSave again with its object filled in',
            })),
          );
        }
        const empty = targets.filter(
          (target) =>
            !(state.creatures[target]?.equipped ?? []).some((held) => held.id === command.object),
        );
        if (empty.length > 0) {
          return err(
            'object_not_held',
            `${empty.join(', ')} ${empty.length === 1 ? 'is' : 'are'} not wearing or holding ${command.object}, and ${line.name} reaches an object worn or carried`,
          );
        }
      }

      // **A creature that bought a day's grace from this very line.** SRD
      // Ghost: "_Success:_ The target is immune to this ghost's Horrific
      // Visage for 24 hours." Skipped rather than saved against — the line
      // does not reach them at all — and *named*, the honesty an immune
      // target already gets.
      //
      // **The line is still taken even where it reaches nobody**, which is
      // the reading rather than a gap: the creature swept the Cone, and what
      // that costs is the Action the heading names. A recharge or a day's use
      // would go with it — no SRD line that grants this immunity prints
      // either, and a homebrew one that did would be spending on a room that
      // had already learned to look away, which is what the book describes.
      // **A hold already as full as the line allows** — W7-B10. SRD Shambling
      // Mound's Engulf: "can have only one creature Grappled by this action at
      // a time." SRD Water Elemental's Whelm: "one Large creature or up to two
      // Medium or smaller creatures at a time." Refused here, before anything
      // is spent, where the hold could reach *nobody* named; a line that could
      // hold some of those named is rolled, and the clause executor leaves the
      // rest unheld and says so.
      const capped = (answered.onFailure ?? []).find(
        (clause): clause is Extract<PrintedSaveEffect, { kind: 'condition' }> =>
          clause.kind === 'condition' && clause.escapeDc !== undefined && clause.capacity !== undefined,
      );
      if (capped?.capacity !== undefined) {
        const capacity = capped.capacity;
        const held = (Object.keys(state.creatures) as CharacterId[])
          .sort()
          .filter((who) => grapplesOn(state, who).some((grapple) => grapple.grappler === id))
          .map((who) => effectiveSizeOf(state, who) ?? 'medium');
        const roomFor = targets.some((target) =>
          roomInside(capacity, held, effectiveSizeOf(state, target) ?? 'medium'),
        );
        if (!roomFor) {
          return err(
            'holding_enough',
            `${id} already holds as many creatures as ${line.name} allows${held.length === 0 ? '' : ` (${held.length})`}, and none of ${targets.join(', ')} could be held`,
          );
        }
      }

      const shielded = printedLineSource(id, line.name);
      const immune = targets.filter((target) =>
        (state.creatures[target]?.lineImmunities ?? []).some((held) => held.source === shielded),
      );
      // **And a creature the line is still holding**, where the targeting
      // clause says so. SRD Gold Dragon Wyrmling's Weakening Breath: "each
      // creature that isn't currently affected by this breath". The fact is
      // the engine's — whether this line's own source is still hung on them —
      // so they are not asked to save again, and are named below rather than
      // silently dropped, the honesty an immune target already gets.
      const alreadyAffected =
        printed.onlyIfNotAffected === true
          ? targets.filter(
              (target) => !immune.includes(target) && affectedByPrintedLine(state, target, shielded),
            )
          : [];
      const caught = targets.filter(
        (target) => !immune.includes(target) && !alreadyAffected.includes(target),
      );
      /** Those the line did not reach at all, said out loud below. */
      const immuneToTheLine = immune;

      // **A line already used and not yet back**, and **a line whose day's
      // worth is gone** — both before the economy, because a refusal after
      // the Action is gone is a refusal with a footprint.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      // The slot the **heading** names: one Action on a turn, or the one
      // Bonus Action, each refused by the primitive that owns its rule.
      const spent =
        action !== null
          ? spendAction(state.combat, id, creature.conditions, {
              rules: actionRulesOn(state, id),
            })
          : spendBonusAction(state.combat, id, creature.conditions, {
              rules: actionRulesOn(state, id),
            });
      if (!spent.ok) return spent;

      const events: GameEvent[] = [
        action !== null
          ? { type: 'action-spent', id }
          : { type: 'bonus-action-spent' as const, id },
        // SRD *Monsters*: "a monster can use the stat block part once."
        ...(recharge === null
          ? []
          : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
        ...(perDay === null
          ? []
          : [
              {
                type: 'resource-spent' as const,
                id,
                key: perDayTallyKey(line.name),
                amount: 1,
                tally: 'dawn' as const,
              },
            ]),
        // The same event the door that hands the sentence over writes, because
        // the same line was taken — including the turn a Bonus Action line is
        // written down against, which is what a gated Multiattack reads.
        action !== null
          ? {
              type: 'stated-action-taken' as const,
              id,
              // The **printed** heading rather than what the caller typed.
              line: line.name,
              ...(stamp === null ? {} : { command: stamp }),
            }
          : {
              type: 'stated-bonus-action-taken' as const,
              id,
              line: line.name,
              turn: state.combat.turnsTaken,
              ...(stamp === null ? {} : { command: stamp }),
            },
      ];

      const outcomes: PrintedSaveOnACreature[] = [];
      // What the clauses could not settle on some target — a size gate that
      // spared a creature, a push with nowhere to push to.
      const unsettled: string[] = [];
      let current = events.reduce(applyEvent, state);
      // **Where the generator was before this command threw anything**, read
      // once and written back once at the end. Everything below draws from it
      // — a save for every creature the line caught, and a damage roll for
      // every one that did not walk away clean — so a single `rolls-issued`
      // covers the lot, which is `resolveEffects`' shape rather than `hide`'s
      // one-roll one.
      const issuedBefore = supply.issuer.count;

      for (const target of caught) {
        // **What happens to one creature is not this command's**, and never
        // was two implementations: the same body settles a save a moment
        // forced, so a Death Burst and a breath weapon halve on a success by
        // one rule rather than by two that could drift apart.
        const landed = forcePrintedSaveOn(
          current,
          id,
          target,
          line.name,
          answered,
          supply,
          command.object === undefined ? {} : { object: command.object },
        );
        if (!landed.ok) return landed;
        events.push(...landed.value.events);
        current = landed.value.events.reduce(applyEvent, current);
        unsettled.push(...landed.value.unverified);
        outcomes.push(landed.value.outcome);
      }

      // **The generator's position, written back where every other rolling
      // command writes it.** Without it this command threw a save and a
      // handful of damage dice, moved the generator, and told the log
      // nothing — so a session resumed from that log rebuilt the stream from
      // the seed and the *next* command drew the very same faces under the
      // very same roll ids. Rule 3 says a log folds to one state forever, and
      // a stream that silently rewinds is the one way that stops being true.
      // Latent because nothing above the engine imports this command yet —
      // `packages/tools` carries the door that hands the sentence over and
      // not the one that rolls it — so no log has been written with the hole
      // in it. That is why it is a defect fixed rather than a migration.
      if (supply.issuer.count > issuedBefore) {
        events.push({
          type: 'rolls-issued',
          count: supply.issuer.count - issuedBefore,
          rng: supply.rng.snapshot(),
        });
      }

      return ok({
        events,
        outcomes,
        // The clause the engine did not settle, said out loud in the channel
        // the whole sentence used to come back in. The caller named who was
        // caught; nothing here checked that answer against a map.
        unverified: [
          `${line.name} reads "${printed.targets}" — the engine rolled the save for the creatures named and measured no area; who stands in it is the table's`,
          // A creature the line could not reach at all, named rather than
          // silently dropped: the honesty an immune target already gets.
          ...immuneToTheLine.map(
            (target) =>
              `${target} is immune to ${id}'s ${line.name} for the rest of the day and was not asked to save`,
          ),
          // And one the line is still holding, which its own targeting clause
          // leaves out: "each creature that isn't currently affected".
          ...alreadyAffected.map(
            (target) =>
              `${target} is already under ${id}'s ${line.name} and the line reaches only creatures that are not — they were not asked to save again`,
          ),
          // The sentences the reader carried and did not read, handed over at
          // the moment of use exactly as a spell's unmodelled lines are: the
          // engine applied the rest of the line and says what it did not.
          ...(printed.handedOver ?? []).map(
            (sentence) => `${line.name}: "${sentence}" — the engine applied the rest of the line; this sentence is the table's`,
          ),
          // And the clause the heading printed that the engine could not gate
          // on — W7-B11: SRD Erinyes' "Requires Magic Rope" names a thing
          // nothing in the game holds, so it is said rather than enforced.
          ...(unenforcedRequirementOf(line) === null ? [] : [unenforcedRequirementOf(line)!]),
          ...unsettled,
        ],
        duplicate: false,
      });
    },
  );
}

/** Which legendary action the caller is taking, and at whom. */
export interface LegendaryActionCommand extends CommandIdentity {
  /** The heading the block prints the legendary action under. */
  readonly line: string;
  /**
   * Who the line is aimed at: the creature a Charging Horn strikes, or the
   * creature a Shimmering Shield covers. Absent on a shield, the holder covers
   * itself — "targets itself or one creature" — and absent on an attack the
   * caller is asked, because a swing at nobody is not a swing.
   */
  readonly target?: CharacterId;
}

export interface LegendaryActionOutcome {
  readonly events: readonly GameEvent[];
  /** How many uses are left after this one, out of the block's own number. */
  readonly usesLeft: number;
  /** The swing, where the line made one — null for a line that did not. */
  readonly attack: AttackResolution | null;
  /** What the engine could not settle: the move a Charging Horn hands the table. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Whether a turn has begun and **nothing on it has been spent yet**, which is
 * the engine's reading of "immediately after another creature's turn".
 *
 * A turn boundary is not a moment the state holds: `turn-advanced` folds to
 * the next creature's fresh budget, and "immediately after" is the stretch
 * before that creature does anything with it. So the moment is read off the
 * budget the way the fold hands one out — every slot still there, no foot
 * moved, no feature used — and it closes the instant any of them is spent.
 * The Reaction is deliberately not in the list: one may have been spent on
 * somebody else's turn, and that is not this creature acting on its own.
 */
const turnUntouched = (budget: TurnBudget): boolean =>
  budget.action &&
  budget.bonusAction &&
  budget.movementSpent === 0 &&
  budget.movementSegments.length === 0 &&
  budget.movementGained === 0 &&
  budget.grantedAttacks === null &&
  budget.attacksRemaining === null &&
  budget.spellSlotSpentOnTurn === null &&
  budget.freeInteraction &&
  !budget.disengaged &&
  Object.keys(budget.featureUsedOnTurn).length === 0;

/**
 * Take one of the legendary actions a creature's stat block prints.
 *
 * SRD *Monsters*: "_Legendary Action Uses: 3. Immediately after another
 * creature's turn, the unicorn can expend a use to take one of the following
 * actions. The unicorn regains all expended uses at the start of each of its
 * turns._"
 *
 * **The economy is a pool and a moment.** The pool is the block's, declared
 * when the creature arrived and refilled whole by `settleStartOfTurnLegendary`
 * at the holder's own turn; the moment is the boundary just after another
 * creature's turn ended, which the engine reads as a turn that has begun with
 * nothing spent on it ({@link turnUntouched}). On the holder's own turn, or
 * once the beginning creature has acted, the moment is closed — and before
 * anybody has taken a turn there has been no turn to come after.
 *
 * **What the two lines do is the engine's, and the move is the table's.**
 * SRD Unicorn's Charging Horn "moves up to half its Speed without provoking
 * Opportunity Attacks, and it makes one Radiant Horn attack": the swing goes
 * through `resolveAttack` as the block's own printed attack, free of the
 * Attack action exactly as an Opportunity Attack is, and the move is handed
 * over — feet a line hands over belong to a turn budget, and this is not the
 * holder's turn. Shimmering Shield's Temporary Hit Points are the block's
 * dice, granted with the owner's default lifetime (until spent or a Long
 * Rest, no span stated); its +2 is a bonus on a `grants` timer to the end of
 * the holder's next turn; and "can't take this action again until the start
 * of its next turn" is the `turn` recharge, expended here and given back by
 * the boundary.
 *
 * **Refused before anything is spent**, on every command's rule: the moment,
 * the line, the uses and the recharge are all checked ahead of the spend.
 */
export function takeLegendaryAction(
  state: GameState,
  id: CharacterId,
  command: LegendaryActionCommand,
  supply: Supply,
): Result<LegendaryActionOutcome> {
  return once(
    state,
    `legendary-action:${id}`,
    command,
    () => ({ events: [], usesLeft: 0, attack: null, unverified: [], duplicate: true }),
    (stamp) => {
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (creature.vitals.dead) return err('dead', `${id} is dead and takes no legendary action`);
      // SRD *Monsters*: "The monster can't take a Legendary Action if it has
      // the Incapacitated condition or is otherwise unable to take actions."
      // Asked here rather than left to the swing, because the Shield swings
      // nothing and the Horn is taken `free`, which is the road that skips the
      // Attack action's own capability check.
      if (isIncapacitated(effectiveConditions(state, id))) {
        return err('incapacitated', `${id} is Incapacitated and can take no legendary action`);
      }

      const line = legendaryLineOf(creature.sheet, command.line);
      if (line === null) {
        return err(
          'no_such_line',
          `no legendary action called ${command.line} is printed on ${id}'s block, or its sentence is one the engine could not read`,
        );
      }

      const combat = state.combat;
      if (combat === null) {
        return err('not_in_combat', 'a legendary action is taken immediately after another creature\'s turn, and no fight is running');
      }
      const current = currentCombatant(combat);
      if (current.id === id) {
        return err(
          'legendary_moment_closed',
          `it is ${id}'s own turn; a legendary action is taken immediately after another creature's turn`,
        );
      }
      const budget = combat.budgets[current.id];
      if (combat.turnsTaken === 0 || budget === undefined || !turnUntouched(budget)) {
        return err(
          'legendary_moment_closed',
          combat.turnsTaken === 0
            ? `no creature has finished a turn yet, so there is no turn for ${id} to act immediately after`
            : `${current.id} has already acted on this turn, so the moment immediately after the last turn ended has passed`,
        );
      }

      // SRD *Monsters*: "Only one of these actions can be taken at a time and
      // only after another creature's turn ends." The boundary is consumed by
      // the use: it is written down against the turn count in the holder's own
      // ledger, and a second use at the same count is refused. The next
      // boundary has a new count, so the record needs no release.
      if (!canUseFeatureThisTurn(combat, id, LEGENDARY_MOMENT)) {
        return err(
          'legendary_moment_closed',
          `${id} has already taken a legendary action at this turn's end; only one may be taken at a time, and the next comes after another creature's turn`,
        );
      }

      const left = remaining(creature.resources, LEGENDARY_POOL);
      if (left <= 0) {
        return err(
          'no_legendary_uses',
          `${id} has spent every legendary action use this round; they come back at the start of its next turn`,
        );
      }
      if (creature.expendedLines.includes(line.name)) {
        const recharge = line.recharge ?? null;
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${recharge === null ? '' : `: ${describeRecharge(recharge)}`}`,
        );
      }

      const printed = line.legendary;
      const target = command.target ?? (printed.kind === 'shield' ? id : undefined);
      if (target === undefined) {
        return needsContext(
          'undeclared_targets',
          `${line.name} makes an attack, and nobody has said at whom`,
          [
            {
              kind: 'creature',
              subject: id,
              need: `the creature ${line.name} is aimed at`,
              because: `${line.name} reads "${line.text}", and a swing at nobody is not a swing`,
              satisfyWith: 'takeLegendaryAction again with its target filled in',
            },
          ],
        );
      }
      if (state.creatures[target] === undefined) return unknownCreature(target);

      const events: GameEvent[] = [
        // The stamp rides here, because this is the one event the command
        // always emits whichever line was taken.
        {
          type: 'resource-spent',
          id,
          key: LEGENDARY_POOL,
          amount: 1,
          ...(stamp === null ? {} : { command: stamp }),
        },
        // The boundary consumed, in the holder's own ledger — see
        // `LEGENDARY_MOMENT`.
        { type: 'feature-used', id, feature: LEGENDARY_MOMENT, turn: combat.turnsTaken },
        ...(line.recharge === undefined
          ? []
          : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
      ];
      const unverified: string[] = [];
      let current2 = events.reduce(applyEvent, state);
      let attack: AttackResolution | null = null;
      // The inner commands' ids, derived from this one's so a retry of the
      // whole is a retry of each part — `releaseReady`'s split.
      const inner = (suffix: string): { commandId?: string } =>
        stamp === null ? {} : { commandId: `${stamp.id}:${suffix}` };

      if (printed.kind === 'attack') {
        // The move is the table's: feet a line hands over belong to a turn
        // budget, and this is not the holder's turn. Said out loud rather than
        // silently skipped, and the move command is where a DM makes it.
        if (printed.movesHalfSpeed === true) {
          unverified.push(
            `${line.name} lets ${id} move up to half its Speed without provoking Opportunity Attacks before the attack — the move is the table's, made with the move command; nothing here moved anybody`,
          );
        }
        // The block's own attack, through the ordinary command so every
        // derivation it makes applies here too — and free of the Attack
        // action, because the use above is what this costs.
        const swung = resolveAttack(
          current2,
          id,
          {
            target,
            weapon: null,
            action: printed.attack,
            free: true,
            ...inner('swing'),
          },
          supply,
        );
        if (!swung.ok) return swung;
        events.push(...swung.value.events);
        unverified.push(...swung.value.unverified);
        current2 = swung.value.events.reduce(applyEvent, current2);
        attack = swung.value;
      } else {
        // "one creature it can see within 60 feet of itself": the reach and
        // the sight, each reported where the engine cannot answer it, refused
        // where it can and the answer is no.
        if (target !== id) {
          const scene = state.scene;
          const apart = scene === null ? null : distanceBetween(scene, id, target);
          if (apart !== null && apart.ok && apart.value > printed.rangeFeet) {
            return err(
              'out_of_range',
              `${line.name} reaches a creature within ${printed.rangeFeet} feet, and ${target} is ${apart.value} feet away`,
            );
          }
          if (apart === null || !apart.ok) {
            unverified.push(
              `${line.name} reaches a creature within ${printed.rangeFeet} feet, and the engine could not measure to ${target} — the reach is the table's`,
            );
          }
          if (canSee(state, id, target) === null) {
            unverified.push(
              `${line.name} reaches a creature ${id} can see, and nobody has said whether it can see ${target} — declareSightBetween settles it`,
            );
          }
        }
        // The block's dice, thrown here and pinned as an amount: SRD "gains
        // 10 (3d6) Temporary Hit Points".
        const issuedBefore = supply.issuer.count;
        const rolled = rollRecorded(supply.issuer, supply.rng, printed.temporaryHitPoints.dice);
        if (!rolled.ok) return rolled;
        const amount = rolled.value.total + printed.temporaryHitPoints.flat;
        events.push({
          type: 'roll-recorded',
          who: id,
          label: `${line.name} (${printed.temporaryHitPoints.dice})`,
          natural: rolled.value.total,
          total: amount,
          contributions: [],
          outcome: `${amount} Temporary Hit Points`,
        });
        // The owner's ruling of 2026-09-18: no stated lifetime, so the points
        // last until spent or a Long Rest, which is what the plain grant does.
        const granted = grantTemporaryHpTo(current2, target, amount, inner('temp-hp'));
        if (!granted.ok) return granted;
        events.push(...granted.value);
        current2 = granted.value.reduce(applyEvent, current2);
        // "its AC increases by 2 until the end of the unicorn's next turn": a
        // flat bonus on the target under a grants timer anchored on the
        // holder's turn, released by the same deadline every other grant is.
        const source = `${printedLineSource(id, line.name)}:${supply.issuer.count}`;
        const timer = schedule(
          current2,
          { kind: 'grants', on: target, source },
          { kind: 'end-of-next-turn', of: id },
        );
        if (!timer.ok) return timer;
        events.push(
          {
            type: 'bonus-applied',
            id: target,
            bonus: {
              source,
              bonus: { source: line.name, flat: printed.armorClass },
              applies: ['ac'],
              direction: 'add',
            },
          },
          timer.value,
          {
            type: 'rolls-issued',
            count: supply.issuer.count - issuedBefore,
            rng: supply.rng.snapshot(),
          },
        );
      }

      return ok({
        events,
        usesLeft: left - 1,
        attack,
        unverified,
        duplicate: false,
      });
    },
  );
}

/** Which line the caller is taking, and where it is putting the creature. */
export interface PrintedTeleportCommand extends CommandIdentity {
  readonly line: string;
  /**
   * Where to, relative to something already established.
   *
   * **The one fact the table supplies, and it is not a number the engine
   * owns.** "An unoccupied space it can see" is a space out of several, and
   * the engine chooses none of them — the same boundary `eligibleTargets`
   * draws for targeting and `CastSpellRequest.teleportTo` draws for Misty
   * Step, which is the very same sentence about a caster. Absent is asked
   * about rather than refused, because a missing fact is not a wrong one.
   */
  readonly to?: Placement;
  /**
   * The two trees a stride is made between, for a line whose sentence is SRD
   * Dryad's Tree Stride — W7-B9: "If within 5 feet of a Large or bigger tree,
   * the dryad teleports to an unoccupied space within 5 feet of a second
   * Large or bigger tree that is within 60 feet of the previous tree."
   *
   * **A tree is a declared object** — `declareObject`, Large or bigger,
   * placed — because a tree can be burnt and a landmark cannot; that the
   * object is a tree is the table's, stated by naming it here. The engine
   * checks what the sentence prints: both sizes, the creature's distance from
   * the first, the two trees' distance from each other, and the landing's
   * distance from the second. Absent on such a line is asked about
   * (`undeclared_trees`); present on a line that steps between no trees is
   * ignored, because the line does not read it.
   */
  readonly via?: { readonly from: CharacterId; readonly to: CharacterId };
}

/**
 * Whether the two trees a stride names are trees the line may step between —
 * W7-B9.
 *
 * Objects, both; each at least the printed size; the first within the printed
 * reach of the creature and the second within the printed span of the first.
 * The landing is checked by the caller against the space `teleportTo` chose,
 * because the space is the geometry's answer and not the caller's claim.
 */
function checkTrees(
  state: GameState,
  id: CharacterId,
  line: string,
  stride: MonsterTreeStride,
  via: { readonly from: CharacterId; readonly to: CharacterId },
): Result<null> {
  for (const tree of [via.from, via.to]) {
    const record = state.creatures[tree];
    if (record === undefined) return unknownCreature(tree);
    if (record.creatureType !== OBJECT_CREATURE_TYPE) {
      return err(
        'not_a_tree',
        `${tree} is a creature, and ${line} steps between trees — a tree is a declared object, ${stride.treeSize} or bigger, that the table has named as one`,
      );
    }
    const size = effectiveSizeOf(state, tree) ?? 'medium';
    if (!sizeAtMost(stride.treeSize, size)) {
      return err('tree_too_small', `${line} steps between ${stride.treeSize} or bigger trees, and ${tree} is ${size}`);
    }
  }
  if (via.from === via.to) {
    return err('not_a_tree', `${line} steps to a second tree, and ${via.to} is the one ${id} is standing beside`);
  }
  const scene = sceneFor(state, id, `${id} to step between trees within`);
  if (!scene.ok) return scene;
  const near = distanceBetween(scene.value, id, via.from);
  if (!near.ok) return near;
  if (near.value > stride.fromWithin) {
    return err(
      'tree_out_of_reach',
      `${line} needs ${id} within ${stride.fromWithin} feet of a tree, and ${via.from} is ${near.value} feet away`,
    );
  }
  const apart = distanceBetween(scene.value, via.from, via.to);
  if (!apart.ok) return apart;
  if (apart.value > stride.treesWithin) {
    return err(
      'trees_too_far_apart',
      `${line} steps to a tree within ${stride.treesWithin} feet of the first, and ${via.to} is ${apart.value} feet from ${via.from}`,
    );
  }
  return ok(null);
}

export interface PrintedTeleportOutcome {
  readonly events: readonly GameEvent[];
  /** How far they went, on the same 5-foot lattice as everything else. */
  readonly feet: number;
  /** What the engine could not check — a sight clause nobody has declared. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Take the teleport a creature's stat block prints, at the distance it prints.
 *
 * SRD Blink Dog, Teleport (Recharge 4–6): "The dog teleports up to 40 feet to
 * an unoccupied space it can see." Every clause of that is a rule the engine
 * already holds, because SRD Misty Step prints the same sentence about a
 * caster and `teleportTo` is what settles it: the distance measured from where
 * the creature is standing, the space refused if somebody is in it or the
 * scene cannot contain it, and the declared sight of whatever the destination
 * is measured from.
 *
 * **The third door on one line, beside the two that already exist.**
 * {@link takeStatedAction} and {@link takeStatedBonusAction} spend the slot and
 * hand the sentence over, for every line including this one, and they still
 * do; {@link forcePrintedSave} rolls a save where the line forces one. This
 * one moves the creature, and it refuses `line_states_no_teleport` for a line
 * whose sentence says something else.
 *
 * **The economy is the one those doors already spend**, in the same order and
 * for the same reason: the recharge and the day's uses are checked *before*
 * the slot, so a refusal leaves no footprint, and the same events go into the
 * log, because the same line was taken. Which slot is the heading's answer —
 * the Blink Dog's is a Bonus Action and the Nalfeshnee's an Action — so both
 * sections are searched, Actions first.
 *
 * **Every refusal the destination can raise happens before the slot goes.**
 * `teleportTo` is pure and rolls nothing, so it is asked once over the world
 * as it stands and again over the world the spend leaves; the first asking is
 * what keeps "that space is 45 feet away" from being a refusal that has
 * already cost the creature its turn. That is the pre-flight `castOrRelease`
 * already runs for Misty Step, arrived at by the other road.
 *
 * Nothing is spent by the move itself: a teleport is not a move, so no Speed,
 * no Difficult Terrain and no Opportunity Attack — the list `teleportTo`'s own
 * note takes from the SRD rather than from taste.
 */
export function takePrintedTeleport(
  state: GameState,
  id: CharacterId,
  command: PrintedTeleportCommand,
): Result<PrintedTeleportOutcome> {
  return once(
    state,
    `printed-teleport:${id}`,
    command,
    () => ({ events: [], feet: 0, unverified: [], duplicate: true }),
    (stamp) => {
      // **The same two holds `relocateCreature` refuses**, because this is the
      // same authoritative position change: a declared move is an intent
      // `completeIfSettled` will later apply, and a held attack was measured
      // against where its target is standing.
      if (state.pendingMove !== null) {
        return err('move_pending', `${state.pendingMove.mover} is already mid-move; settle it first`);
      }
      if (state.pendingAttack !== null) {
        return err('attack_pending', 'a hit is waiting for its damage; settle it first');
      }

      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        // Which slot the line costs is the heading's answer and the heading
        // has not been read yet, so the refusal names neither.
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      // Read off the sheet, where `creature-added` pinned the block's own
      // lines. Actions first, for `forcePrintedSave`'s reason: the book writes
      // this sentence under both headings and what the heading changes is what
      // the line costs.
      const action = statedActionOf(creature.sheet, command.line);
      const bonus = action === null ? statedBonusActionOf(creature.sheet, command.line) : null;
      const line: StatedAction | StatedBonusAction | null = action ?? bonus;
      if (line === null) {
        // **It says what was searched and claims nothing about the rest of the
        // block.** The reason its two siblings give — "with nothing the engine
        // could read beneath it" — is false on this door, where the lines that
        // *are* found are precisely the ones something was read out of; a
        // caller who typed a Reaction's heading would be told the opposite of
        // what is true.
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions; a printed attack is taken by the command that swings it, and a heading printed under another section by the command that owns that one`,
        );
      }

      const printed = line.teleports;
      // The other teleport a line prints — W7-B9: SRD Dryad's Tree Stride,
      // whose two ends are trees rather than a distance from the creature.
      const stride = line.treeStride;
      if (printed === undefined && stride === undefined) {
        return err(
          'line_states_no_teleport',
          `${line.name} states no teleport this engine could read; take it with the door that hands the sentence over, and a DM applies what it says`,
        );
      }

      // **A line already used and not yet back**, and **a line whose day's
      // worth is gone** — both before the economy, because a refusal after the
      // slot is gone is a refusal with a footprint, and **before the
      // destination**, which is where this differs from `forcePrintedSave`
      // above: asking for a space is homework, and setting a caller homework
      // for a line the creature cannot use at all is an errand with nothing at
      // the end of it.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      // **The two trees, before the destination** — W7-B9 — because a stride
      // is measured from them and a landing asked for before the trees are
      // named is homework with nothing at the end of it.
      if (stride !== undefined) {
        if (command.via === undefined) {
          return needsContext(
            'undeclared_trees',
            `${line.name} steps ${id} from beside one ${stride.treeSize} or bigger tree to beside another within ${stride.treesWithin} feet of it, and nobody has said which trees`,
            [
              {
                kind: 'creature',
                subject: id,
                need: `the two trees ${id} steps between, each a declared object ${stride.treeSize} or bigger`,
                because: 'a tree is a thing the table has put in the scene and named as one; the engine holds no forest',
                satisfyWith: 'takePrintedTeleport again with `via` naming the tree beside the creature and the tree it steps to',
              },
            ],
          );
        }
        const trees = checkTrees(state, id, line.name, stride, command.via);
        if (!trees.ok) return trees;
      }

      // Where to, which is the table's to say. Asked for rather than refused:
      // a space nobody has named is a fact that is missing rather than a call
      // that is wrong.
      const destination = command.to;
      if (destination === undefined) {
        return needsContext(
          'undeclared_destination',
          stride !== undefined
            ? `${line.name} sends ${id} "to an unoccupied space within ${stride.toWithin} feet of a second … tree", and nobody has said which space`
            : `${line.name} sends ${id} "up to ${printed!.feet} feet to an unoccupied space it can see", and nobody has said which space`,
          [
            {
              kind: 'position',
              subject: id,
              need: `the space ${id} is teleporting to`,
              because:
                'the book offers a choice of unoccupied spaces and the engine makes none of them',
              satisfyWith: 'takePrintedTeleport again with its destination filled in',
            },
          ],
        );
      }

      // A stride's distance is from the second tree, checked below over the
      // space the geometry chose; a teleport's is from the creature, and the
      // sight clause is the teleport's alone.
      const relocation =
        stride !== undefined
          ? { placement: destination }
          : {
              placement: destination,
              within: printed!.feet,
              ...(printed!.mustSee ? { requiresSight: true as const } : {}),
            };

      // **The pre-flight, before anything is spent.** Pure, rolls nothing and
      // changes nothing, so asking twice costs the caller nothing and asking
      // once would cost them their turn.
      const reachable = teleportTo(state, id, relocation);
      if (!reachable.ok) return reachable;

      // "to an unoccupied space within 5 feet of a second … tree": the landing,
      // measured over the world the pre-flight leaves, against the tree named.
      if (stride !== undefined && command.via !== undefined) {
        const landed = reachable.value.events.reduce(applyEvent, state);
        const scene = sceneFor(landed, id, `${id} to land within`);
        if (!scene.ok) return scene;
        const gap = distanceBetween(scene.value, id, command.via.to);
        if (!gap.ok) return gap;
        if (gap.value > stride.toWithin) {
          return err(
            'landing_too_far_from_tree',
            `${line.name} lands ${id} within ${stride.toWithin} feet of ${command.via.to}, and that space is ${gap.value} feet from it`,
          );
        }
      }

      // The slot the **heading** names: one Action on a turn, or the one Bonus
      // Action, each refused by the primitive that owns its rule.
      const spent =
        action !== null
          ? spendAction(state.combat, id, creature.conditions, {
              rules: actionRulesOn(state, id),
            })
          : spendBonusAction(state.combat, id, creature.conditions, {
              rules: actionRulesOn(state, id),
            });
      if (!spent.ok) return spent;

      const events: GameEvent[] = [
        action !== null
          ? { type: 'action-spent', id }
          : { type: 'bonus-action-spent' as const, id },
        // SRD *Monsters*: "a monster can use the stat block part once."
        ...(recharge === null
          ? []
          : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
        ...(perDay === null
          ? []
          : [
              {
                type: 'resource-spent' as const,
                id,
                key: perDayTallyKey(line.name),
                amount: 1,
                tally: 'dawn' as const,
              },
            ]),
        // The same event the door that hands the sentence over writes, because
        // the same line was taken.
        action !== null
          ? {
              type: 'stated-action-taken' as const,
              id,
              // The **printed** heading rather than what the caller typed.
              line: line.name,
              ...(stamp === null ? {} : { command: stamp }),
            }
          : {
              type: 'stated-bonus-action-taken' as const,
              id,
              line: line.name,
              turn: state.combat.turnsTaken,
              ...(stamp === null ? {} : { command: stamp }),
            },
      ];

      // And the move itself, over the world the spend leaves — which is the
      // same world for every rule the geometry reads, and is asked again
      // rather than reused so that nothing here depends on that being true.
      const moved = teleportTo(events.reduce(applyEvent, state), id, relocation, stamp);
      if (!moved.ok) return moved;
      // SRD Magic Circle: a creature of the chosen type that "tries to use
      // teleportation … to do so … must first succeed on a Charisma saving
      // throw." `teleportTo` hands the demand back, and this door — like
      // `relocateCreature` — holds no dice to roll it with, so the crossing is
      // refused before the Bonus Action is spent rather than performed with
      // the save skipped. A spell's `teleport` effect is the road that rolls.
      if (moved.value.saveToCross !== undefined) {
        return err(
          'barred',
          `${id} is barred from crossing ${moved.value.saveToCross.spell} by anything but a teleport that first succeeds on a saving throw, and ${line.name} rolls none here`,
        );
      }

      return ok({
        events: [...events, ...moved.value.events],
        feet: moved.value.feet,
        unverified: moved.value.unverified.map((gap) => `${line.name}: ${gap}`),
        duplicate: false,
      });
    },
  );
}

export interface PrintedFormCommand extends CommandIdentity {
  readonly line: string;
  /**
   * Which form, by the word its own line prints it under — `wolf`, `hybrid`,
   * `object`, `true`.
   *
   * **The one fact the table supplies.** A line offers two, three or four
   * forms and the engine chooses none of them, exactly as it chooses none of
   * the spaces a printed teleport offers. Absent is asked about rather than
   * refused.
   */
  readonly form?: string;
  /**
   * Which size, where the form prints more than one.
   *
   * SRD Doppelganger: "a Medium or Small Humanoid" — one form at a choice of
   * sizes, and the choice is the table's for the reason the form itself is.
   * Ignored by every form that prints one size or none.
   */
  readonly size?: CreatureSize;
}

export interface PrintedFormOutcome {
  readonly events: readonly GameEvent[];
  /** The form now worn, as the line prints its name. */
  readonly form: string;
  /** The size that form leaves the creature, or null where the line prints none. */
  readonly size: CreatureSize | null;
  /** What the line said that the engine does not do — see `MonsterForms.handedOver`. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Take one of the forms a creature's own stat block prints.
 *
 * SRD Werewolf, Shape-Shift: "The werewolf shape-shifts into a Large
 * wolf-humanoid hybrid or a Medium wolf, or it returns to its true humanoid
 * form. Its game statistics, other than its size, are the same in each form.
 * Any equipment it is wearing or carrying isn't transformed."
 *
 * **The fourth door on one line**, beside {@link takeStatedAction} and
 * {@link takeStatedBonusAction}, which spend the slot and hand the sentence
 * over for every line including this one, {@link forcePrintedSave} and
 * {@link takePrintedTeleport}. This one changes the form, and it refuses
 * `line_states_no_form` for a line whose sentence says something else.
 *
 * **What it changes is three things and deliberately not a fourth.** The size,
 * which every printing but two names and which `effectiveSizeOf` then reads
 * for every Grapple, Shove and Hide; the Speeds, on the Imp and the Quasit,
 * which are the one thing those two sentences say changes; and the word the
 * block's own headings gate on, so a werewolf as a wolf may bite and may not
 * draw its longbow. What it does **not** touch is the inventory — "Any
 * equipment it is wearing or carrying isn't transformed" is a rule this engine
 * keeps by doing nothing at all — and nothing else on the sheet, because the
 * sentence says the statistics are the same.
 *
 * **The economy is the one the other doors spend**, in the same order and for
 * the same reason: the recharge and the day's uses before the slot, so a
 * refusal leaves no footprint, and the slot the *heading* names — the Imp's
 * and the Quasit's are Actions and the other eleven are Bonus Actions.
 */
export function takePrintedForm(
  state: GameState,
  id: CharacterId,
  command: PrintedFormCommand,
): Result<PrintedFormOutcome> {
  return once(
    state,
    `printed-form:${id}`,
    command,
    () => ({ events: [], form: '', size: null, unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. After the duplicate check, never before it.
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      // Actions first, for `takePrintedTeleport`'s reason: the book writes
      // this sentence under both headings and what the heading changes is what
      // the line costs.
      const action = statedActionOf(creature.sheet, command.line);
      const bonus = action === null ? statedBonusActionOf(creature.sheet, command.line) : null;
      const line: StatedAction | StatedBonusAction | null = action ?? bonus;
      if (line === null) {
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions; a printed attack is taken by the command that swings it, and a heading printed under another section by the command that owns that one`,
        );
      }

      const printed = line.forms;
      if (printed === undefined) {
        return err(
          'line_states_no_form',
          `${line.name} states no form this engine could read; take it with the door that hands the sentence over, and a DM applies what it says`,
        );
      }

      // **A line already used and not yet back**, and **a line whose day's
      // worth is gone** — both before the slot, because a refusal after the
      // slot is gone is a refusal with a footprint.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      // Which form, which is the table's to say — asked for rather than
      // refused, because a missing fact is not a wrong one.
      const stated = command.form;
      if (stated === undefined) {
        return needsContext(
          'undeclared_form',
          `${line.name} offers ${printed.forms.map((one) => one.name).join(', ')}, and nobody has said which`,
          [
            {
              kind: 'route',
              subject: id,
              need: `which form ${id} takes`,
              because: 'the line offers a choice of forms and the engine makes none of them',
              satisfyWith: 'takePrintedForm again with its form named',
            },
          ],
        );
      }

      const form = formNamed(printed, stated);
      if (form === null) {
        return err(
          'no_such_form',
          `${line.name} prints no form called ${stated}; it offers ${printed.forms
            .map((one) => one.name)
            .join(', ')}`,
        );
      }

      // Which size, where the form prints a choice of them. The same question
      // as the form itself, one level down, and asked the same way.
      if (form.sizes.length > 1 && command.size === undefined) {
        return needsContext(
          'undeclared_form_size',
          `${line.name} prints ${form.name} form at ${form.sizes.join(' or ')}, and nobody has said which`,
          [
            {
              kind: 'route',
              subject: id,
              need: `which size ${id}'s ${form.name} form is`,
              because: 'the line offers a choice of sizes and the engine makes none of them',
              satisfyWith: 'takePrintedForm again with its size named',
            },
          ],
        );
      }
      if (command.size !== undefined && !form.sizes.includes(command.size)) {
        return err(
          'size_not_printed',
          `${line.name} does not print ${form.name} form at ${command.size}${
            form.sizes.length === 0
              ? `: it prints no size for that form, which leaves ${id} the size its block states`
              : `: it prints ${form.sizes.join(' or ')}`
          }`,
        );
      }

      // The slot the **heading** names, refused by the primitive that owns
      // its rule.
      const spent =
        action !== null
          ? spendAction(state.combat, id, creature.conditions, {
              rules: actionRulesOn(state, id),
            })
          : spendBonusAction(state.combat, id, creature.conditions, {
              rules: actionRulesOn(state, id),
            });
      if (!spent.ok) return spent;

      // **Measured from what the creature was before any form**, so a werewolf
      // going wolf-to-hybrid is sized and sped from its own skin rather than
      // from the wolf's. The same original the fold keeps, read here because
      // the sheet is what the event pins.
      const base = creature.form?.original ?? {
        sheet: creature.sheet,
        size: creature.size,
        sceneSize: null,
      };
      const size = command.size ?? form.sizes[0] ?? base.size;
      const sheet = withFormSpeeds(base.sheet, form);

      return ok({
        events: [
          action !== null
            ? { type: 'action-spent', id }
            : { type: 'bonus-action-spent' as const, id },
          // SRD *Monsters*: "a monster can use the stat block part once."
          ...(recharge === null
            ? []
            : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
          ...(perDay === null
            ? []
            : [
                {
                  type: 'resource-spent' as const,
                  id,
                  key: perDayTallyKey(line.name),
                  amount: 1,
                  tally: 'dawn' as const,
                },
              ]),
          // The same event the door that hands the sentence over writes,
          // because the same line was taken.
          action !== null
            ? { type: 'stated-action-taken' as const, id, line: line.name }
            : {
                type: 'stated-bonus-action-taken' as const,
                id,
                line: line.name,
                turn: state.combat.turnsTaken,
              },
          {
            type: 'form-assumed' as const,
            id,
            form: form.name,
            line: line.name,
            sheet,
            size,
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        form: form.name,
        size,
        // What the line said that this does not do — the Succubus's Fly Speed
        // clause is the whole of it in the SRD, and it comes back at the
        // moment of use exactly as a printed save's residue does.
        unverified: printed.handedOver.map((gap) => `${line.name}: ${gap}`),
        duplicate: false,
      });
    },
  );
}

export interface PrintedPullCommand extends CommandIdentity {
  readonly line: string;
  /**
   * Whom to pull, for a line that pulls **one** creature its own web holds —
   * W7-B10, SRD Ettercap's Reel. Asked about where several are webbed and
   * nobody said; ignored by a line that pulls "each creature".
   */
  readonly target?: CharacterId;
}

export interface PrintedPullOutcome {
  readonly events: readonly GameEvent[];
  /** Who was dragged, in the order the roster names them. */
  readonly pulled: readonly CharacterId[];
  /** What the geometry could not answer — an unplaced creature, a scene nobody set. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Drag toward a creature everything its printed line says it is holding.
 *
 * SRD Roper, Reel: "The roper pulls each creature Grappled by it up to 30 feet
 * straight toward it." Both halves are rules the engine already holds — the
 * grapple is the one `escapeGrapple` answers, and `pullToward` is the
 * primitive SRD Merrow's rider goes through — so the line is the same
 * mechanism at the heading's price, and until this door existed the only thing
 * a caller could do with it was spend the Action and read it out.
 *
 * **The fifth door on one printed line**, and it refuses `line_pulls_nothing`
 * for a line whose sentence says something else. The Ettercap prints the same
 * heading over a different hold — "Restrained by its Web Strand" — and the
 * parser reads nothing out of it, so it lands on that refusal rather than
 * dragging somebody by a web the engine has no record of.
 *
 * **Every creature, in roster order, and nothing is rolled.** The book says
 * "each creature", so there is no choice for a caller to make and none is
 * taken; `pullToward` caps each at the gap, because a pull has only the space
 * between the two to travel into. A creature the geometry cannot answer for
 * comes back in `unverified` rather than refusing the whole line, which is the
 * reading the primitive's own note takes of a rider that has already landed.
 */
export function takePrintedPull(
  state: GameState,
  id: CharacterId,
  command: PrintedPullCommand,
): Result<PrintedPullOutcome> {
  return once(
    state,
    `printed-pull:${id}`,
    command,
    () => ({ events: [], pulled: [], unverified: [], duplicate: true }),
    (stamp) => {
      // **The same hold `relocateCreature` refuses**, because this is the same
      // authoritative position change: a held attack was measured against
      // where its target is standing.
      if (state.pendingMove !== null) {
        return err('move_pending', `${state.pendingMove.mover} is already mid-move; settle it first`);
      }
      if (state.pendingAttack !== null) {
        return err('attack_pending', 'a hit is waiting for its damage; settle it first');
      }

      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      const action = statedActionOf(creature.sheet, command.line);
      const bonus = action === null ? statedBonusActionOf(creature.sheet, command.line) : null;
      const line: StatedAction | StatedBonusAction | null = action ?? bonus;
      if (line === null) {
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions; a printed attack is taken by the command that swings it, and a heading printed under another section by the command that owns that one`,
        );
      }

      const printed = line.pulls;
      if (printed === undefined) {
        return err(
          'line_pulls_nothing',
          `${line.name} states no pull this engine could read; take it with the door that hands the sentence over, and a DM applies what it says`,
        );
      }

      const wrongForm = wrongFormFor(creature, line);
      if (wrongForm !== null) return err('wrong_form', wrongForm);

      // And what the heading requires, asked here for the reason the form is:
      // the two doors on one heading must not disagree about whether it may be
      // taken. (W7-B11)
      const missing = missingRequirementFor(state, id, line);
      if (missing !== null) return err('requirement_unmet', missing);

      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      // **Whom a web-keyed pull reaches, before anything is spent** — W7-B10.
      // SRD Ettercap's Reel: "one creature within 30 feet of itself that is
      // Restrained by its Web Strand." A creature held by an object *this*
      // creature spun — the object's id names its spinner — and within the
      // printed reach. One, and the caller says which where several qualify.
      let webbed: CharacterId | null = null;
      if (printed.of === 'web') {
        const scene = sceneFor(state, id, `${id} to reel from`);
        if (!scene.ok) return scene;
        const held = (Object.keys(state.creatures) as CharacterId[])
          .sort()
          .filter((who) =>
            state.creatures[who]!.conditions.instances.some((instance) => {
              const object = heldByObject(instance.source);
              return (
                object !== null &&
                isSpunBy(object, id) &&
                state.creatures[object] !== undefined &&
                !state.creatures[object]!.vitals.dead
              );
            }),
          )
          .filter((who) => {
            const apart = distanceBetween(scene.value, who, id);
            return apart.ok && apart.value <= (printed.within ?? 0);
          });
        if (command.target !== undefined) {
          if (!held.includes(command.target)) {
            return err(
              'not_held_by_web',
              `${line.name} pulls a creature within ${printed.within} feet that ${id}'s ${printed.heldBy} is holding, and ${command.target} is not one`,
            );
          }
          webbed = command.target;
        } else if (held.length === 1) webbed = held[0]!;
        else if (held.length === 0) {
          return err(
            'not_held_by_web',
            `${line.name} pulls a creature within ${printed.within} feet that ${id}'s ${printed.heldBy} is holding, and it is holding nobody in reach`,
          );
        } else {
          return needsContext(
            'undeclared_pull_target',
            `${line.name} pulls one creature ${id}'s ${printed.heldBy} is holding, and ${held.join(', ')} qualify; nobody has said which`,
            [
              {
                kind: 'creature',
                subject: id,
                need: `the creature ${id} reels in`,
                because: 'the book offers the choice to whoever runs the creature, and the engine makes none of them',
                satisfyWith: 'takePrintedPull again with its target filled in',
              },
            ],
          );
        }
      }

      // **A use the Attack action holds** — W7-B10. SRD Roper: "makes two
      // Tentacle attacks, uses Reel, and makes two Bite attacks." Where the
      // block's sequence names this line as a use, taking it spends a slot of
      // the Attack action rather than the Action itself, is held to the
      // composition exactly as a swing is, and is written into the same ledger
      // — so the fold spends the same slot off the same `attack-made`.
      const sequence = multiattackOf(creature.sheet);
      const asUse = action !== null && sequence !== null && multiattackUses(sequence, line.name);
      let slot: string | null = null;
      const events: GameEvent[] = [];
      if (asUse) {
        const budget = state.combat.budgets[id];
        const linesUsed = statedBonusActionsUsed(budget?.featureUsedOnTurn ?? {}, state.combat.turnsTaken);
        const made = usesMadeThisTurn(state.combat, id);
        const next = { ...made, [line.name]: (made[line.name] ?? 0) + 1 };
        if (budget?.attacksRemaining != null && !multiattackAllows(sequence, next, linesUsed)) {
          return err(
            'not_in_multiattack',
            `${id}'s block prints ${describeMultiattack(sequence)} in one action, and a use of ${line.name} is not what is left of it`,
          );
        }
        const spent = spendAttack(
          state.combat,
          id,
          attacksInAction(creature.sheet, creature.heads, linesUsed),
          creature.conditions,
          { rules: actionRulesOn(state, id) },
        );
        if (!spent.ok) return spent;
        slot = `${MULTIATTACK_LEDGER}${line.name}#${next[line.name]!}`;
        events.push({ type: 'attack-made', id });
      } else {
        const spent =
          action !== null
            ? spendAction(state.combat, id, creature.conditions, {
                rules: actionRulesOn(state, id),
              })
            : spendBonusAction(state.combat, id, creature.conditions, {
                rules: actionRulesOn(state, id),
              });
        if (!spent.ok) return spent;
        events.push(
          action !== null ? { type: 'action-spent', id } : { type: 'bonus-action-spent' as const, id },
        );
      }

      events.push(
        ...(slot === null ? [] : [{ type: 'feature-used' as const, id, feature: slot, turn: state.combat.turnsTaken }]),
        ...(recharge === null
          ? []
          : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
        ...(perDay === null
          ? []
          : [
              {
                type: 'resource-spent' as const,
                id,
                key: perDayTallyKey(line.name),
                amount: 1,
                tally: 'dawn' as const,
              },
            ]),
        action !== null
          ? { type: 'stated-action-taken' as const, id, line: line.name, ...(stamp === null ? {} : { command: stamp }) }
          : {
              type: 'stated-bonus-action-taken' as const,
              id,
              line: line.name,
              turn: state.combat.turnsTaken,
              ...(stamp === null ? {} : { command: stamp }),
            },
      );

      // **Sorted, and each pull measured over the world the last one left.**
      // Two creatures dragged toward one roper end up in different spaces
      // depending on the order they are dragged in, so the order is the
      // roster's rather than whatever `Object.keys` happened to give — the
      // same reason `settleSizes` walks a sorted list. A web-keyed line pulls
      // the one creature settled above.
      const held =
        webbed !== null
          ? [webbed]
          : Object.keys(state.creatures)
              .sort()
              .map((key) => asCharacterId(key))
              .filter((who) => grapplesOn(state, who).some((grapple) => grapple.grappler === id));

      const unverified: string[] = [];
      const pulled: CharacterId[] = [];
      let world = events.reduce(applyEvent, state);
      for (const who of held) {
        const drag = pullToward(world, who, id, { feet: printed.feet }, line.name);
        if (drag.events.length > 0) pulled.push(who);
        events.push(...drag.events);
        unverified.push(...drag.unverified);
        world = drag.events.reduce(applyEvent, world);
      }

      return ok({ events, pulled, unverified, duplicate: false });
    },
  );
}

/**
 * Whether a printed object was raised by this creature — W7-B10.
 *
 * `printedObjectId` writes `<noun>:<by>:<target>:<use>`, so the second segment
 * is the spinner; a web the ettercap spun is one whose id names the ettercap
 * there. Read off the id rather than off a record, because the id is the one
 * fact both the web's raising and this pull have in common.
 */
const isSpunBy = (object: CharacterId, by: CharacterId): boolean => object.split(':')[1] === by;

/**
 * The uses and swings of the Attack action so far this turn, by name — W7-B10.
 *
 * `attacksMadeThisTurn`'s reading in `commands/attacks.ts`, off the same
 * ledger and the same key, so a use the sequence names and a swing it names
 * are counted against one composition.
 */
function usesMadeThisTurn(
  combat: NonNullable<GameState['combat']>,
  id: CharacterId,
): Readonly<Record<string, number>> {
  const made: Record<string, number> = {};
  for (const [key, turn] of Object.entries(combat.budgets[id]?.featureUsedOnTurn ?? {})) {
    if (turn !== combat.turnsTaken || !key.startsWith(MULTIATTACK_LEDGER)) continue;
    const name = key.slice(MULTIATTACK_LEDGER.length, key.lastIndexOf('#'));
    made[name] = (made[name] ?? 0) + 1;
  }
  return made;
}

/**
 * The facts a printed casting states, which are the **casting's** own.
 *
 * Every stated fact a `CastSpellRequest` carries, less the ones a printed line
 * decides and a caller therefore may not: the spell is off the line's menu,
 * the price is the heading's, and neither a slot, a payment, a Ritual, an item
 * nor a held declaration is a thing a stat block offers. Omitted rather than
 * accepted-and-refused, because a field that cannot be honoured is a caller
 * who thinks they said something, and a type is the cheapest place to say so.
 *
 * `targets` is optional here and required there: a line whose spell reaches
 * nobody names none, and a line that needs them is *asked*, by the pipeline's
 * own `undeclared_targets`, before anything is spent.
 */
export type PrintedCastingFacts = Partial<
  Omit<
    CastSpellRequest,
    | 'spellId'
    | 'commandId'
    | 'slotLevel'
    | 'slotKind'
    | 'slotless'
    | 'payment'
    | 'ritual'
    | 'item'
    | 'charges'
    | 'source'
    | 'hold'
    | 'answers'
    | 'usingFeatures'
    | 'usingOptions'
  >
>;

/** Which line the caller is taking, which spell off it, and where it is aimed. */
export interface PrintedCastingCommand extends CommandIdentity {
  readonly line: string;
  /**
   * Which spell off the line's menu.
   *
   * **The one decision a cast line leaves open**, and the reason it is a
   * decision rather than a lookup: SRD Priest's Divine Aid offers four spells
   * for one use, and the engine picks none of them. Absent is asked about
   * rather than refused, because a choice nobody has made is a fact that is
   * missing rather than a call that is wrong — and a line offering one spell
   * is asked exactly as readily, so the caller and the log always agree about
   * which spell was cast.
   */
  readonly spell?: string;
  /** What the casting itself states — see {@link PrintedCastingFacts}. */
  readonly casting?: PrintedCastingFacts;
}

export interface PrintedCastingOutcome {
  readonly events: readonly GameEvent[];
  /**
   * The casting this made — see `SpellResolution.castingId`.
   *
   * **Null on a retry**, and that is the honest answer rather than a gap: the
   * event this command stamps is the line being taken, so the ledger remembers
   * which line and not which casting. A caller that needs the id on a replay
   * reads the `spell-cast` that follows the stamped `stated-action-taken` in
   * the log, which is where it is.
   */
  readonly castingId: string | null;
  readonly outcomes: readonly SpellTargetOutcome[];
  /** What the casting and the line between them left to the table. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Cast one of the spells a creature's stat block prints on a line, at the
 * heading's price and through the block's own numbers.
 *
 * SRD Priest, Divine Aid (3/Day), under **Bonus Actions**: "The priest casts
 * _Bless, Dispel Magic, Healing Word,_ or _Lesser Restoration,_ using the same
 * spellcasting ability as Spellcasting." Every part of that is a rule the
 * engine already holds — a menu, an ability, a printed save DC, a count
 * between dawns — so this door decides nothing about the spell: it settles
 * *which line*, *which spell* and *what the use costs*, and hands the rest to
 * the casting pipeline, which records the casting, takes the Concentration,
 * pins the DC and hangs the deadlines exactly as it does for a Wizard.
 *
 * **The fourth door on one line, beside the three that already exist.**
 * {@link takeStatedAction} and {@link takeStatedBonusAction} spend the slot and
 * hand the sentence over, for every line including this one, and they still
 * do; {@link forcePrintedSave} rolls a save where the line forces one;
 * {@link takePrintedTeleport} moves the creature. This one casts, and it
 * refuses `line_casts_nothing` for a line whose sentence says something else.
 *
 * **What the heading prices is the *use*, and that is why the route carries a
 * casting time.** Divine Aid is a Bonus Action offering *Bless*, whose own
 * casting time is an Action, and the only place a casting's slot is decided is
 * `castingOf` — so `GrantedSpell.castingTime` is read there and the pipeline
 * spends the Bonus Action the book printed. This command spends **no** slot of
 * its own; a door that did would charge the creature twice.
 *
 * **The economy it does spend is the one the hand-over door already spends**,
 * in the same order and for the same reason: the recharge and the day's uses
 * are checked before anything, so a refusal leaves no footprint, and the same
 * events go into the log, because the same line was taken. It is deliberately
 * *not* a pool on the grant — two ledgers for one heading is how a creature
 * comes to cast four Blesses out of a 3/Day line, once through each door.
 *
 * **"Requiring no spell components" is fiction here.** The engine models no
 * components at all, so the clause changes nothing it could check; it is said
 * in the note the casting hands back rather than enforced.
 *
 * **A line that casts on itself has no target to state.** SRD Imp, Quasit and
 * Sprite print "casts _Invisibility_ **on itself**", and the parser reads the
 * clause — so the target is fixed to the caster and a caller who named anybody
 * else is refused rather than quietly overruled.
 */
export function castPrintedLine(
  state: GameState,
  id: CharacterId,
  command: PrintedCastingCommand,
  supply: Supply,
): Result<PrintedCastingOutcome> {
  return once(
    state,
    `printed-casting:${id}`,
    command,
    () => ({ events: [], castingId: null, outcomes: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        // Which slot the line costs is the heading's answer and the heading
        // has not been read yet, so the refusal names neither. Refused for the
        // reason its three siblings refuse: a printed line is taken out of a
        // turn's economy, and the event that records one names the turn.
        return err('not_in_combat', 'there is no turn to spend a printed line from outside combat');
      }

      // Read off the sheet, where `creature-added` pinned the block's own
      // lines. Actions first, for `forcePrintedSave`'s reason: the book writes
      // cast lines under both headings — five under Actions and nine under
      // Bonus Actions — and what the heading changes is what the line costs.
      const action = statedActionOf(creature.sheet, command.line);
      const bonus = action === null ? statedBonusActionOf(creature.sheet, command.line) : null;
      const line: StatedAction | StatedBonusAction | null = action ?? bonus;
      if (line === null) {
        return err(
          'no_such_line',
          `no line called ${command.line} is printed under this creature's Actions or Bonus Actions; a printed attack is taken by the command that swings it, and a heading printed under another section by the command that owns that one`,
        );
      }

      const printed = line.casts;
      if (printed === undefined) {
        return err(
          'line_casts_nothing',
          `${line.name} casts no spell this engine could read; take it with the door that hands the sentence over, and a DM applies what it says`,
        );
      }

      // **Which spell, which is the line's one open decision.** Asked for
      // rather than guessed at even where the menu holds one entry: a caller
      // and a log that agree about which spell was cast is worth a round trip,
      // and a menu of four is a choice nobody here may make.
      const wanted = command.spell;
      if (wanted === undefined) {
        return needsContext(
          'undeclared_spell',
          `${line.name} casts one of ${printed.spells.join(', ')}, and nobody has said which`,
          [
            {
              kind: 'route',
              subject: id,
              need: `which of ${printed.spells.join(', ')} ${line.name} is casting`,
              because: 'the line offers a menu and the engine chooses none of it',
              satisfyWith: 'castPrintedLine again with its spell named',
            },
          ],
        );
      }
      if (!printed.spells.includes(wanted)) {
        return err(
          'spell_not_on_the_line',
          `${line.name} casts ${printed.spells.join(', ')}, and ${wanted} is not one of them`,
        );
      }

      // **The route the adapter compiled off this very line**, and the one
      // place this command learns whose ability and whose DC the casting uses.
      // Absent is a line the adapter **refused**, and the reason it refuses is
      // exactly the reason this must too: a block that casts "using the same
      // spellcasting ability as Spellcasting" and prints no Spellcasting line
      // has not said which ability, and the engine picking one would be the
      // engine inventing a number the book declined to print. The refusal
      // carries what the adapter said, off the creature's own caveats.
      const route = creature.spellcasting.granted.find(
        (grant) => grant.throughLine === line.name && grant.spellId === wanted,
      );
      if (route === undefined) {
        return err(
          'line_has_no_route',
          `${line.name} casts ${wanted} and this creature holds no route for it; the block declined to say something the casting needs — whose spellcasting ability, most often — and add_creature said so when it arrived`,
        );
      }

      // **The target the sentence fixed**, where it fixed one. A caller who
      // named somebody else is refused rather than overruled, which is the
      // reading every stated fact that cannot be honoured already gets.
      const stated = command.casting ?? {};
      const named = stated.targets ?? [];
      if (printed.selfOnly === true && named.some((target) => target !== id)) {
        return err(
          'line_casts_on_itself',
          `${line.name} casts ${wanted} on ${id} and on nobody else; ${named.filter((target) => target !== id).join(', ')} cannot be named`,
        );
      }
      // **And its mirror.** SRD Unicorn's Blessing touches "another creature"
      // and casts on that creature, which takes the caster out of the list the
      // spell would otherwise offer. Refused rather than quietly re-aimed, for
      // the reason above it: a stated fact that cannot be honoured is a call
      // that is wrong. (W7-B11)
      if (printed.notSelf === true && named.includes(id)) {
        return err(
          'line_casts_on_another',
          `${line.name} casts ${wanted} on another creature, so ${id} cannot be its own target`,
        );
      }

      // **A line already used and not yet back**, and **a line whose day's
      // worth is gone** — both before the casting, because a refusal after a
      // spell has landed is a refusal with a footprint, and both read off the
      // very ledger `takeStatedAction` reads, so two doors on one heading
      // cannot disagree about what is left of it.
      const recharge = line.recharge ?? null;
      if (creature.expendedLines.includes(line.name)) {
        return err(
          'line_expended',
          `${id} has used ${line.name} and not got it back${
            recharge === null ? '' : `: ${describeRecharge(recharge)}`
          }`,
        );
      }
      const perDay = line.perDay ?? null;
      const usedToday = tallied(creature.resources, perDayTallyKey(line.name));
      if (perDay !== null && usedToday >= perDay) {
        return err(
          'daily_limit_reached',
          `${id} has used ${line.name} ${usedToday} times today: ${describePerDay(perDay)}`,
        );
      }

      // **The casting, through the route the adapter compiled off this very
      // line.** No slot, no payment and no commandId of its own: the price is
      // the heading's and the identity is this command's, so exactly one stamp
      // rides this batch and a retry answers from the ledger above.
      const cast = castOrRelease(
        state,
        id,
        {
          ...stated,
          spellId: wanted,
          targets: printed.selfOnly === true ? [id] : named,
          // **The route the line holds open, named.** `routesFor` leaves it
          // out of what a casting finds for itself, because the price is the
          // heading's and a casting that reached it unasked would pay
          // nothing; `chooseRoute` looks a named source up directly, and this
          // is that name — read off the grant rather than rebuilt, so two
          // spellings of one key cannot drift apart.
          //
          // **Naming it is not enough on its own**, which is what keeps this
          // door the only road: the source is published, so `chooseRoute`
          // refuses it `route_through_line_only` without the licence below.
          source: route.source,
        },
        supply,
        null,
        // **The licence, and the reason the road is closed rather than
        // merely unsearched.** `chooseRoute` refuses a route a heading prices
        // unless the heading's own door says it is calling, and this is that
        // saying. It is an argument between engine functions and appears on no
        // request and no tool schema — a caller that could set it would be
        // granting itself the licence.
        { throughLine: line.name },
      );
      if (!cast.ok) return cast;

      // The same two events the hand-over door writes, because the same line
      // was taken — and only those two: the Action or the Bonus Action is the
      // casting's to spend, at the casting time the route stated.
      const events: GameEvent[] = [
        // SRD *Monsters*: "a monster can use the stat block part once."
        ...(recharge === null
          ? []
          : [{ type: 'printed-line-expended' as const, id, line: line.name }]),
        ...(perDay === null
          ? []
          : [
              {
                type: 'resource-spent' as const,
                id,
                key: perDayTallyKey(line.name),
                amount: 1,
                tally: 'dawn' as const,
              },
            ]),
        action !== null
          ? {
              type: 'stated-action-taken' as const,
              id,
              // The **printed** heading rather than what the caller typed.
              line: line.name,
              ...(stamp === null ? {} : { command: stamp }),
            }
          : {
              type: 'stated-bonus-action-taken' as const,
              id,
              line: line.name,
              turn: state.combat.turnsTaken,
              ...(stamp === null ? {} : { command: stamp }),
            },
      ];

      return ok({
        events: [...events, ...cast.value.events],
        castingId: cast.value.castingId,
        outcomes: cast.value.outcomes,
        unverified: [
          ...cast.value.unverified,
          // The one clause of the sentence the engine read and models nothing
          // of, said out loud at the moment of use rather than dropped at the
          // door — the discipline a spell's own unmodelled lines already keep.
          ...(/requiring no [A-Za-z ]+ components/.test(line.text)
            ? [
                `${line.name}: "requiring no spell components" — the engine models no components at all, so the clause changes nothing it could check`,
              ]
            : []),
          // And the clause the heading printed that the engine could not gate
          // on — W7-B11.
          ...(unenforcedRequirementOf(line) === null ? [] : [unenforcedRequirementOf(line)!]),
        ],
        duplicate: false,
      });
    },
  );
}

/**
 * SRD Dodge: "until the start of your next turn, any attack roll made against
 * you has Disadvantage if you can see the attacker, and you make Dexterity
 * saving throws with Advantage."
 *
 * An action anybody can take, so the benefits come out of `actions.ts` rather
 * than off a sheet — but everything else about it is the shape `activateFeature`
 * already has, including the turn-anchored deadline and the end when the
 * dodger is Incapacitated.
 */
/**
 * Which extra action a Dodge is coming out of, where it is coming out of one.
 *
 * A Dodge costs an Action and no allowance moves it — `STATABLE_PRICES` holds
 * no entry for one — so this command takes no slot. What it does take is the
 * other half of {@link AllowanceChoice}: SRD Patient Defense buys the Dodge
 * with the Disengage's Bonus Action and hands it to the turn, and this is how
 * the Monk spends what they already paid for.
 */
export interface DodgeOptions {
  readonly usingFeature?: string;
}

export function takeDodge(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
  options: DodgeOptions = {},
): Result<GameEvent[]> {
  return once(state, `dodge:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (creature.activeFeatures.includes(DODGE)) {
      return err('already_active', `${id} is already Dodging`);
    }

    const events: GameEvent[] = [];
    if (state.combat !== null && state.combat.budgets[id] !== undefined) {
      // A grant named by a caller who holds none is `no_such_grant` below;
      // one whose narrowing does not reach a Dodge is refused here, because
      // the reducer folds the spend and cannot know which action it was.
      const granted = options.usingFeature;
      const mismatch = refuseGrantMismatch(state, id, granted, 'dodge');
      if (mismatch !== null) return mismatch;
      const spent = spendAction(
        state.combat,
        id,
        creature.conditions,
        { rules: actionRulesOn(state, id), as: 'dodge' },
        granted,
      );
      if (!spent.ok) return spent;
      events.push({
        type: 'action-spent',
        id,
        ...(granted === undefined ? {} : { grant: granted }),
      });
    }

    events.push({
      type: 'feature-activated',
      id,
      feature: DODGE,
      ...(stamp === null ? {} : { command: stamp }),
    });

    const timer = featureTimer(state, id, DODGE_ACTION);
    if (!timer.ok) return timer;
    if (timer.value !== null) events.push(timer.value);

    return ok(events);
  });
}

/** SRD Hide: "you must succeed on a DC 15 Dexterity (Stealth) check". */
export const HIDE_DC = 15;

/**
 * The cover a Hide can be taken behind: "Three-Quarters Cover or Total Cover".
 *
 * Half Cover is the degree the sentence leaves out, and leaving it out is the
 * point — a +2 to Armour Class is not a thing you can disappear behind, and
 * reading the third degree in would print a better Hide than the book does.
 */
const HIDING_COVER: readonly CoverDegree[] = ['three-quarters', 'total'];

/**
 * A creature at least one size larger than the hider within five feet, where
 * the hider holds a grant that lets them hide behind one — or null.
 *
 * SRD Naturally Stealthy's sentence, read off the scene: the sizes are what
 * somebody said before what the map assumed, exactly as the attack path reads
 * a rider's size gate, and Medium is the map's default for an unstated one.
 */
function largerCreatureBeside(state: GameState, hider: CharacterId): CharacterId | null {
  const holds = standingFor(state, hider).some(
    ({ from, effect }) => from === hider && effect.grant.kind === 'hides-behind-larger-creature',
  );
  const scene = state.scene;
  if (!holds || scene === null) return null;
  const own = effectiveSizeOf(state, hider) ?? 'medium';
  for (const other of Object.keys(state.creatures).sort()) {
    if (other === hider) continue;
    const size = effectiveSizeOf(state, other as CharacterId);
    if (size === null || sizeAtMost(size, own)) continue;
    const apart = distanceBetween(scene, hider, other as CharacterId);
    if (apart.ok && apart.value <= 5) return other as CharacterId;
  }
  return null;
}

/**
 * What the Invisible condition a Hide buys is recorded under.
 *
 * A source string rather than a casting, for the reason every condition has
 * one: ending the hiding must lift *this* Invisible and leave the Greater
 * Invisibility somebody cast on the same creature exactly where it is.
 */
export const HIDE = 'action:hide';

export interface HideCommand extends CommandIdentity, AllowanceChoice {
  /**
   * SRD Cunning Action: "you can take the Hide action as a Bonus Action."
   *
   * The same parameter `takeDash` and `takeDisengage` take, refused the same
   * way: a price `STATABLE_PRICES` does not hold, or one nothing has allowed
   * this creature, is a refusal rather than a quiet charge of the Action.
   */
  readonly from?: ActionSlot;
  /**
   * SRD: "while you're **Heavily Obscured**" — and now only where nothing on
   * the lattice already says so.
   *
   * **P3-S took back what the old docstring said this cost.** It read: "the
   * log does not carry it … a reader of the log alone cannot tell this attempt
   * from one taken behind a wall. Whoever models obscurement takes it back."
   * A Heavily Obscured patch is a declared fact with an event behind it now —
   * `obscurement-declared`, or the darkness a `light-declared` implies — so a
   * Rogue standing in a Fog Cloud needs nothing on this command and the log
   * says why the Hide was legal.
   *
   * What it stays is the table's fact where the lattice holds none: the engine
   * still models no smoke nobody declared, and stating it here is the same
   * move `declaredFacts` makes for every clause a caster cannot see for
   * itself. Declared **or** derived, and either is enough.
   */
  readonly obscured?: boolean;
  /** Advantage or Disadvantage the table knows about and the engine does not. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Named modifiers the table supplies: Guidance's 1d4, a tool's bonus. */
  readonly bonuses?: readonly Bonus[];
}

export interface HideResolution {
  readonly events: readonly GameEvent[];
  /** The check, or null when this command id had already been applied. */
  readonly check: D20TestResult | null;
  /**
   * Whether **this attempt** hid them — false, like `check`, on a replay.
   *
   * A retry is told its command already landed rather than re-answered about
   * the world its own first run made, which is what `duplicate` is for: the
   * creature may well be hiding, and this did not do it.
   */
  readonly hidden: boolean;
  /**
   * What the engine could not check: a Hide allowed behind a larger creature
   * (SRD Naturally Stealthy) names the creature, because which watcher it
   * stands between the hider and is the table's.
   */
  readonly unverified?: readonly string[];
  /** True when this command id had already been applied. */
  readonly duplicate?: boolean;
}

/**
 * Whoever might catch this creature hiding.
 *
 * "Any enemy", read through the one allegiance fact the engine holds: a
 * creature on another declared side, and **a creature nobody has sided with
 * too**. That is the conservative direction and the reading `alliedWith`
 * already takes — "a creature nobody has placed on a side is nobody's ally" —
 * so an unsided goblin is asked about rather than quietly hidden from.
 *
 * Somebody on the floor is nobody's watcher: an Unconscious creature sees
 * nothing, and a dead one less. The same "on their feet" reading `endCombat`
 * takes of the same question.
 */
function watchersOf(state: GameState, hider: CharacterId): readonly CharacterId[] {
  const side = state.creatures[hider]?.side ?? null;
  return Object.keys(state.creatures)
    .sort()
    .flatMap((who) => {
      if (who === hider) return [];
      const creature = state.creatures[who as CharacterId];
      if (creature === undefined) return [];
      if (creature.vitals.dead || isDown(creature.vitals)) return [];
      if (side !== null && creature.side === side) return [];
      return [who as CharacterId];
    });
}

/**
 * SRD Hide: conceal yourself.
 *
 * > "With this action, you try to conceal yourself. To do so, you must succeed
 * > on a DC 15 Dexterity (Stealth) check while you're Heavily Obscured or
 * > behind Three-Quarters Cover or Total Cover, and you must be out of any
 * > enemy's line of sight."
 *
 * **The sixth named action, and the one that arrived with its own spender.**
 * `NAMED_ACTIONS` admits a member only where a command can be told it apart,
 * and Hide was out of the list for four batches because nothing took it —
 * which is what left SRD Cunning Action, Naturally Stealthy and Supreme Sneak
 * unexecuted however good the grant vocabulary got.
 *
 * **What is the table's and what is the engine's** is the whole of the design,
 * and it is the owner's ruling rather than this command's invention: who can
 * see the hider is declared, exactly as cover is declared and as sides are;
 * the check, the DC and the Invisible condition it buys are the engine's. So a
 * sight line nobody has settled is *homework* — `needs-context`, one request
 * per watcher — where a declared one that says the enemy is looking straight
 * at the hider is a refusal.
 *
 * **Nothing is rolled until the whole attempt is known to be legal**, which is
 * this repository's oldest discipline: the price, the watchers, the cover and
 * an immunity are all settled before the generator moves, so a refused Hide
 * costs neither the slot nor a turn of the dice.
 *
 * What ends it is **not** here, and the SRD's own sentence says why: the
 * condition ends when the creature makes a sound, attacks, casts a spell, or
 * is found by somebody's Search — four moments the table narrates. It is an
 * ordinary condition under an ordinary source, so `endConditionsOn` lifts it.
 */
export function takeHide(
  state: GameState,
  id: CharacterId,
  command: HideCommand,
  supply: Supply,
): Result<HideResolution> {
  return once(
    state,
    `hide:${id}`,
    command,
    () => ({ events: [], check: null, hidden: false, duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

      const from: ActionSlot = command.from ?? 'action';
      if (from !== 'action' && !isStatablePrice('hide', from)) {
        return err(
          'no_such_price',
          `Hide cannot be paid for out of ${from}; this command charges an action, or a Bonus Action where something has allowed it`,
        );
      }
      const rules = actionRulesOn(state, id);
      const priced: GameEvent[] = [];
      if (from !== 'action') {
        const allowed = allowsPrice(id, 'hide', from, rules, choiceOf(command));
        if (!allowed.ok) return allowed;
        const price = priceOfAllowance(creature.resources, id, allowed.value, 'hide');
        if (!price.ok) return price;
        priced.push(...price.value);
      }

      // Before the die, because a condition that could never land is a check
      // nobody should have to throw.
      if (conditionImmunitiesOf(state, id).includes('invisible')) {
        return err('immune', `${id} is immune to the Invisible condition, so hiding buys nothing`);
      }

      // Heavily Obscured, either way it can be true: what the table said on
      // this command, or what the lattice already holds over the hider's own
      // space. The **hider's** space and not a watcher's, because the clause
      // is about where they are hiding.
      const here = state.scene === null ? null : positionOf(state.scene, id);
      const obscured =
        command.obscured === true ||
        (here !== null && obscurementAt(state, here).degree === 'heavily');

      const watchers = watchersOf(state, id);
      if (state.scene === null && (watchers.length > 0 || !obscured)) {
        return needsContext(
          'no_scene',
          'hiding is about cover and sight lines, and there is no scene for either to be in',
          [
            {
              kind: 'scene',
              subject: id,
              need: 'a scene, so that cover and sight mean something',
              because: 'SRD Hide asks what is between the hider and whoever is looking',
              satisfyWith: 'a setScene command',
            },
          ],
        );
      }

      // — "out of any enemy's line of sight" —
      const unsettled: ContextRequest[] = [];
      for (const watcher of watchers) {
        const seen = canSee(state, watcher, id);
        if (seen === true) {
          return err('seen', `${watcher} can see ${id}, who is therefore not out of their sight`);
        }
        if (seen === null) {
          unsettled.push({
            kind: 'visibility',
            subject: watcher,
            need: `whether ${watcher} can see ${id}`,
            because: 'SRD Hide asks the hider to be out of any enemy\'s line of sight',
            satisfyWith: `a declareSightBetween command from ${watcher} to ${id}`,
          });
        }
      }
      if (unsettled.length > 0) {
        return needsContext(
          'undeclared_sight',
          `nobody has said whether ${unsettled.map((request) => request.subject).join(', ')} can see ${id}, and a Hide turns on it`,
          unsettled,
        );
      }

      // — "Heavily Obscured or behind Three-Quarters Cover or Total Cover" —
      //
      // Half Cover is deliberately not enough: the book names two degrees and
      // reading the third in would be a better Hide than the SRD prints.
      //
      // SRD Naturally Stealthy widens the test for its holder alone: "even
      // when you are obscured only by a creature that is at least one size
      // larger than you". A larger creature within five feet is the
      // obscurement; which watcher it stands between the hider and is the
      // table's, and is said so below.
      const screen = obscured ? null : largerCreatureBeside(state, id);
      if (!obscured && screen === null) {
        const scene = state.scene;
        const exposed =
          scene === null
            ? watchers
            : watchers.filter((watcher) => !HIDING_COVER.includes(coverBetween(scene, watcher, id)));
        if (watchers.length === 0 || exposed.length > 0) {
          return err(
            'not_concealed',
            watchers.length === 0
              ? `${id} has nobody to take cover from and nothing declared obscuring them; SRD Hide wants Heavily Obscured or Three-Quarters Cover, and cover is declared between two creatures`
              : `${id} is behind neither Three-Quarters nor Total Cover from ${exposed.join(', ')}, and nobody has said they are Heavily Obscured`,
          );
        }
      }

      const events: GameEvent[] = [];
      if (state.combat !== null && state.combat.budgets[id] !== undefined) {
        const spend = { rules, as: 'hide' as const };
        const granted = from === 'action' ? command.usingFeature : undefined;
        const mismatch = refuseGrantMismatch(state, id, granted, 'hide');
        if (mismatch !== null) return mismatch;
        const spent =
          from === 'bonus-action'
            ? spendBonusAction(state.combat, id, creature.conditions, spend)
            : spendAction(state.combat, id, creature.conditions, spend, granted);
        if (!spent.ok) return spent;
        events.push(
          from === 'bonus-action'
            ? { type: 'bonus-action-spent', id }
            : { type: 'action-spent', id, ...(granted === undefined ? {} : { grant: granted }) },
        );
        events.push(...priced);
      }

      // The check itself: the engine's ability, the engine's skill, the
      // engine's DC and the engine's die. What the caller may hand over is a
      // mode or a named bonus the table knows about, which is what every other
      // check in the engine already takes.
      const issuedBefore = supply.issuer.count;
      const fromFeatures = rollModesFor(state, {
        family: 'ability-check',
        roller: id,
        ability: 'dex',
        skill: 'stealth',
      }).modes;
      const sheet = sheetAsItStands(state, id) ?? creature.sheet;
      const rolled = rollAbilityCheck(supply.issuer, supply.rng, sheet, 'dex', {
        dc: HIDE_DC,
        skill: 'stealth',
        conditions: effectiveConditions(state, id),
        modes: [...fromFeatures, ...(command.modes ?? [])],
        bonuses: checkBonuses(state, id, command.bonuses, 'stealth'),
      });
      if (!rolled.ok) return rolled;

      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
      // The stamp rides the roll, which happens whether the Hide works or not:
      // stamping the condition would leave a failed attempt retryable and
      // rolled twice, which is `resolveAttack`'s reasoning about a miss.
      events.push({
        ...recordD20Test(
          id,
          'Dexterity (Stealth) check to Hide',
          rolled.value,
          rolled.value.success ? 'hidden' : 'in plain sight',
        ),
        ...(stamp === null ? {} : { command: stamp }),
      });

      if (rolled.value.success) {
        events.push({ type: 'condition-applied', id, condition: 'invisible', source: HIDE });
      }

      return ok({
        events,
        check: rolled.value,
        hidden: rolled.value.success,
        ...(screen === null
          ? {}
          : {
              unverified: [
                `${id} hid behind ${screen}, who is at least one size larger and within five feet; whether ${screen} stands between ${id} and each watcher is the table's`,
              ],
            }),
      });
    },
  );
}

/**
 * Open the door on the way past.
 *
 * SRD: "You can interact with one object or feature of the environment for
 * free, during either your move or action", and "when time is short, such as
 * in combat, interactions with objects are limited: one free interaction per
 * turn. Any additional interactions require the Utilize action."
 *
 * `useFreeInteraction` has enforced exactly that since the action economy
 * landed, with one caller: the **reducer**, folding an event no command wrote.
 *
 * **Outside combat there is nothing to limit**, so this refuses rather than
 * quietly succeeding: the allowance is per *turn*, there are no turns, and the
 * reducer throws for a `free-interaction-used` with no combat. That is the one
 * place this differs from Dodge, which has a benefit worth having either way.
 *
 * **It spends from the turn budget, so `mayAct` applies.** The action-economy
 * sweep derives that from the call rather than from this sentence —
 * `useFreeInteraction` is one of its seeds, beside the five that spend an
 * Action, a Bonus Action, a Reaction, movement or an attack, because the
 * budget field it consumes is one of the same six.
 */
export function useFreeObjectInteraction(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `free-interaction:${id}`, command, () => [], (stamp) => {
    // **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    // SRD Gaseous Form: "any objects it was carrying or holding can't be
    // dropped, used, or otherwise interacted with." The free interaction *is*
    // the interaction that sentence names, and it spends no slot, so the rule
    // is read here rather than reached through a spend.
    const handling = refuseObjectHandling(id, actionRulesOn(state, id));
    if (!handling.ok) return handling;

    if (state.combat === null) {
      return err(
        'not_in_combat',
        'interactions are limited to one a turn only when time is short; outside combat there is no turn to spend one on',
      );
    }

    const spent = useFreeInteraction(state.combat, id);
    if (!spent.ok) return spent;

    return ok([
      { type: 'free-interaction-used', id, ...(stamp === null ? {} : { command: stamp }) },
    ]);
  });
}

// — the five the glossary prints and nothing could tell apart ——————————————
//
// `combat.ts` listed Search, Study, Influence, Ready and Utilize as the
// book's and left them to the table, "for the reason Hide was: no spender
// could be told one of them apart". Ready turned out to exist; the other four
// are here, and Help — whose stabilisation half `declarations.ts` already
// paid out — with them. Each arrives with its spender in the same commit,
// which is the rule `NAMED_ACTIONS` is kept by.

/** Which slot the caller is offering to pay a Utilize out of, and on what. */
export interface UtilizeCommand extends CommandIdentity, AllowanceChoice {
  /**
   * SRD Fast Hands: "you can use the Utilize action as a Bonus Action."
   *
   * Absent is what the book charges, which is an Action. Stating a price
   * nothing has granted is refused rather than quietly charged at the ordinary
   * one — {@link DisengageOptions}' rule, for {@link DisengageOptions}' reason.
   */
  readonly from?: ActionSlot;
  /** What is being used, in the caller's words: "the lever", "the winch". */
  readonly object?: string;
}

/**
 * SRD Utilize: "When an object requires an action for its use, you take the
 * Utilize action", and "any additional interactions require the Utilize
 * action."
 *
 * **The action the free interaction's counter always implied.**
 * `useFreeObjectInteraction` has enforced "one free interaction per turn"
 * since the economy landed, and the sentence that says what to do about the
 * second had no door at all — so the count was enforced and the way past it
 * was missing.
 *
 * **It spends the slot and nothing else.** What the object *does* is the
 * table's: the SRD's own examples are a lever, a lock, a key and a bowstring,
 * none of which the engine holds, and inventing a mechanism for "used an
 * object" would be a rule nobody wrote. What the engine owns is the economy,
 * and that is what this charges — which is exactly what makes SRD Fast Hands
 * expressible, because an `allows` rule needs a spend to be offered on.
 *
 * **The free interaction is deliberately untouched.** A turn gets one for
 * nothing; a Utilize is what a creature takes *instead of* reaching for it,
 * not a second way of spending it.
 */
export function takeUtilize(
  state: GameState,
  id: CharacterId,
  command: UtilizeCommand = {},
): Result<GameEvent[]> {
  return once(state, `utilize:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (state.combat === null) {
      return err(
        'not_in_combat',
        'interactions are limited only when time is short; outside combat there is no action to spend on one',
      );
    }

    const from: ActionSlot = command.from ?? 'action';
    if (from !== 'action' && !isStatablePrice('utilize', from)) {
      return err(
        'no_such_price',
        `Utilize cannot be paid for out of ${from}; this command charges an action, or a Bonus Action where something has allowed it`,
      );
    }
    const rules = actionRulesOn(state, id);
    // SRD Gaseous Form again, before the price is worked out: a rule that
    // forbids handling refuses the whole spend, and `forbids.actions: ['utilize']`
    // would have said only half of that sentence.
    const handling = refuseObjectHandling(id, rules);
    if (!handling.ok) return handling;
    const priced: GameEvent[] = [];
    if (from !== 'action') {
      const allowed = allowsPrice(id, 'utilize', from, rules, choiceOf(command));
      if (!allowed.ok) return allowed;
      const price = priceOfAllowance(creature.resources, id, allowed.value, 'utilize');
      if (!price.ok) return price;
      priced.push(...price.value);
    }

    const spend = { rules, as: 'utilize' as const };
    const granted = from === 'action' ? command.usingFeature : undefined;
    const mismatch = refuseGrantMismatch(state, id, granted, 'utilize');
    if (mismatch !== null) return mismatch;
    const spent =
      from === 'bonus-action'
        ? spendBonusAction(state.combat, id, creature.conditions, spend)
        : spendAction(state.combat, id, creature.conditions, spend, granted);
    if (!spent.ok) return spent;

    return ok([
      from === 'bonus-action'
        ? { type: 'bonus-action-spent', id }
        : { type: 'action-spent', id, ...(granted === undefined ? {} : { grant: granted }) },
      ...priced,
      {
        type: 'utilize-taken',
        id,
        ...(command.object === undefined ? {} : { object: command.object }),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ]);
  });
}

/**
 * SRD Search: "you make a Wisdom (Insight, Medicine, Perception, or Survival)
 * check."
 *
 * The four are the entry's own list, and the choice among them is the
 * searcher's: which sense the attempt leans on is a fact about the attempt,
 * the same class of fact as `TestCommand.senses`.
 */
export const SEARCH_SKILLS: readonly Skill[] = ['insight', 'medicine', 'perception', 'survival'];

/**
 * SRD Study: "you make an Intelligence (Arcana, History, Investigation,
 * Nature, or Religion) check."
 */
export const STUDY_SKILLS: readonly Skill[] = [
  'arcana',
  'history',
  'investigation',
  'nature',
  'religion',
];

/**
 * SRD Influence: "you make a Charisma (Deception, Intimidation, Performance,
 * or Persuasion) check."
 */
export const INFLUENCE_SKILLS: readonly Skill[] = [
  'deception',
  'intimidation',
  'performance',
  'persuasion',
];

/** The skill this attempt uses, and the DC the DM set for it. */
export interface ActionCheckCommand extends CommandIdentity {
  /**
   * One of the few the entry prints, and refused where it is not.
   *
   * The action names a closed list and the choice inside it is the actor's —
   * SRD Search is four skills under one Wisdom check — so a skill outside the
   * list is a rules-legal refusal and never a quiet substitution.
   */
  readonly skill: Skill;
  /**
   * The Difficulty Class, which is the DM's.
   *
   * These three entries print a check and no number: the DC depends on the
   * situation is the whole of what the book says, so it arrives the way every
   * other DC does — from the DM's door, never from a model's.
   */
  readonly dc: number;
  /** What the attempt is for, in the caller's words. */
  readonly label?: string;
  /** Advantage or Disadvantage the table knows about and the engine cannot see. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  readonly bonuses?: readonly Bonus[];
}

/** An Influence names who is being influenced; the other two name nobody. */
export interface InfluenceCommand extends ActionCheckCommand {
  readonly target: CharacterId;
}

export interface ActionCheckResolution {
  readonly events: readonly GameEvent[];
  /** The roll, or null when this command id had already been applied. */
  readonly check: D20TestResult | null;
  readonly success: boolean;
  /** Facts the engine could not check — see `AttackResolution.unverified`. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * Spend the action, roll the check the entry prints, and record both.
 *
 * The shared body of the three glossary actions that are a check: the ability
 * and the list of skills are the entry's, the DC is the DM's and everything
 * else is derived the way every check in this engine is — proficiency,
 * Expertise, the armour penalty, the roller's conditions, Exhaustion, and the
 * modes and bonuses standing on them.
 *
 * **And it spends what the roll reached.** A one-shot grant an ally's Help
 * hung on this creature is used up here, beside `roll-recorded`, exactly as
 * the two attack rollers have always spent Guiding Bolt's — see
 * `spentRollModifiers`.
 */
function takeActionCheck(
  state: GameState,
  id: CharacterId,
  action: 'search' | 'study' | 'influence',
  title: string,
  ability: Ability,
  skills: readonly Skill[],
  command: ActionCheckCommand,
  supply: Supply,
  handover: readonly string[] = [],
): Result<ActionCheckResolution> {
  return once(
    state,
    `${action}:${id}`,
    command,
    () => ({ events: [], check: null, success: false, unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

      if (!skills.includes(command.skill)) {
        return err(
          'wrong_skill',
          `the ${title} action is a ${ABILITY_NAMES[ability]} check with ${skills.join(', ')}; ${command.skill} is none of them`,
        );
      }
      if (!Number.isFinite(command.dc)) {
        return err('bad_dc', `${String(command.dc)} is not a Difficulty Class`);
      }

      // Validate the whole attempt before any of it is emitted, which here
      // means before the die: a refused action costs neither the slot nor a
      // turn of the generator.
      const events: GameEvent[] = [];
      if (state.combat !== null && state.combat.budgets[id] !== undefined) {
        const spent = spendAction(state.combat, id, creature.conditions, {
          rules: actionRulesOn(state, id),
          as: action,
        });
        if (!spent.ok) return spent;
        events.push({ type: 'action-spent', id });
      }

      const issuedBefore = supply.issuer.count;
      const query = {
        family: 'ability-check' as const,
        roller: id,
        ability,
        skill: command.skill,
      };
      const sheet = sheetAsItStands(state, id) ?? creature.sheet;
      const rolled = rollAbilityCheck(supply.issuer, supply.rng, sheet, ability, {
        dc: command.dc,
        skill: command.skill,
        conditions: effectiveConditions(state, id),
        modes: [...rollModesFor(state, query).modes, ...(command.modes ?? [])],
        bonuses: checkBonuses(state, id, command.bonuses, command.skill),
      });
      if (!rolled.ok) return rolled;

      events.push({
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      });
      events.push({
        ...recordD20Test(
          id,
          command.label ?? `${ABILITY_NAMES[ability]} (${command.skill}) check to ${title}`,
          rolled.value,
          rolled.value.success ? 'success' : 'failure',
        ),
        ...(stamp === null ? {} : { command: stamp }),
      });
      // **Beside the roll, and whatever the outcome.** The sentence that hung
      // the grant counts rolls and not successes, which is the reading
      // `resolveAttack` has always taken of the same field.
      events.push(...spentRollModifiers(state, query));

      return ok({
        events,
        check: rolled.value,
        success: rolled.value.success,
        unverified: handover,
        duplicate: false,
      });
    },
  );
}

/**
 * SRD Search: "You make a Wisdom (Insight, Medicine, Perception, or Survival)
 * check to discern something that isn't obvious."
 *
 * **What was found is not here and cannot be.** The engine holds no hidden
 * door, no bloodstain and no lie; what it holds is the check and the action
 * that buys it, and the thing discerned is the table's to narrate from the
 * number. That is the division `resolveTest` already draws — "a standalone
 * test's consequence belongs to whoever asked for it; the engine owns the
 * number" — and the reason this rolls rather than searching state.
 */
export function takeSearch(
  state: GameState,
  id: CharacterId,
  command: ActionCheckCommand,
  supply: Supply,
): Result<ActionCheckResolution> {
  return takeActionCheck(state, id, 'search', 'Search', 'wis', SEARCH_SKILLS, command, supply);
}

/**
 * SRD Study: "You make an Intelligence (Arcana, History, Investigation,
 * Nature, or Religion) check to study your memory, a book, a clue, or another
 * source of knowledge."
 *
 * **The gap was in the middle of a rule that otherwise ran.** Six spell
 * definitions print the sentence "a creature must take the Study action" in
 * front of the Investigation check `resolveEffectCheck` rolls — Disguise Self,
 * Minor Illusion, Silent Image, Hallucinatory Terrain, Major Image and Seeming
 * — so the check was executed and the action that buys it was not.
 */
export function takeStudy(
  state: GameState,
  id: CharacterId,
  command: ActionCheckCommand,
  supply: Supply,
): Result<ActionCheckResolution> {
  return takeActionCheck(state, id, 'study', 'Study', 'int', STUDY_SKILLS, command, supply);
}

/**
 * SRD Influence: "You make a Charisma (Deception, Intimidation, Performance,
 * or Persuasion) check to urge a monster to do something."
 *
 * **The attitude is handed over, not modelled**, and the book is why: the DM
 * decides whether the monster is Indifferent, Friendly or Hostile, a Hostile
 * monster's answer is no whatever the die says, and the DC depends on that
 * attitude — three judgements about fiction the engine holds none of. So the
 * check is the engine's, the number is the DM's, and what the monster does
 * about it comes back flagged.
 *
 * `target` is recorded rather than read: the engine checks that the creature
 * exists and nothing else, because "understands what you say" and "is willing
 * to listen" are clauses it can answer neither of.
 */
export function takeInfluence(
  state: GameState,
  id: CharacterId,
  command: InfluenceCommand,
  supply: Supply,
): Result<ActionCheckResolution> {
  if (creatureOf(state, command.target) === null) {
    return unknownCreature(command.target, 'is not here to be influenced');
  }
  return takeActionCheck(
    state,
    id,
    'influence',
    'Influence',
    'cha',
    INFLUENCE_SKILLS,
    command,
    supply,
    [
      `SRD Influence: the attitude of ${command.target} — Indifferent, Friendly or Hostile — is the DM's, and so is whether what was asked for is something the monster would ever agree to; a Hostile monster refuses whatever the check said. The engine rolled the check and decided nothing about the answer.`,
    ],
  );
}

/** The feature id a Help's Advantage hangs under. */
export const HELP = 'action:help';

/** One helper's Help, so two helpers hang two grants and one helper hangs one. */
const helpSource = (helper: CharacterId): string => `${HELP}@${helper}`;

/** SRD Help, Assist an Attack Roll: "an enemy within 5 feet of you". */
const HELP_REACH = 5;

/**
 * Which half of the Help entry is being offered.
 *
 * SRD prints two paragraphs under one action and they are not two readings of
 * one rule: the first names a skill and an ally and gives Advantage on a
 * check, the second names an ally and an enemy and gives Advantage on an
 * attack. Different fields and a different creature the grant is about — so a
 * union rather than one shape with everything optional, which is what would
 * let a caller name a skill and an enemy and be told nothing.
 */
export type HelpCommand = CommandIdentity &
  (
    | {
        readonly kind: 'check';
        readonly ally: CharacterId;
        /**
         * SRD: "Choose one of your skill or tool proficiencies" — the
         * **helper's**, which is why this is checked against the helper's own
         * sheet rather than the ally's.
         */
        readonly skill: Skill;
      }
    | {
        readonly kind: 'attack';
        readonly ally: CharacterId;
        readonly enemy: CharacterId;
      }
  );

export interface HelpResolution {
  readonly events: readonly GameEvent[];
  /**
   * The five feet the engine could not measure, where nobody has been placed.
   *
   * See `AttackResolution.unverified`: a fact a command can proceed past
   * conservatively is reported rather than refused.
   */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

/**
 * SRD Help, both halves: Advantage on one ally's next ability check with a
 * chosen skill, or on their next attack roll against a distracted enemy.
 *
 * **A stored grant rather than a derived one, because the point of it is to be
 * spent.** `RollModifier.oneShot` is the mechanism SRD Guiding Bolt and SRD
 * Vicious Mockery already use and `commands/mastery.ts` already files timers
 * for; this is the same shape, one action along, with the deadline the entry
 * prints — the start of the helper's next turn — on a `grants` timer. Both
 * endings stand and the first to arrive wins, which is the rule
 * `roll-modifier-consumed` documents.
 *
 * **The attack half's five feet are checked and the check half's "near enough"
 * is not**, and the asymmetry is the book's: "an enemy within 5 feet of you" is
 * a distance on the lattice, and "near enough for you to assist verbally or
 * physically" is a judgement about a room the engine does not hold. Where
 * nobody has placed the creatures, the distance goes unverified rather than
 * refused — the reading Push takes of an unstated size.
 *
 * **What is *not* here is the entry's third sentence**: "you can also aid a
 * friendly creature in attacking" has a stabilisation twin — `stabiliseCreature`
 * names the Help action as what its payout is the payout of — and that half has
 * been reachable since declarations landed.
 */
export function takeHelp(
  state: GameState,
  id: CharacterId,
  command: HelpCommand,
): Result<HelpResolution> {
  return once(
    state,
    `help:${id}`,
    command,
    () => ({ events: [], unverified: [], duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, id);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, id);
      if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
      if (state.combat === null) {
        return err(
          'not_in_combat',
          'a Help expires at the start of your next turn, and there are no turns outside combat for it to expire at',
        );
      }
      if (command.ally === id) {
        return err('no_ally', `${id} cannot Help themselves; the entry names an ally`);
      }
      if (creatureOf(state, command.ally) === null) {
        return unknownCreature(command.ally, 'is not here to be helped');
      }

      const unverified: string[] = [];
      if (command.kind === 'check') {
        // SRD: "Choose one of your **skill or tool proficiencies**." Tools are
        // not on the sheet, so what is checked is the half that is: a helper
        // offering a skill they are not proficient with is refused rather than
        // handed the Advantage anyway.
        if ((sheetAsItStands(state, id) ?? creature.sheet).skills[command.skill] === undefined) {
          return err(
            'not_proficient',
            `SRD Help asks the helper to choose one of their own proficiencies, and ${id} is not proficient with ${command.skill}`,
          );
        }
      } else {
        if (creatureOf(state, command.enemy) === null) {
          return unknownCreature(command.enemy, 'is not here to be distracted');
        }
        const apart = state.scene === null ? null : distanceBetween(state.scene, id, command.enemy);
        if (apart !== null && apart.ok && apart.value > HELP_REACH) {
          return err(
            'out_of_reach',
            `SRD Help distracts "an enemy within 5 feet of you", and ${command.enemy} is ${apart.value} feet from ${id}`,
          );
        }
        if (apart === null || !apart.ok) {
          unverified.push(
            `nobody has said where ${id} and ${command.enemy} are standing, so the five feet SRD Help asks for went unchecked`,
          );
        }
      }

      const source = helpSource(id);
      const granted: GameEvent = {
        type: 'roll-modifier-granted',
        id: command.ally,
        modifier: {
          source,
          modifier: {
            mode: 'advantage',
            selector:
              command.kind === 'check'
                ? { roll: 'ability-check', relation: 'roller', skill: command.skill }
                : // "against that enemy": the participant the relation does not
                  // name, which is what `counterpart` was written for and what
                  // Vex already uses.
                  { roll: 'attack', relation: 'roller', counterpart: command.enemy },
            oneShot: true,
          },
        },
      };

      const spent = spendAction(state.combat, id, creature.conditions, {
        rules: actionRulesOn(state, id),
        as: 'help',
      });
      if (!spent.ok) return spent;

      // "This benefit expires if the ally doesn't use it before the start of
      // your next turn", and the attack half says the same in fewer words. The
      // **helper's** turn, not the ally's.
      const timer = schedule(
        applyEvent(state, granted),
        { kind: 'grants', on: command.ally, source },
        startOfNextTurn(id),
      );
      if (!timer.ok) return timer;

      return ok({
        events: [
          { type: 'action-spent', id },
          granted,
          timer.value,
          {
            type: 'help-given',
            id,
            ally: command.ally,
            kind: command.kind,
            ...(command.kind === 'attack' ? { against: command.enemy } : {}),
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        unverified,
        duplicate: false,
      });
    },
  );
}

/**
 * What a Ready is being held for, and what it will do.
 *
 * The trigger is free text and stays that way. SRD asks for "a perceivable
 * circumstance", and the circumstances a table readies against live almost
 * entirely in fiction the engine has never been told about — a trapdoor, a
 * chant, a door. **Absence from structured state is not evidence that a thing
 * does not exist**, so an engine that judged the trigger would be refusing
 * readied actions on the strength of its own ignorance. Maestro says when it
 * fired; everything around it is the engine's.
 */
export interface ReadyCommand extends CommandIdentity {
  readonly trigger: string;
  readonly response: ReadyResponse;
}

/** The response as a caller states it, before the engine has paid for it. */
export type ReadyResponse =
  | { readonly kind: 'action'; readonly note?: string }
  | { readonly kind: 'move' }
  | ({
      readonly kind: 'spell';
      readonly spellId: string;
      /** The slot to expend now. Omitted for a cantrip. */
      readonly slotLevel?: number;
      readonly slotKind?: SlotKind;
      readonly source?: string;
    } & StatedFacts);

/**
 * The four facts a casting states rather than derives.
 *
 * SRD Ready: "you cast it as normal (expending any resources used to cast it)
 * but hold its energy" — so the slot goes at the Ready, and everything the
 * caster said about the spell was said there too. They take exactly the shape
 * they take on `CastSpellRequest`, are validated by exactly the same
 * {@link declaredFacts}, and are handed back to `castOrRelease` at the
 * release, which normalises them through the same two functions a settlement
 * uses. Whether a casting is settled in one breath, held open for a
 * Counterspell or waiting on a trigger changes nothing about what the caster
 * said.
 *
 * One type here and one on `ReadiedResponse`, because the caller's word and
 * the held record are two different moments; what must not be written twice is
 * the *copying*, which is {@link statedOf}.
 */
export interface StatedFacts {
  /** Which of the damage types the spell prints this casting deals. */
  readonly damageType?: string;
  /** The value the caster chose, where the spell prints a choice. */
  readonly choice?: string;
  /** Which creatures the caster or their allies are fighting. */
  readonly fought?: readonly CharacterId[];
  /** Which of the casting's targets consent to it. */
  readonly willing?: readonly CharacterId[];
  /** Creatures the caster designated unaffected, for a spell that offers it. */
  readonly unaffected?: readonly CharacterId[];
  /** Creatures this casting's area reaches, for a spell that offers the choice. */
  readonly chosen?: readonly CharacterId[];
  /** Where a teleporting spell puts its target. */
  readonly teleportTo?: Placement;
  /** The weapon a spell that imbues one was aimed at, by catalogue id. */
  readonly weapon?: string;
}

/** What this creature is holding for a trigger, or null. */
export function readiedBy(state: GameState, id: CharacterId): ReadiedAction | null {
  return creatureOf(state, id)?.readied ?? null;
}

/**
 * Ready an action: spend it now, to take a Reaction later.
 *
 * SRD: "You take the Ready action to wait for a particular circumstance before
 * you act. To do so, you take this action on your turn, which lets you act by
 * taking a Reaction before the start of your next turn."
 *
 * The deadline is the same turn-anchored one Dodge uses, expressed the same
 * way — an activated feature with a timer — because the benefit has to outlive
 * the turn that bought it, and a turn budget is cleared when the turn ends.
 *
 * A readied **spell** is the SRD's own special case and the only part of this
 * the engine has real rules for: "you cast it as normal (expending any
 * resources used to cast it) but hold its energy, which you release with your
 * Reaction when the trigger occurs... To be readied, a spell must have a
 * casting time of an action, and holding on to the spell's magic requires
 * Concentration." So the slot goes now and the effects do not, which is why
 * the casting and its resolution are two commands rather than one.
 */
export function takeReady(
  state: GameState,
  id: CharacterId,
  command: ReadyCommand,
  content: Content,
): Result<GameEvent[]> {
  return once(state, `ready:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

    // SRD: "you take this action on your turn, which lets you act by taking a
    // Reaction before the start of your next turn." Both halves need turns.
    if (state.combat === null || state.combat.budgets[id] === undefined) {
      return err('not_in_combat', 'a readied action waits for a Reaction, and there are no turns to take one in');
    }
    if (creature.readied !== null) {
      return err('already_readied', `${id} is already holding a readied action`);
    }
    // **Not `no_trigger`.** That code says a Reaction's moment has not arrived,
    // which is a fact about the world and something a caller waits out; this
    // says the command did not say what it is waiting for, which is a fact
    // about the command and something a caller fixes by re-sending it. One
    // code carried both, and a tool surface branching on it could not tell a
    // Shield with no attack to answer from a Ready with an empty string.
    if (command.trigger.trim() === '') {
      return err('no_trigger_stated', 'a readied action waits for something; say what');
    }

    // Validate the whole thing before any of it is emitted, casting included:
    // a Ready that refuses must leave the action, the slot and the
    // Concentration exactly as they were.
    const spent = spendAction(state.combat, id, creature.conditions, {
      rules: actionRulesOn(state, id),
    });
    if (!spent.ok) return spent;

    const events: GameEvent[] = [{ type: 'action-spent', id }];
    let response: ReadiedResponse;

    if (command.response.kind === 'spell') {
      const held = holdSpell(state, content, id, command.response);
      if (!held.ok) return held;
      events.push(...held.value.events);
      response = held.value.response;
    } else if (command.response.kind === 'move') {
      response = { kind: 'move' };
    } else {
      response = {
        kind: 'action',
        ...(command.response.note === undefined ? {} : { note: command.response.note }),
      };
    }

    events.push({
      type: 'feature-activated',
      id,
      feature: READY,
      ...(stamp === null ? {} : { command: stamp }),
    });
    events.push({ type: 'readied-declared', id, readied: { trigger: command.trigger, response } });

    const timer = featureTimer(state, id, READY_ACTION);
    if (!timer.ok) return timer;
    if (timer.value !== null) events.push(timer.value);

    return ok(events);
  });
}

/**
 * Cast the spell being readied, without resolving it.
 *
 * SRD: "you cast it as normal (expending any resources used to cast it) but
 * hold its energy." So this is an ordinary casting with the effects left
 * undone — the slot goes, and the Concentration that holds the magic starts,
 * whether or not the spell itself is a Concentration spell.
 *
 * The action is **not** spent here: the Ready action is the casting's action,
 * and charging for both would take two actions for one thing the SRD charges
 * once for. `castSpell` is the half beneath `resolveCast` that leaves the
 * economy alone, which is exactly the half this wants.
 */
function holdSpell(
  state: GameState,
  content: Content,
  id: CharacterId,
  response: ReadyResponse & { readonly kind: 'spell' },
): Result<{ readonly events: readonly GameEvent[]; readonly response: ReadiedResponse }> {
  const definition = content.spell(response.spellId);
  if (definition === null) {
    return err(
      'no_definition',
      `${response.spellId} has no executable definition; the engine can look a spell up but only executes the ones it has been taught`,
    );
  }

  // SRD: "To be readied, a spell must have a casting time of an action."
  if (definition.castingTime !== 'action') {
    return err(
      'not_readiable',
      `${definition.name} is cast with a ${definition.castingTime}, and only a spell cast with an action can be readied`,
    );
  }

  const caster = creatureOf(state, id);
  if (caster === null) return unknownCreature(id);

  // **A spell a printed line holds open is not a spell a creature readies.**
  // SRD Priest's Divine Aid is a *use of a heading* whose price is the
  // heading's — a count between dawns, a recharge — and a Ready spends its
  // slot now and settles later through `releaseReady`, which never asks
  // `castingOf`: the line is taken with the door that prices it, and the
  // casting goes with it.
  //
  // **This refuses nothing `chooseRoute` would not refuse eleven lines below**,
  // and is here for what it *says*. The licence closes both roads already — a
  // Ready that names no source never finds the route, because `routesFor`
  // leaves it out, and one that names the source is refused
  // `route_through_line_only` because this command holds no licence and never
  // will. What that code cannot say is which door the caller should have used,
  // so the refusal a Ready meets is named for the Ready.
  const heldOpen = caster.spellcasting.granted.find(
    (grant) =>
      grant.throughLine !== undefined &&
      grant.spellId === response.spellId &&
      grant.source === response.source,
  );
  if (heldOpen !== undefined) {
    return err(
      'readied_printed_line',
      `${response.spellId} is cast as part of taking ${heldOpen.throughLine}, which prices the use — a readied casting settles without that price, so the line is taken rather than readied`,
    );
  }

  // SRD: you ready what you know or have prepared, and nothing else.
  const chosen = chooseRoute(caster.spellcasting, response.spellId, response.source);
  if (!chosen.ok) return chosen;
  const route = chosen.value;

  // — the four facts the caster states, and the engine will not guess ————————
  //
  // **The same validator, not a second copy of it.** `declaredFacts` is what
  // the atomic cast and the declaration both ask, so a spell that prints a
  // clause and a Ready that says nothing is refused with the same code, and a
  // spell that prints none and is told the fact is refused with the same code.
  // The three Dominates could not be readied at all before this: SRD prints
  // "It does so with Advantage if you or your allies are fighting it", so the
  // casting *requires* the fact and nothing on a `ReadyResponse` could say it.
  //
  // Asked here, **before the slot** — SRD spends it at the Ready and the
  // release has nothing left to refund, so a fact missing until the release
  // would be an action and a slot spent on a casting that could never be let
  // go. It reads only the four fields; a readied spell names its targets at
  // the release, and `targets` is empty because there are none to name yet.
  const stated = declaredFacts(state, definition, {
    spellId: response.spellId,
    targets: [],
    ...statedOf(response),
  });
  if (!stated.ok) return stated;

  const castLevel = Math.max(definition.level, response.slotLevel ?? definition.level);
  const castingId = nextCastingId(state);

  const cast = castSpell(state, id, {
    spell: definition.name,
    level: definition.level,
    // SRD: "holding on to the spell's magic requires Concentration" — for
    // every readied spell, not only the ones whose own Duration says so.
    concentration: true,
    castingTime: definition.castingTime,
    ...(response.slotLevel === undefined
      ? { slotless: 'cantrip' as const }
      : {
          slotLevel: response.slotLevel,
          ...(response.slotKind === undefined ? {} : { slotKind: response.slotKind }),
        }),
    route: routeLabel(route),
    // The printed text the book leaves to the table, pinned onto the casting
    // this Ready writes. CLAUDE.md's rule 5: a handover is something this
    // command read from content, and a Ready's `spell-cast` is written a turn
    // before the spell takes effect — so it is the only event that could carry
    // it. No SRD spell reaches here, because a Ready takes an Action casting
    // and all three SRD handovers take a minute or more; a homebrew definition
    // does.
    ...(definition.dmDecides === undefined ? {} : { dmDecides: definition.dmDecides }),
    // No duration. The spell has not taken effect, so its own clock has not
    // started; what *is* capped is the hold, and that is the Ready feature's
    // deadline rather than the spell's.
  });
  if (!cast.ok) return cast;

  return ok({
    events: cast.value,
    response: {
      kind: 'spell',
      spellId: response.spellId,
      castingId,
      castLevel,
      // Exactly what the caster said, and nothing the caller did not say:
      // `statedOf` elides an absent field rather than defaulting it, so a
      // Ready written before these existed folds to the state it always did.
      ...statedOf(response),
    },
  });
}

/**
 * The four stated facts, lifted off whichever record is carrying them.
 *
 * **One reader for all three places a readied spell touches them** — what
 * `declaredFacts` validates at the Ready, what the readied record stores, and
 * the request the release hands to `castOrRelease` — so a fifth stated fact is
 * one edit here rather than three that have to agree. The parameter is the
 * structural shape rather than either named type, because `ReadyResponse` and
 * `ReadiedResponse` are the *same four facts* said at two moments, and a
 * reader that named one of them would need a twin for the other, which is the
 * duplication this exists to prevent.
 *
 * **It normalises nothing, and that is the decision.** `statedFacts` sorts the
 * designation and elides it when empty, `foughtFor` sorts the fought list and
 * never elides it, and both belong to `spell-resolution.ts`, which owns the
 * two records a *casting* writes. A readied response is neither of those: it
 * is the caster's stated intent, held, and it reaches those two functions at
 * the release, through `castOrRelease`, which is the same door a settlement
 * goes through. Normalising half of it here — `foughtFor` is exported and
 * `statedFacts` is not — would be the second answer to one question this
 * repository keeps finding wrong.
 *
 * **Absent means absent**, in both directions: a field the caller omitted is
 * omitted from the record, and an empty `fought` is kept, because "none of
 * them" is an answer the spell insisted on — the one place `fought` and
 * `unaffected` part company, which `foughtFor` in `targeting.ts` records.
 *
 * Idempotent, which is what lets the release call it on a record `holdSpell`
 * already built rather than spelling the copy out a second time — the property
 * `statedFacts` has for the same reason.
 */
function statedOf(response: StatedFacts): StatedFacts {
  return {
    ...(response.damageType === undefined ? {} : { damageType: response.damageType }),
    ...(response.choice === undefined ? {} : { choice: response.choice }),
    ...(response.fought === undefined ? {} : { fought: response.fought }),
    ...(response.willing === undefined ? {} : { willing: response.willing }),
    ...(response.unaffected === undefined ? {} : { unaffected: response.unaffected }),
    ...(response.chosen === undefined ? {} : { chosen: response.chosen }),
    ...(response.teleportTo === undefined ? {} : { teleportTo: response.teleportTo }),
    ...(response.weapon === undefined ? {} : { weapon: response.weapon }),
  };
}

/**
 * What letting the held action go actually did.
 *
 * One shape with two optional halves rather than a union, because what the
 * release *always* does — spend the Reaction, close the hold — is the same
 * whichever response was held, and the rest is what that response happened to
 * be. An `action` response fills in neither: the engine has commands for a
 * handful of the SRD's open action list, so the caller takes it from here.
 */
export interface ReadyRelease {
  readonly events: readonly GameEvent[];
  /** Whether the Reaction was taken, or the trigger let pass. */
  readonly took: boolean;
  /** The spell that landed, for a readied spell. */
  readonly spell?: SpellResolution;
  /** The move that was made, for a readied move. */
  readonly move?: MoveResolution;
}

/** How the held action is being let go. */
export interface ReleaseCommand extends CommandIdentity {
  /**
   * SRD: "you can either take your Reaction right after the trigger finishes
   * **or ignore the trigger**." Ignoring costs nothing and keeps the Reaction.
   */
  readonly ignore?: boolean;
  /** Who a readied spell lands on. Empty for an area spell, which picks its own. */
  readonly targets?: readonly CharacterId[];
  /**
   * How many of a readied casting's attack rolls go at each of those creatures.
   *
   * **Stated here rather than at the Ready**, which is where it parts company
   * with the six facts `statedOf` carries forward: the targets a readied spell
   * lands on are chosen at the release, and a split is aligned to them. See
   * `CastSpellRequest.rollsAt`, which validates it through the same call the
   * atomic casting uses.
   */
  readonly rollsAt?: readonly AimedRolls[];
  /** Where a readied area spell's origin goes. */
  readonly at?: Point;
  /** Where a readied move goes, relative to something already established. */
  readonly placement?: Placement;
  /** How many feet of that move are through Difficult Terrain. */
  readonly difficultFeet?: number;
  /**
   * The 5-foot spaces that move passed through — `MoveCommand.route`, and for
   * the same reason.
   *
   * **A readied move is charged for the ground it crosses, so it can be asked
   * which ground that was.** The allowance is the mover's Speed and the patches
   * the table has declared come off it exactly as they do on the mover's own
   * turn, so `chargeTerrain` reaches `route_required` here as readily as it
   * does from `resolveMove` — and until this field existed the answer to that
   * question had nowhere to go. The caller was told to send the same command
   * again with a field the command did not have, which is a refusal that
   * cannot be acted on however carefully it is read.
   */
  readonly route?: readonly Point[];
}

/**
 * Take the Reaction a readied action was held for — or let the trigger pass.
 *
 * The trigger is Maestro's call and has already been made by the time this is
 * reached; what the engine owns is the Reaction, the hold, and, for a readied
 * spell, everything the spell does.
 *
 * For an `action` response this spends the Reaction and clears the hold; the
 * action itself goes through its own command afterwards, because the SRD's
 * action list is open and the engine has commands for a handful of it. An
 * attack taken this way is `resolveAttack({ free: true })` — the Reaction is
 * what paid for it, exactly as an Opportunity Attack is.
 */
export function releaseReady(
  state: GameState,
  id: CharacterId,
  command: ReleaseCommand,
  supply: Supply,
): Result<ReadyRelease> {
  // Without this the retry came back `nothing_readied` — a refusal, telling
  // the caller the hold never existed when in fact their first call consumed
  // it. A retry that reads as a rules problem is worse than one that doubles,
  // because the DM narrates the lie.
  // The split is a mapping and the order its pairs were written in says
  // nothing, exactly as it says nothing on a casting — `castingIdentity` makes
  // the same normalisation through the same call, so the two doors cannot
  // disagree about which releases are one release.
  const identity: ReleaseCommand = {
    ...command,
    ...(command.rollsAt === undefined ? {} : { rollsAt: aimedIdentity(command.rollsAt)! }),
  };
  return once(state, `release:${id}`, identity, () => ({ events: [], took: true }), (stamp) => {
    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');

    const readied = creature.readied;
    if (readied === null) {
      return err('nothing_readied', `${id} is not holding a readied action`);
    }

    // SRD: "or ignore the trigger." Nothing is spent and nothing happens — but
    // the hold is gone, because the trigger it was waiting for has been and
    // passed. A held spell dissipates with it.
    if (command.ignore === true) {
      return ok({
        events: [
          {
            type: 'readied-released',
            id,
            took: false,
            ...(stamp === null ? {} : { command: stamp }),
          },
        ],
        took: false,
      });
    }

    if (state.combat === null || state.combat.budgets[id] === undefined) {
      return err('not_in_combat', 'there is no Reaction to spend outside combat');
    }
    const spent = spendReaction(state.combat, id, creature.conditions, {
      rules: actionRulesOn(state, id),
    });
    if (!spent.ok) return spent;

    const events: GameEvent[] = [
      { type: 'reaction-spent', id },
      { type: 'readied-released', id, took: true, ...(stamp === null ? {} : { command: stamp }) },
    ];

    if (readied.response.kind === 'spell') {
      return releaseSpell(state, id, readied.response, command, supply, events);
    }
    if (readied.response.kind === 'move') {
      return releaseMove(state, id, command, supply, events);
    }

    return ok({ events, took: true });
  });
}

/**
 * Move as the Reaction a Ready held back.
 *
 * SRD: "you choose to move up to your Speed in response to it." The Reaction
 * is what paid for this, so no Speed is spent — a turn budget belongs to a
 * turn and this is somebody else's, which is why `spendMovement` refuses it by
 * construction and is right to. The allowance is the mover's Speed **now**,
 * read through `speedOf` like every other Speed the command layer asks for —
 * so whatever has arrived since they readied applies: a creature Grappled
 * while waiting has a Speed of 0 and goes nowhere, and a Monk who put their
 * Shield down has the ten feet their feature gives back.
 *
 * Everything else is an ordinary move. It provokes, because it is the
 * creature's own movement and SRD offers the Opportunity Attack for leaving a
 * reach without caring what paid for the leaving.
 */
function releaseMove(
  state: GameState,
  id: CharacterId,
  command: ReleaseCommand,
  supply: Supply,
  spentSoFar: readonly GameEvent[],
): Result<ReadyRelease> {
  if (command.placement === undefined) {
    return err('no_placement', `${id} readied a move; say where to`);
  }

  const combat = state.combat;
  const creature = creatureOf(state, id);
  if (combat === null || creature === null) {
    return err('not_in_combat', 'there is no Reaction to spend outside combat');
  }

  const allowance = speedOf(state, id);

  const after = spentSoFar.reduce(applyEvent, state);
  const moved = moveWithin(
    after,
    id,
    {
      placement: command.placement,
      ...(command.difficultFeet === undefined ? {} : { difficultFeet: command.difficultFeet }),
      ...(command.route === undefined ? {} : { route: command.route }),
    },
    supply,
    allowance,
  );
  if (!moved.ok) return moved;

  return ok({
    events: [...spentSoFar, ...moved.value.events],
    took: true,
    move: moved.value,
  });
}

/**
 * Let a held spell go, and resolve it where it lands.
 *
 * The slot went when it was readied, so nothing is paid here. What still has
 * to happen is the half `castSpell` would have done had the spell been cast
 * normally at this moment: the Concentration settles, and the spell's own
 * duration starts now rather than when the magic was first gathered.
 */
function releaseSpell(
  state: GameState,
  id: CharacterId,
  response: ReadiedResponse & { readonly kind: 'spell' },
  command: ReleaseCommand,
  supply: Supply,
  spentSoFar: readonly GameEvent[],
): Result<ReadyRelease> {
  const definition = supply.content.spell(response.spellId);
  if (definition === null) {
    return err('no_definition', `${response.spellId} has no executable definition`);
  }

  const events: GameEvent[] = [...spentSoFar];

  // The Concentration was holding the magic, not the spell. A spell whose own
  // Duration does not say Concentration has nothing left to concentrate on
  // once it has happened, so the hold ends — **before** the effects land, or
  // ending the casting would take the conditions the release just created.
  if (!definition.concentration) {
    events.push({
      type: 'concentration-ended',
      id,
      castingId: response.castingId,
      reason: 'released',
    });
  }

  const after = events.reduce(applyEvent, state);
  const resolved = castOrRelease(
    after,
    id,
    {
      spellId: response.spellId,
      targets: command.targets ?? [],
      // Beside the targets, because it is the release that chooses them.
      ...(command.rollsAt === undefined ? {} : { rollsAt: command.rollsAt }),
      ...(command.at === undefined ? {} : { at: command.at }),
      ...(definition.level === 0 ? {} : { slotLevel: response.castLevel }),
      // What the caster stated at the Ready, put back on the request the
      // resolution reads — through the same `statedOf` that validated them and
      // wrote them down, so a fifth stated fact is one edit rather than three
      // that have to agree. **Not restated by the release**: `ReleaseCommand`
      // carries no field for any of the four, so a Dimension Door readied at
      // the far end of the hall cannot be let go beside its caster — the same
      // rule as `resolveDeclaredCast`, which takes no fresh request either.
      // They reach `statedFacts` and `foughtFor` from here exactly as a
      // settlement's do, which is what keeps one normaliser for three doors.
      ...statedOf(response),
    },
    supply,
    { castingId: response.castingId },
  );
  // A refusal of any kind takes the whole batch with it: the Reaction is
  // still there and the spell is still held. That was already true of a rules
  // refusal; it is now true of a missing fact too, which used to come back as
  // a success and needed unpicking here.
  if (!resolved.ok) return resolved;

  events.push(...resolved.value.events);

  // SRD writes a readied spell's Duration from the moment it takes effect, and
  // that moment is now. `castSpell` would have scheduled this at the casting;
  // the casting was a turn ago and did nothing.
  //
  // **Unless the slot bought "until dispelled"**, read through the same
  // `untilDispelledAt` the ordinary resolution reads — SRD Major Image's level
  // 4+ slot leaves no deadline for a release to schedule.
  if (definition.durationSeconds !== undefined && !untilDispelledAt(definition, response.castLevel)) {
    const timer = schedule(
      events.reduce(applyEvent, state),
      { kind: 'casting', castingId: response.castingId },
      // The band the slot reached, through the same reader the ordinary
      // resolution uses — a readied spell cast from a level 5 slot lasts what
      // a level 5 slot buys, and two spellings of that arithmetic would be two
      // places for one sentence to go wrong.
      { kind: 'seconds', seconds: durationSecondsAt(definition, response.castLevel)! },
    );
    if (!timer.ok) return timer;
    events.push(timer.value);
  }

  return ok({ events, took: true, spell: resolved.value });
}

// — the glossary's hazards, and the one action that ends one ————————————————

/**
 * SRD *Burning* [Hazard]: "As an action, you can extinguish fire on yourself by
 * giving yourself the Prone condition and rolling on the ground."
 *
 * **Not a {@link NAMED_ACTIONS} member**, and reading that list is what says
 * so: every member of it has both a spender that names it *and* an SRD
 * sentence that asks for it by name — "it takes the Attack action", "forced to
 * take the Dodge action". Nothing in the book ever says "takes the Extinguish
 * action", so a member here would be a name no rule could ask for, which is
 * the wish that list is kept free of. This spends an Action like any other
 * command and is told apart by nothing, exactly as the book leaves it.
 *
 * **On yourself, which the sentence says twice.** "Extinguish fire *on
 * yourself*" by "giving *yourself* the Prone condition": there is no clause
 * about a neighbour beating out somebody else's fire, so there is no target to
 * refuse one with.
 *
 * **The Prone is the method and not a price the fire charges**, so a creature
 * that cannot be given it still puts the fire out and the reason is reported
 * rather than fatal — the reading `resolveFall` already takes of the same
 * pairing, where "you then have the Prone condition" and a Prone immunity meet.
 *
 * **This is the only ending anything writes.** The book's other three —
 * "doused, submerged, or suffocated" — have no writer and no door: what they
 * would need is a world with water in it. Saying they are "the table's" would
 * be a handover with nowhere to hand to, so they are named here as the gap
 * they are, and the day a DM can rule one it emits `hazard-ended` like this.
 */
export function extinguishFire(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity = {},
): Result<GameEvent[]> {
  return once(state, `extinguish:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose
    // start has not arrived. **After the duplicate check, never before it.**
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id, 'has no record here yet; add it first');
    if (!caughtIn(state, id, 'burning')) {
      return err('not_burning', `${id} is not burning, and there is no fire here to put out`);
    }
    if (state.combat === null) {
      return err(
        'not_in_combat',
        'an Action is a thing a turn holds; outside combat there is no turn to spend one on',
      );
    }

    const spent = spendAction(state.combat, id, creature.conditions, {
      rules: actionRulesOn(state, id),
    });
    if (!spent.ok) return spent;

    const events: GameEvent[] = [
      { type: 'action-spent', id },
      { type: 'hazard-ended', id, hazard: 'burning', ...(stamp === null ? {} : { command: stamp }) },
    ];
    // Applied through the door every condition comes in by, and **after** the
    // fire is out: a creature immune to Prone ends up standing with the flames
    // gone rather than kneeling in them.
    const floored = applyConditionTo(
      events.reduce(applyEvent, state),
      id,
      'prone',
      hazardSource('burning'),
    );
    if (floored.ok) events.push(...floored.value);

    return ok(events);
  });
}

