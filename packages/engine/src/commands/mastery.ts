/**
 * What a weapon's mastery property does once a character has unlocked it.
 *
 * The eight properties were parsed onto the weapons that print them long
 * before anything could run one, because the thing they hang off is a
 * *record* — which weapons this character has mastery with — and no choice in
 * the vocabulary could hold it. The record lives on the sheet now, and this is
 * the half that happens.
 *
 * **Nothing here is new machinery.** Every property routes through an event
 * the engine already writes: Graze is damage landed without a hit, Push is a
 * forced `creature-moved`, Slow is a `speed-modifier-granted` under a shared
 * source with a `grants` deadline, Topple is the ordinary saving-throw path
 * with Prone on a failure, and Sap and Vex are the one-shot roll modifiers SRD
 * Vicious Mockery and Guiding Bolt already spend. Cleave is a second attack
 * roll, which is the attack command itself.
 *
 * **Two of the eight are not here, and only one of them is unbuilt.** Nick is
 * not an after-the-hit rider at all: it changes what **pays** for the extra
 * attack the Light property buys, which is the action economy's, so it lives
 * in `commands/attacks.ts` beside the swing it re-prices. The Long Rest
 * re-choice is the one that is not built, and it is an option re-answered,
 * which a choice frozen at creation is not.
 */
import { err, ok, type Ability, type CharacterId, type Result } from '@ie/shared';
import type { WeaponMastery } from '@ie/srd';
import { modifierFor, proficiencyBonus } from '../character.js';
import { applyConditionTo, schedule } from './conditions.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { bearingBetween, moveCreature, sizeAtMost, sizeOf } from '../positioning.js';
import { rollSavingThrow } from '../checks.js';
import { endOfNextTurn, startOfNextTurn, type Duration } from '../time.js';
import { recordD20Test, savingSupport } from './rolls.js';
import { sheetAsItStands } from '../standing.js';
import { type Supply } from './casting.js';
import { creatureOf } from './command.js';

/**
 * How far Push moves a creature, how far Slow takes off a Speed, and how far
 * Cleave reaches from the first target.
 *
 * The SRD prints these three numbers in the property definitions rather than
 * on any weapon, class or item, which is what makes them the engine's to hold:
 * a mastery property is a **rule** in the same sense the Prone condition is,
 * and the catalogue's part is only which weapon prints which property.
 */
const PUSH_FEET = 10;
const SLOW_FEET = 10;
export const CLEAVE_REACH = 5;

/** SRD Push: "if it is **Large or smaller**". */
const PUSHABLE_UP_TO = 'large';

/**
 * How the log names what a mastery property hung on somebody.
 *
 * SRD Slow: "If the creature is hit more than once by weapons that have this
 * property, the Speed reduction doesn't exceed 10 feet" — one source for every
 * attacker, so the second hit **replaces** the first rather than stacking,
 * which is the rule every sourced grant already keeps. Sap is the same
 * sentence about one creature's next attack roll.
 *
 * Vex is the exception the SRD writes: "Advantage on your next attack roll
 * **against that creature**", so an attacker who hits two creatures in one
 * turn holds two of them — which is what the counterpart in the key buys, and
 * why this one takes the creature it is about.
 */
const masterySource = (property: WeaponMastery, about?: CharacterId): string =>
  about === undefined ? `weapon-mastery:${property}` : `weapon-mastery:${property}@${about}`;

/**
 * Whether what the attacker asked for is a distance Push can move somebody.
 *
 * Asked by the command **before the attack roll**, for the reason every other
 * caller-supplied argument is: a refusal that arrives after the damage has
 * landed is a refusal with a footprint.
 */
export function masteryArgumentProblem(
  property: WeaponMastery | null,
  feet: number | undefined,
): Result<null> {
  if (feet === undefined) return ok(null);
  if (property !== 'push') {
    return err('bad_amount', `only Push moves a creature a number of feet, not ${property ?? 'a weapon with no mastery property'}`);
  }
  if (!Number.isInteger(feet) || feet < 0 || feet > PUSH_FEET) {
    return err('bad_amount', `Push moves a creature up to ${PUSH_FEET} feet, not ${feet}`);
  }
  return ok(null);
}

export interface MasteryOutcome {
  readonly events: readonly GameEvent[];
  /** What the engine could not check — a size nobody has stated. */
  readonly unverified: readonly string[];
}

const NOTHING: MasteryOutcome = { events: [], unverified: [] };

/** What a hit with a mastered weapon needs to know about itself. */
export interface MasteryHit {
  readonly attacker: CharacterId;
  readonly target: CharacterId;
  readonly property: WeaponMastery;
  /** The ability the attack roll used, for Topple's DC. */
  readonly ability: Ability;
  /** SRD Push: "up to 10 feet". Absent pushes the whole ten. */
  readonly feet?: number;
  /** Whether the blow actually took hit points off, for Slow and Vex. */
  readonly dealtDamage: boolean;
}

/**
 * Everything a mastery property does after the blow has landed.
 *
 * Called from both halves of the attack path — the swing that rolls its own
 * damage and the held one that rolls it a command later — because a property
 * wired into one of them would be a rule a Divine Smite silently switched off.
 *
 * The state handed in is the world **after** the damage, folded, which is what
 * lets Slow read a Speed that a condition may already have changed and Topple
 * roll a save the blow itself could have altered.
 */
export function masteryAfterHit(
  state: GameState,
  supply: Supply,
  hit: MasteryHit,
): Result<MasteryOutcome> {
  switch (hit.property) {
    case 'slow':
      return slow(state, hit);
    case 'sap':
      return sap(state, hit);
    case 'vex':
      return vex(state, hit);
    case 'push':
      return push(state, hit);
    case 'topple':
      return topple(state, supply, hit);
    // Cleave is a second attack roll and Graze answers a miss, so neither is
    // an after-the-hit rider; Nick is the action economy's and is priced by
    // `resolveAttack`'s `lightAttack` rather than by anything that happens
    // after a blow lands.
    default:
      return ok(NOTHING);
  }
}

/**
 * SRD Slow: "If you hit a creature with this weapon and deal damage to it, you
 * can reduce its Speed by 10 feet until the start of your next turn."
 */
function slow(state: GameState, hit: MasteryHit): Result<MasteryOutcome> {
  if (!hit.dealtDamage) return ok(NOTHING);
  const turnless = noTurns(state, 'Slow');
  if (turnless !== null) return turnless;

  const source = masterySource('slow');
  const events: GameEvent[] = [
    {
      type: 'speed-modifier-granted',
      id: hit.target,
      modifier: { source, change: 'add', feet: -SLOW_FEET },
    },
  ];

  const timer = schedule(
    events.reduce(applyEvent, state),
    { kind: 'grants', on: hit.target, source },
    startOfNextTurn(hit.attacker),
  );
  if (!timer.ok) return timer;

  return ok({ events: [...events, timer.value], unverified: [] });
}

/**
 * SRD Sap: "that creature has Disadvantage on its next attack roll before the
 * start of your next turn."
 */
function sap(state: GameState, hit: MasteryHit): Result<MasteryOutcome> {
  const turnless = noTurns(state, 'Sap');
  if (turnless !== null) return turnless;

  const source = masterySource('sap');
  return hung(
    state,
    {
      type: 'roll-modifier-granted',
      id: hit.target,
      modifier: {
        source,
        modifier: {
          mode: 'disadvantage',
          selector: { roll: 'attack', relation: 'roller' },
          oneShot: true,
        },
      },
    },
    { on: hit.target, source },
    startOfNextTurn(hit.attacker),
  );
}

/**
 * SRD Vex: "if you hit a creature with this weapon and deal damage to the
 * creature, you have Advantage on your next attack roll against that creature
 * before the end of your next turn."
 */
function vex(state: GameState, hit: MasteryHit): Result<MasteryOutcome> {
  if (!hit.dealtDamage) return ok(NOTHING);
  const turnless = noTurns(state, 'Vex');
  if (turnless !== null) return turnless;

  const source = masterySource('vex', hit.target);
  return hung(
    state,
    {
      type: 'roll-modifier-granted',
      id: hit.attacker,
      modifier: {
        source,
        modifier: {
          mode: 'advantage',
          // "against that creature": the participant the relation does not
          // name, which is what `counterpart` was written for.
          selector: { roll: 'attack', relation: 'roller', counterpart: hit.target },
          oneShot: true,
        },
      },
    },
    { on: hit.attacker, source },
    endOfNextTurn(hit.attacker),
  );
}

/**
 * Three of the properties end at a turn boundary, and outside combat there is
 * no such boundary to end at.
 *
 * SRD writes Slow, Sap and Vex as lasting "until the start of your next turn"
 * or "before the end of your next turn", and `schedule` refuses a turn anchor
 * where there are no turns — rightly, because a deadline nothing can reach is
 * a grant that runs for ever. So the property does not apply and the reason is
 * reported: the swing itself is unaffected, which is the difference between a
 * rider the engine cannot time and a refusal.
 */
function noTurns(state: GameState, property: string): Result<MasteryOutcome> | null {
  if (state.combat !== null) return null;
  return ok({
    events: [],
    unverified: [
      `${property} lasts until a turn boundary, and there are no turns outside combat; it was not applied`,
    ],
  });
}

/**
 * A grant and the deadline that ends it, filed together.
 *
 * Both endings stand for a one-shot modifier and the first to arrive wins: one
 * the next attack roll spends leaves its timer standing over nothing, and one
 * nobody spends ends at the turn boundary its sentence names. That is the rule
 * `roll-modifier-consumed` already documents, and it is the reason every
 * property here files a deadline even where a roll would have spent the grant.
 */
function hung(
  state: GameState,
  granted: GameEvent,
  target: { readonly on: CharacterId; readonly source: string },
  duration: Duration,
): Result<MasteryOutcome> {
  const timer = schedule(
    applyEvent(state, granted),
    { kind: 'grants', on: target.on, source: target.source },
    duration,
  );
  if (!timer.ok) return timer;
  return ok({ events: [granted, timer.value], unverified: [] });
}

/**
 * SRD Push: "you can push the creature up to 10 feet straight away from
 * yourself if it is Large or smaller."
 *
 * **The size may be a default nobody stated.** A creature carries its own size
 * when something pinned one — a monster's stat block, or a character's creation
 * choice — and that beats the map. Failing both, the map answers, where an
 * undeclared size is quietly Medium: so a creature the log has never sized is
 * pushed, and the assumption is reported rather than hidden. A creature
 * somebody *has* said is Huge stands where it is, with no refusal: the rest
 * of the attack happened.
 */
function push(state: GameState, hit: MasteryHit): Result<MasteryOutcome> {
  const scene = state.scene;
  if (scene === null) {
    return ok({
      events: [],
      unverified: [`nobody has said where anybody is standing, so ${hit.target} was not pushed`],
    });
  }

  const unverified: string[] = [];
  // **What somebody said, before what the map assumed.** A stat block pins a
  // size into `creature-added` and the map defaults an unplaced one to Medium,
  // so asking the map first would answer "Medium" for a Gargantuan creature
  // nobody re-stated when they placed it.
  const size = state.creatures[hit.target]?.size ?? sizeOf(scene, hit.target);
  if (size !== null && !sizeAtMost(size, PUSHABLE_UP_TO)) {
    return ok({
      events: [],
      unverified: [
        `${hit.target} is ${size}, and Push moves a creature that is Large or smaller`,
      ],
    });
  }
  if (state.creatures[hit.target]?.size == null) {
    unverified.push(
      `nobody has said how big ${hit.target} is, so Push took them for Medium; a creature larger than Large would not have moved`,
    );
  }

  // Straight away from the attacker, and **anchored on the creature being
  // moved**: a placement measured from the attacker adds a box-to-box distance
  // to an anchor-to-anchor projection, which is the same number only while both
  // of them are Medium. From the target, the projection is the push itself.
  const bearing = bearingBetween(scene, hit.attacker, hit.target);
  if (!bearing.ok) return ok({ events: [], unverified: [...unverified, bearing.reason] });

  const placement = {
    from: { creature: hit.target },
    feet: hit.feet ?? PUSH_FEET,
    bearing: bearing.value,
  } as const;

  // **Asked before it is written.** `creature-moved` is applied by the fold
  // through `must`, so an event the scene would refuse — a shove into a wall —
  // is a log that cannot be folded rather than a refusal. A push that has
  // nowhere to go simply does not happen, and says so.
  const moved = moveCreature(scene, hit.target, placement, { forced: true });
  if (!moved.ok) {
    return ok({
      events: [],
      unverified: [...unverified, `${hit.target} could not be pushed: ${moved.reason}`],
    });
  }

  return ok({
    events: [
      {
        type: 'creature-moved',
        id: hit.target,
        placement,
        // Nobody spent their Speed on this and nobody provoked anything.
        forced: true,
      },
    ],
    unverified,
  });
}

/**
 * SRD Topple: "you can force the creature to make a Constitution saving throw
 * (DC 8 plus the ability modifier used to make the attack roll and your
 * Proficiency Bonus). On a failed save, the creature has the Prone condition."
 */
function topple(state: GameState, supply: Supply, hit: MasteryHit): Result<MasteryOutcome> {
  const attacker = creatureOf(state, hit.attacker);
  const victim = creatureOf(state, hit.target);
  if (attacker === null || victim === null) return ok(NOTHING);

  const attacking = sheetAsItStands(state, hit.attacker) ?? attacker.sheet;
  const dc = 8 + modifierFor(attacking, hit.ability) + proficiencyBonus(attacking);

  const issuedBefore = supply.issuer.count;
  const sheet = sheetAsItStands(state, hit.target) ?? victim.sheet;
  const support = savingSupport(state, hit.target, victim, 'con', supply);
  const save = rollSavingThrow(supply.issuer, supply.rng, sheet, 'con', {
    dc,
    conditions: support.conditions,
    modes: support.modes,
    bonuses: support.bonuses,
  });
  if (!save.ok) return save;

  const events: GameEvent[] = [
    recordD20Test(
      hit.target,
      'Constitution save against Topple',
      save.value,
      save.value.success ? 'stayed up' : 'knocked down',
    ),
    {
      type: 'rolls-issued',
      count: supply.issuer.count - issuedBefore,
      rng: supply.rng.snapshot(),
    },
  ];

  if (save.value.success) return ok({ events, unverified: [] });

  const prone = applyConditionTo(
    events.reduce(applyEvent, state),
    hit.target,
    'prone',
    masterySource('topple'),
  );
  // A creature immune to Prone stays standing, which is not a refusal of the
  // attack that got here — the same reading `conditionLanding` takes.
  if (!prone.ok) return ok({ events, unverified: [prone.reason] });

  return ok({ events: [...events, ...prone.value], unverified: [] });
}
