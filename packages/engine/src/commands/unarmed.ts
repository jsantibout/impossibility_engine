/**
 * The Unarmed Strike's other two options: Grapple and Shove.
 *
 * SRD 2024 prints three options under one heading — Damage, Grapple, Shove —
 * and until this module only the first was modelled. The two here are the ones
 * a level 5 table reaches for constantly and the ones a DM had to fake with a
 * pair of ability checks and a ruling.
 *
 * **2024 changed the mechanism, and the change is the whole of the care this
 * module takes.** In 2014 both were opposed checks: the grappler rolled
 * Athletics and the target rolled Athletics or Acrobatics against it. In 2024
 * there is no contest anywhere in the rules — the grappler rolls *nothing*,
 * and the target makes "a Strength or Dexterity saving throw (it chooses
 * which)" against a fixed DC of "8 plus your Strength modifier and Proficiency
 * Bonus". Porting the 2014 shape would put a die in the striker's hand that
 * the book does not give them and would make the outcome depend on two rolls
 * where it depends on one.
 *
 * **Its own module rather than a region of `commands/attacks.ts`.** Nothing
 * here is an attack roll: there is no Armour Class, no hit, no critical, no
 * damage and no reaction window. What it shares with an attack is the *action*
 * — see `unarmed-strike-made` in `events.ts` for the one event that says both
 * halves of that at once.
 *
 * **And nothing here is new machinery either.** The save is the ordinary
 * saving-throw path; Grappled and Prone are conditions with sources; the
 * escape DC is pinned on the timer every ongoing condition already hangs from;
 * the push is the forced `creature-moved` SRD Push's mastery property already
 * writes.
 */

import {
  type CharacterId,
  err,
  type Err,
  ok,
  type Result,
  type RollMode,
} from '@ie/shared';
import { CREATURE_SIZES, type CreatureSize } from '@ie/srd/schemas';
import { type Bonus, type ModeSource } from '../bonuses.js';
import { modifierFor, proficiencyBonus } from '../character.js';
import { rollAbilityCheck, rollSavingThrow, type D20TestResult } from '../checks.js';
import { spendAction, spendAttack } from '../combat.js';
import { conditionInstanceId, isIncapacitated } from '../conditions.js';
import { applyEvent, type CommandStamp, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { attacksInAction, statedBonusActionsUsed } from '../monster.js';
import {
  apartFrom,
  bearingBetween,
  moveCreature,
  sizeAtMost,
  sizeOf,
} from '../positioning.js';
import { actionRulesOn, effectiveConditions, rollModesFor, sheetAsItStands } from '../standing.js';
import { timerKey } from '../timers.js';
import { type Supply } from './casting.js';
import { creatureOf, reachedBy, unknownCreature } from './command.js';
import { applyConditionTo } from './conditions.js';
import { mayAct } from './holds.js';
import { checkBonuses, recordD20Test, savingSupport } from './rolls.js';

/**
 * SRD Unarmed Strike: "a target **within 5 feet** of you".
 *
 * The engine's, not the catalogue's: the Unarmed Strike is a rule in the same
 * sense the Prone condition is, and no weapon record says how far a fist
 * reaches. It is also the grapple's **range**, which is the distance SRD
 * Grappling says a grapple ends past.
 */
export const UNARMED_REACH = 5;

/** SRD Shove: "you either push it **5 feet** away or cause it to have the Prone condition". */
export const SHOVE_FEET = 5;

/**
 * Which saving throw the target chose to make.
 *
 * SRD writes "(it chooses which)" on both options, so this is the **target's**
 * decision arriving as a fact rather than the engine picking the one that
 * happens to be worse for them. Two members rather than `Ability`, because a
 * Constitution save against a shove is not a thing the book offers and a type
 * that admitted one would need a refusal to take it back.
 */
export type SaveChoice = 'str' | 'dex';

/**
 * Which check the escaping creature chose to make, and the skill that goes
 * with it.
 *
 * SRD Grappling: "a Strength (Athletics) **or** Dexterity (Acrobatics) check".
 * The pairing is the book's, so the caller names the ability and the engine
 * names the skill — a caller that could name the skill could pair Athletics
 * with Dexterity, which is not an escape the book prints.
 */
const ESCAPE_SKILL = { str: 'athletics', dex: 'acrobatics' } as const;

/**
 * What a grapple files its Grappled condition under.
 *
 * **The grappler's id is inside the string on purpose.** A condition instance
 * is `(condition, source)` and the source is free text, so a grapple that
 * wrote "a grapple" could not be told from another creature's — and SRD ends
 * the condition on facts about *the grappler*: that they are Incapacitated,
 * that they are now too far away, that they let go. `castingIdOf` reads a
 * casting out of a source string for exactly the same reason, and
 * {@link grapplerOf} is this one's inverse.
 */
export const grappleSource = (grappler: CharacterId): string => `grapple:${grappler}`;

/** Who is doing the grappling, read back out of the source. Null for any other cause. */
export const grapplerOf = (source: string): CharacterId | null =>
  source.startsWith('grapple:') ? (source.slice('grapple:'.length) as CharacterId) : null;

/** SRD Shove: "you either push it 5 feet away **or** cause it to have the Prone condition". */
export type ShoveOutcome = 'prone' | 'push';

export interface GrappleCommand extends CommandIdentity {
  readonly target: CharacterId;
  /** SRD: "a Strength or Dexterity saving throw (it chooses which)". */
  readonly save: SaveChoice;
  /** Advantage or Disadvantage the table knows about and the engine does not. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Named modifiers the table supplies. */
  readonly bonuses?: readonly Bonus[];
}

export interface ShoveCommand extends GrappleCommand {
  /**
   * SRD Shove: "**you** either push it 5 feet away or cause it to have the
   * Prone condition" — the shover's choice, and taken before the save because
   * the choice is not a reaction to how the die fell.
   */
  readonly outcome: ShoveOutcome;
}

export interface UnarmedResolution {
  readonly events: readonly GameEvent[];
  /** The target's save, or null when this command id had already been applied. */
  readonly save: D20TestResult | null;
  /** The DC it was made against, pinned from the striker's sheet. */
  readonly dc: number | null;
  /** Whether the option actually landed: the save failed and the effect took. */
  readonly applied: boolean;
  /** Facts the engine could not check — see `AttackResolution.unverified`. */
  readonly unverified: readonly string[];
  readonly duplicate: boolean;
}

const REPLAYED: UnarmedResolution = {
  events: [],
  save: null,
  dc: null,
  applied: false,
  unverified: [],
  duplicate: true,
};

/**
 * The size one step up from a creature's own.
 *
 * SRD prints the limit as a *relation* — "no more than one size larger than
 * you" — rather than as a named ceiling, which is the one shape
 * {@link sizeAtMost} cannot be asked directly. Computed off the same ordered
 * list the engine ranks sizes by, so a seventh size is admitted by the one
 * place sizes are ordered rather than by a literal nobody updated. Gargantuan
 * is its own answer: there is nothing above it to step to.
 */
const oneLargerThan = (size: CreatureSize): CreatureSize =>
  CREATURE_SIZES[Math.min(CREATURE_SIZES.indexOf(size) + 1, CREATURE_SIZES.length - 1)]!;

/**
 * How big a creature is, and whether anybody actually said.
 *
 * What somebody stated beats what the map assumed, which is the reading
 * `masteryAfterHit`'s Push already takes: a stat block pins a size into
 * `creature-added`, and a placement defaults an unstated one to Medium — so
 * asking the map first answers "Medium" for a Gargantuan creature nobody
 * re-stated when they placed it.
 */
const sizeStated = (state: GameState, who: CharacterId): CreatureSize | null =>
  state.creatures[who]?.size ?? (state.scene === null ? null : sizeOf(state.scene, who));

/**
 * SRD Grapple and SRD Shove: "possible only if the target is no more than one
 * size larger than you".
 *
 * A refusal rather than a quiet no-op, because the book refuses the *attempt*:
 * a character who tries to grab a Storm Giant has not spent their Attack
 * action on nothing, they have been told they cannot. Where nobody has said
 * how big either of them is, both are taken for Medium — the default a
 * placement already applies — and the assumption is reported rather than
 * hidden.
 */
function sizeProblem(
  state: GameState,
  striker: CharacterId,
  target: CharacterId,
  what: string,
  unverified: string[],
): Err | null {
  const mine = sizeStated(state, striker);
  const theirs = sizeStated(state, target);
  if (mine === null || theirs === null) {
    unverified.push(
      `nobody has said how big ${mine === null ? striker : target} is, so ${what} took them for Medium; ` +
        'a creature more than one size larger cannot be grabbed or shoved',
    );
  }
  const limit = oneLargerThan(mine ?? 'medium');
  if (sizeAtMost(theirs ?? 'medium', limit)) return null;
  return err(
    'too_large',
    `${target} is ${theirs}, and ${what} reaches a creature no more than one size larger than ${striker}, which is ${limit}`,
  );
}

/**
 * Spend the attack the Unarmed Strike costs, where there is an economy to
 * spend it in.
 *
 * SRD: "When you take the Attack action, you can make one attack roll with a
 * weapon or an Unarmed Strike", and all three of the Unarmed Strike's options
 * are that one attack — so Extra Attack buys a grapple *and* a punch, and the
 * arithmetic is `spendAttack`'s rather than a second reading of it here. The
 * count is the same question `resolveAttack` and the fold both ask, with the
 * same inputs.
 *
 * Outside combat there is nothing to spend, exactly as a Dodge finds.
 */
function strikeSpend(
  state: GameState,
  striker: CharacterId,
  option: 'grapple' | 'shove',
): Result<readonly GameEvent[]> {
  const combat = state.combat;
  const creature = creatureOf(state, striker);
  if (combat === null || creature === null || combat.budgets[striker] === undefined) {
    return ok([]);
  }

  const spent = spendAttack(
    combat,
    striker,
    attacksInAction(
      creature.sheet,
      creature.heads,
      statedBonusActionsUsed(
        combat.budgets[striker]?.featureUsedOnTurn ?? {},
        combat.turnsTaken,
      ),
    ),
    creature.conditions,
    { rules: actionRulesOn(state, striker) },
  );
  if (!spent.ok) return spent;

  return ok([{ type: 'unarmed-strike-made', id: striker, option }]);
}

/**
 * Everything both options check before either of them throws a die, in the
 * order a refusal costs least.
 *
 * Reach before size, because an unplaced creature has no size the map can
 * answer for either — so the request for a position arrives first and the size
 * question is answerable by the time it is asked.
 */
function strikeProblem(
  state: GameState,
  striker: CharacterId,
  target: CharacterId,
  what: string,
  unverified: string[],
): Err | null {
  if (creatureOf(state, striker) === null) return unknownCreature(striker);
  if (creatureOf(state, target) === null) return unknownCreature(target);
  if (striker === target) {
    return err('self_target', `${striker} cannot ${what.split(' ')[0]} themselves`);
  }

  const owedHere = mayAct(state, striker);
  if (owedHere !== null) return owedHere;

  const reach = reachedBy(state, striker, target, what, UNARMED_REACH);
  if (reach !== null) return reach;

  return sizeProblem(state, striker, target, what, unverified);
}

/**
 * The saving throw both options impose, rolled against the striker's own DC.
 *
 * SRD: "The DC for the saving throw ... equals 8 plus your Strength modifier
 * and Proficiency Bonus." Read off the striker's sheet **as it stands**, so a
 * Belt of Giant Strength is behind the grab, and pinned into the resolution
 * and — for a grapple — onto the timer, because the escape may be attempted an
 * hour later by which time the sheet may say something else.
 */
function imposeSave(
  state: GameState,
  striker: CharacterId,
  command: GrappleCommand,
  supply: Supply,
  label: string,
  outcomes: readonly [string, string],
): Result<{ readonly events: GameEvent[]; readonly save: D20TestResult; readonly dc: number }> {
  const attacker = creatureOf(state, striker);
  const victim = creatureOf(state, command.target);
  if (attacker === null || victim === null) return unknownCreature(striker);

  const striking = sheetAsItStands(state, striker) ?? attacker.sheet;
  const dc = 8 + modifierFor(striking, 'str') + proficiencyBonus(striking);

  const issuedBefore = supply.issuer.count;
  const sheet = sheetAsItStands(state, command.target) ?? victim.sheet;
  const support = savingSupport(state, command.target, victim, command.save, {
    bonuses: command.bonuses,
    modes: command.modes,
  });
  const save = rollSavingThrow(supply.issuer, supply.rng, sheet, command.save, {
    dc,
    conditions: support.conditions,
    modes: support.modes,
    bonuses: support.bonuses,
  });
  if (!save.ok) return save;

  return ok({
    events: [
      recordD20Test(
        command.target,
        label,
        save.value,
        save.value.success ? outcomes[0] : outcomes[1],
      ),
      {
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
      },
    ],
    save: save.value,
    dc,
  });
}

/** The stamp rides on the save, which is the one roll that happens either way. */
const stamped = (events: readonly GameEvent[], stamp: CommandStamp | null): GameEvent[] =>
  events.map((event) =>
    event.type === 'roll-recorded' && stamp !== null ? { ...event, command: stamp } : event,
  );

/**
 * SRD Grapple: "The target must succeed on a Strength or Dexterity saving
 * throw (it chooses which), or it has the Grappled condition. The DC for the
 * saving throw and any escape attempts equals 8 plus your Strength modifier
 * and Proficiency Bonus. This grapple is possible only if the target is no
 * more than one size larger than you and if you have a hand free to grab it."
 *
 * **The free hand is reported rather than checked.** The engine holds what a
 * creature has equipped and holds nothing about hands: a Longsword and a
 * Shield say nothing here that a Longsword alone does not, and inventing a
 * hand count would be the engine deciding a rule off a record that does not
 * carry it. So a second grapple *by the same grappler on the same target* is
 * refused — it is the one case the state can answer — and the hand itself is
 * an unverified fact the DM sees.
 */
export function grappleTarget(
  state: GameState,
  grappler: CharacterId,
  command: GrappleCommand,
  supply: Supply,
): Result<UnarmedResolution> {
  return once(state, `grapple:${grappler}`, command, () => REPLAYED, (stamp) => {
    const unverified: string[] = [];
    const problem = strikeProblem(state, grappler, command.target, 'a Grapple', unverified);
    if (problem !== null) return problem;

    const source = grappleSource(grappler);
    const already = (state.creatures[command.target]?.conditions.instances ?? []).some(
      (instance) => instance.condition === 'grappled' && instance.source === source,
    );
    if (already) {
      return err(
        'already_grappled',
        `${grappler} is already grappling ${command.target}, and a grappler can hold one creature with one hand`,
      );
    }
    unverified.push(
      `SRD Grapple needs ${grappler} to have a hand free, and the engine holds no record of hands`,
    );

    const spend = strikeSpend(state, grappler, 'grapple');
    if (!spend.ok) return spend;

    const rolled = imposeSave(state, grappler, command, supply, 'save against a Grapple', [
      'twisted free',
      'grabbed',
    ]);
    if (!rolled.ok) return rolled;

    const events = [...spend.value, ...stamped(rolled.value.events, stamp)];
    if (rolled.value.save.success) {
      return ok({ events, save: rolled.value.save, dc: rolled.value.dc, applied: false, unverified, duplicate: false });
    }

    // **The escape DC is pinned here and read nowhere else.** SRD makes the
    // grapple's DC and the escape's one number, and an escape attempted an
    // hour later must be against the number the grapple was made at — the same
    // rule `EffectCheck.dc` already states for a spell. The check is filed as
    // the Strength half of the SRD's pair so that the generic door
    // (`availableChecks` / `resolveEffectCheck`) answers truthfully; the other
    // half is {@link escapeGrapple}'s, because `EffectCheck` holds one ability
    // and the book offers two.
    const grabbed = applyConditionTo(
      events.reduce(applyEvent, state),
      command.target,
      'grappled',
      source,
      [],
      undefined,
      undefined,
      {},
      {
        ability: 'str',
        skill: ESCAPE_SKILL.str,
        dc: rolled.value.dc,
        onSuccess: 'end-on-target',
        label: `check to escape ${grappler}'s grapple`,
      },
    );
    // A creature immune to Grappled is not grabbed, and the Attack action was
    // still spent on the attempt — the reading `topple` takes of the same case.
    if (!grabbed.ok) {
      return ok({ events, save: rolled.value.save, dc: rolled.value.dc, applied: false, unverified: [...unverified, grabbed.reason], duplicate: false });
    }

    return ok({
      events: [...events, ...grabbed.value],
      save: rolled.value.save,
      dc: rolled.value.dc,
      applied: true,
      unverified,
      duplicate: false,
    });
  });
}

/**
 * SRD Shove: "The target must succeed on a Strength or Dexterity saving throw
 * (it chooses which), or you either push it 5 feet away or cause it to have
 * the Prone condition. The DC for the saving throw equals 8 plus your Strength
 * modifier and Proficiency Bonus. This shove is possible only if the target is
 * no more than one size larger than you."
 *
 * **Two differences from the Grapple, and both are the book's.** There is no
 * free hand in the sentence, and there is no escape: a shove is over the
 * moment it lands, so nothing is pinned and nothing is scheduled. The push is
 * the forced `creature-moved` SRD Push already writes — five feet straight
 * away, measured on the same lattice as everything else, spending no Speed and
 * provoking nobody.
 */
export function shoveTarget(
  state: GameState,
  shover: CharacterId,
  command: ShoveCommand,
  supply: Supply,
): Result<UnarmedResolution> {
  return once(state, `shove:${shover}`, command, () => REPLAYED, (stamp) => {
    const unverified: string[] = [];
    const problem = strikeProblem(state, shover, command.target, 'a Shove', unverified);
    if (problem !== null) return problem;

    const spend = strikeSpend(state, shover, 'shove');
    if (!spend.ok) return spend;

    const rolled = imposeSave(state, shover, command, supply, 'save against a Shove', [
      'stood firm',
      command.outcome === 'prone' ? 'knocked down' : 'driven back',
    ]);
    if (!rolled.ok) return rolled;

    const events = [...spend.value, ...stamped(rolled.value.events, stamp)];
    const settled = (extra: readonly GameEvent[], applied: boolean, notes: readonly string[] = []) =>
      ok({
        events: [...events, ...extra],
        save: rolled.value.save,
        dc: rolled.value.dc,
        applied,
        unverified: [...unverified, ...notes],
        duplicate: false,
      });

    if (rolled.value.save.success) return settled([], false);

    if (command.outcome === 'prone') {
      const floored = applyConditionTo(
        events.reduce(applyEvent, state),
        command.target,
        'prone',
        `a Shove by ${shover}`,
      );
      // A creature immune to Prone stays standing, and the shove still happened.
      return floored.ok ? settled(floored.value, true) : settled([], false, [floored.reason]);
    }

    return settled(...pushed(state, shover, command.target));
  });
}

/**
 * Five feet straight away from the shover.
 *
 * **Anchored on the creature being moved**, which is the correction
 * `masteryAfterHit`'s Push already carries: a placement measured from the
 * shover adds a box-to-box distance to an anchor-to-anchor projection, and
 * those are the same number only while both of them are Medium.
 *
 * **Asked before it is written.** `creature-moved` is applied by the fold
 * through `must`, so an event the scene would refuse — a shove into a wall, or
 * into an occupied space — would be a log that cannot be folded rather than a
 * refusal. A push with nowhere to go simply does not happen, and says so.
 */
function pushed(
  state: GameState,
  shover: CharacterId,
  target: CharacterId,
): [readonly GameEvent[], boolean, readonly string[]] {
  const scene = state.scene;
  if (scene === null) {
    return [[], false, [`nobody has said where anybody is standing, so ${target} was not pushed`]];
  }

  const bearing = bearingBetween(scene, shover, target);
  if (!bearing.ok) return [[], false, [bearing.reason]];

  const placement = {
    from: { creature: target },
    feet: SHOVE_FEET,
    bearing: bearing.value,
  } as const;

  const moved = moveCreature(scene, target, placement, { forced: true });
  if (!moved.ok) return [[], false, [`${target} could not be pushed: ${moved.reason}`]];

  // Nobody spent their Speed on this and nobody provoked anything.
  return [[{ type: 'creature-moved', id: target, placement, forced: true }], true, []];
}

/**
 * A grapple somebody is currently holding on somebody.
 *
 * Derived off the condition instance rather than stored: the source names the
 * grappler and the timer holds the DC, so there is no second record to keep in
 * step with the first.
 */
export interface HeldGrapple {
  readonly grappler: CharacterId;
  readonly target: CharacterId;
  /** The condition instance's cause — what `liftConditionFrom` ends. */
  readonly source: string;
  /** The timer the escape DC is pinned on. */
  readonly effectKey: string;
}

/** Every grapple currently held on this creature. */
export function grapplesOn(state: GameState, target: CharacterId): readonly HeldGrapple[] {
  return (state.creatures[target]?.conditions.instances ?? []).flatMap((instance) => {
    if (instance.condition !== 'grappled') return [];
    const grappler = grapplerOf(instance.source);
    if (grappler === null) return [];
    return [
      {
        grappler,
        target,
        source: instance.source,
        effectKey: timerKey({
          kind: 'condition',
          on: target,
          instance: conditionInstanceId('grappled', instance.source),
        }),
      },
    ];
  });
}

/** A grapple the rules have ended, and which of the two sentences ended it. */
export interface LapsedGrapple {
  readonly grappler: CharacterId;
  readonly target: CharacterId;
  readonly source: string;
  readonly reason: 'incapacitated' | 'out-of-range';
}

/**
 * The grapples SRD has ended and the log has not.
 *
 * SRD Grappling: "The condition also ends if the grappler has the
 * Incapacitated condition or if the distance between the Grappled target and
 * the grappler exceeds the grapple's range."
 *
 * **A question rather than an event, and the reason is where the facts are.**
 * Every other automatic ending in the engine is a fact about the creature the
 * effect sits on — `EffectEndCause`'s four causes all name one — and these two
 * are facts about *somebody else*: the grappler's conditions, and a distance
 * between two creatures. The fold reduces one creature at a time and holds no
 * grapple record to hang a third party's deadline on, so it cannot notice
 * either. `withheldEndings` is the precedent: where the engine can state the
 * rule but not raise the moment, it answers the question and the layer above
 * acts on it — here with `liftConditionFrom`, which is also the release SRD
 * gives the grappler "at any time (no action required)".
 *
 * **Nothing is invented from silence.** A distance nobody has stated is null
 * rather than infinite, so an unplaced pair keeps its grapple; positions are
 * declared and an absent one is a gap in a record, not a fact about the world.
 */
export function lapsedGrapples(state: GameState): readonly LapsedGrapple[] {
  return Object.keys(state.creatures)
    .sort()
    .flatMap((who) =>
      grapplesOn(state, who as CharacterId).flatMap((held): LapsedGrapple[] => {
        const common = { grappler: held.grappler, target: held.target, source: held.source };
        if (isIncapacitated(effectiveConditions(state, held.grappler))) {
          return [{ ...common, reason: 'incapacitated' }];
        }
        const apart = apartFrom(state, held.grappler, held.target);
        return apart !== null && apart > UNARMED_REACH
          ? [{ ...common, reason: 'out-of-range' }]
          : [];
      }),
    );
}

export interface EscapeCommand extends CommandIdentity {
  /** SRD: "a Strength (Athletics) or Dexterity (Acrobatics) check" — the escaper's choice. */
  readonly ability: SaveChoice;
  /** Which grapple, where more than one creature is holding on. */
  readonly grappler?: CharacterId;
  /** Advantage or Disadvantage the table knows about and the engine does not. */
  readonly modes?: readonly (RollMode | ModeSource)[];
  /** Named modifiers the table supplies: Guidance's 1d4, a Bardic die. */
  readonly bonuses?: readonly Bonus[];
}

export interface EscapeResolution {
  readonly events: readonly GameEvent[];
  /** The check, or null when this command id had already been applied. */
  readonly check: D20TestResult | null;
  readonly success: boolean;
  readonly duplicate: boolean;
}

/**
 * SRD Grappling: "A Grappled creature can use its action to make a Strength
 * (Athletics) or Dexterity (Acrobatics) check against the grapple's escape DC,
 * ending the condition on itself on a success."
 *
 * **Here rather than through `resolveEffectCheck`, and for one reason only:
 * the book offers two abilities and `EffectCheck` holds one.** Every other
 * number is the same one that door would use — the DC is read off the very
 * timer the grapple pinned it on, the Action is spent by the same rule, and
 * the consequence is the same `effect-check-resolved` the reducer turns into a
 * release, so a success cannot drift from the roll that caused it. The grapple
 * files its check as the Strength half, so `availableChecks` still advertises
 * a true escape and `resolveEffectCheck` still performs one; what this adds is
 * the Dexterity half of the same sentence. Widening `EffectCheck` with an
 * alternative would let both doors become one, and is a change to a vocabulary
 * this command does not own.
 */
export function escapeGrapple(
  state: GameState,
  who: CharacterId,
  command: EscapeCommand,
  supply: Supply,
): Result<EscapeResolution> {
  return once(
    state,
    `escape-grapple:${who}`,
    command,
    () => ({ events: [], check: null, success: false, duplicate: true }),
    (stamp) => {
      // A mandatory effect this creature has been caught by, or a turn whose
      // start has not arrived. **After the duplicate check, never before it.**
      const owedHere = mayAct(state, who);
      if (owedHere !== null) return owedHere;

      const creature = creatureOf(state, who);
      if (creature === null) return unknownCreature(who);

      const held = grapplesOn(state, who).filter(
        (grapple) => command.grappler === undefined || grapple.grappler === command.grappler,
      );
      if (held.length === 0) {
        return err(
          'not_grappled',
          command.grappler === undefined
            ? `nothing has ${who} in a grapple`
            : `${command.grappler} does not have ${who} in a grapple`,
        );
      }
      // **Which grapple is the escaper's to name.** Two creatures can each
      // hold one, and a success ends one of them: choosing for the caller
      // would be the engine deciding which arm to pull against.
      if (held.length > 1) {
        return err(
          'several_grapples',
          `${who} is grappled by ${held.map((grapple) => grapple.grappler).join(' and ')}; name which one this escapes`,
        );
      }

      const grapple = held[0]!;
      const timer = state.timers[grapple.effectKey];
      if (timer?.check === undefined) {
        return err(
          'no_escape_dc',
          `the grapple on ${who} has no escape DC pinned, so there is nothing to check against`,
        );
      }

      // Nothing is rolled until the whole operation is known to be valid, so a
      // refusal costs neither the Action nor a turn of the generator.
      const events: GameEvent[] = [];
      const combat = state.combat;
      if (combat !== null && combat.budgets[who] !== undefined) {
        const spent = spendAction(combat, who, creature.conditions, {
          rules: actionRulesOn(state, who),
        });
        if (!spent.ok) return spent;
        events.push({ type: 'action-spent', id: who });
      }

      const skill = ESCAPE_SKILL[command.ability];
      const issuedBefore = supply.issuer.count;
      const fromFeatures = rollModesFor(state, {
        family: 'ability-check',
        roller: who,
        ability: command.ability,
        skill,
      }).modes;
      const sheet = sheetAsItStands(state, who) ?? creature.sheet;
      const rolled = rollAbilityCheck(supply.issuer, supply.rng, sheet, command.ability, {
        dc: timer.check.dc,
        skill,
        conditions: effectiveConditions(state, who),
        modes: [...fromFeatures, ...(command.modes ?? [])],
        bonuses: checkBonuses(state, who, command.bonuses, skill),
      });
      if (!rolled.ok) return rolled;

      events.push(
        {
          type: 'rolls-issued',
          count: supply.issuer.count - issuedBefore,
          rng: supply.rng.snapshot(),
        },
        {
          ...recordD20Test(
            who,
            `check to escape ${grapple.grappler}'s grapple`,
            rolled.value,
            rolled.value.success ? 'tore free' : 'still held',
          ),
          ...(stamp === null ? {} : { command: stamp }),
        },
        // The consequence is the reducer's, off the outcome it recorded.
        {
          type: 'effect-check-resolved',
          effectKey: grapple.effectKey,
          by: who,
          success: rolled.value.success,
        },
      );

      return ok({
        events,
        check: rolled.value,
        success: rolled.value.success,
        duplicate: false,
      });
    },
  );
}
