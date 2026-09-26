/**
 * Acting through a spell on a later turn.
 *
 * The narrow shape a handful of SRD spells write identically — Vampiric Touch
 * and Flame Blade strike again, Spiritual Weapon moves and strikes, Moonbeam's
 * whole action is moving the beam. The level and the route are pinned at the
 * casting; who it is aimed at and what they are standing behind are read
 * afresh.
 *
 * It sits at the top of the stack because it does all three things at once: it
 * resolves a spell's effects, it moves an area, and it settles what the move
 * caused — so it depends on the spell resolution *and* on the turn's own
 * settlement.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { spendAction, spendBonusAction } from '../combat.js';
import { applyEvent, type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, commandOutcome, once } from '../idempotency.js';
import { distanceBetweenPoints, snapToSpace, type Point } from '../positioning.js';
import { actionRulesOn, canSee } from '../standing.js';
import { type SpellActivation } from '../spell-definitions.js';
import { lightPatchesOf, type Supply } from './casting.js';
import { castingIdOf, regionOfArea } from '../spells.js';
import { creatureOf, unknownCreature } from './command.js';
import { unsettledRefusal } from './holds.js';
import { reachFromCaster, reachFromOrigin, relocateOrigin } from './ongoing.js';
import { resolveEffects } from './spell-resolution.js';
import { handedOver, statedChoice, statedDamageType } from '../spell-definitions.js';
import {
  areaCatch,
  areaSourceOf,
  type SpellResolution,
  type SpellTargetOutcome,
} from './targeting.js';
import { settleAreaEffects } from './turns.js';

export interface ActivateSpellCommand extends CommandIdentity {
  /** Which running casting to act through, from {@link ongoingSpellsBy}. */
  readonly castingId: string;
  /** Who it is aimed at this time. "The same creature or a different one." */
  readonly targets: readonly CharacterId[];
  /**
   * Where to move the point this casting holds, for a spell that may.
   *
   * SRD Spiritual Weapon: "you can **move the force up to 20 feet** and repeat
   * the attack against a creature within 5 feet of it." One Bonus Action does
   * both, which is why this is a field on the activation rather than a command
   * of its own — a second command would either charge a second Bonus Action or
   * charge none, and both are wrong.
   *
   * "Up to 20 feet" includes none of them, so it is optional. The engine owns
   * the allowance, the geometry and the identity of what is being moved; the
   * caller owns the destination.
   *
   * **Required** where the activation's whole content is the move — see
   * {@link SpellActivation.movesArea} — because a Magic action spent moving
   * nothing is not a thing SRD Moonbeam offers.
   */
  readonly to?: Point;
  /**
   * The spaces a moving **area** passed through on the way, in order.
   *
   * SRD Moonbeam moves its Cylinder "up to 60 feet" and makes every creature
   * the area arrives on save. Twelve spaces is far enough to pass clean over
   * somebody, and **the engine has no route to read**: two points do not imply
   * the line between them, and drawing one would be the engine inventing a
   * path nobody took — the same refusal `raiseAreaEntries` already makes about
   * a creature's own movement.
   *
   * So the route is the caller's to state, at whatever fidelity the fiction
   * has. Each consecutive pair is one authoritative relocation, written as its
   * own `spell-origin-moved`, and each is asked who the area arrived on. The
   * allowance caps the **sum** of the legs, which is what "up to 60 feet"
   * measures: a beam walked round three sides of a square has travelled all
   * three, however near where it started it ends up.
   *
   * Absent is one leg, which is exact when it is one space long and otherwise
   * says so in `unverified`. Not a path *finder*: nothing here searches,
   * smooths, interpolates or validates that consecutive waypoints are
   * adjacent — a waypoint is an authoritative fact the caller supplies, and a
   * caller who supplies none gets the honest gap instead.
   */
  readonly via?: readonly Point[];
  /**
   * The branch to run in place of the one running — SRD Alter Self's "replace
   * the option you chose with a different one".
   *
   * **Required** where the activation re-chooses and **refused** where it does
   * not, the symmetry every stated fact keeps; refused too for the word already
   * running (`same_option`) and for one the spell does not print.
   */
  readonly option?: string;
  /**
   * How far to move a creature this casting is holding off the ground, signed:
   * positive is up and negative is down.
   *
   * SRD *Levitate*: "You can change the target's altitude by **up to 20 feet
   * in either direction** on your turn." The cap is the definition's and the
   * distance is the caster's, which is why this is a field rather than a
   * number anything derives — and it is a distance rather than a die, so it is
   * a decision a caller may state.
   *
   * **Required** where the activation's effects change an altitude, and
   * **refused** where they do not: the symmetry every stated fact on a casting
   * already keeps, asked here because this is the one later action that takes
   * a request of its own.
   */
  readonly altitude?: number;
  /**
   * Which way to re-aim a Line, Cone or Cube the casting blows from its caster.
   *
   * SRD *Gust of Wind*: "As a Bonus Action on your later turns, you can change
   * the direction in which the Line blasts from you." A point to aim at rather
   * than an angle, exactly as `CastSpellRequest.towards` is and for its reason:
   * a model speaks in landmarks and creatures, and an angle would be raw
   * geometry typed by the caller.
   *
   * **Required** where {@link SpellActivation.redirects} says the action is
   * the re-aiming, and **refused** where it is not — a Bonus Action spent
   * turning nothing is not a thing the book offers.
   */
  readonly towards?: Point;
  /**
   * Where the template this action draws is centred.
   *
   * SRD Call Lightning: "you can take a Magic action to call down lightning in
   * that way again, **targeting the same point or a different one**." The same
   * word a casting places its area with, and the same discipline: **required**
   * where the action draws a point-origin template and **refused** where it
   * draws none — a Magic action spent aiming nothing is not a thing the book
   * offers.
   *
   * **Not {@link to}, which moves a point the casting keeps.** The cloud stays
   * where it rose; what moves is where the bolt falls, and the two are
   * different facts about the same casting — see
   * {@link SpellActivation.redrawsArea}.
   *
   * Checked against the kept origin's own reach rather than against the
   * caster's range, because that is what the book measures: "a point you can
   * see **under the cloud**".
   */
  readonly at?: Point;
}

/**
 * Use a spell that is still running, on a later turn.
 *
 * SRD Vampiric Touch: "Until the spell ends, you can make the attack again on
 * each of your turns as a Magic action, targeting the same creature or a
 * different one." Flame Blade writes the same sentence about a blade in your
 * hand. Both are the same shape and it is a narrow one: **the caster spends an
 * action and the spell does again what it already does.**
 *
 * What is pinned and what is fresh is the whole of the design:
 *
 * | Pinned at the casting | Read again now |
 * |---|---|
 * | the level it was cast at, so the dice do not grow | who it is aimed at |
 * | the route, so the attack modifier is the one it was cast with | the range to them |
 * | the caster — nobody else may act through it | their Armour Class, conditions, defences |
 *
 * **It is not generic scripting.** There is no trigger, no predicate and no
 * ordering: a definition names an action, a range and the effects the spell
 * already knows how to resolve, and this spends the one and runs the others.
 * The spells that need more — a force with its own position, moved twenty feet
 * before it strikes — are blocked on geometry, and are listed as such rather
 * than half-served here.
 */
/**
 * How far a later action may move a creature this casting is holding, or null
 * where it moves nobody.
 *
 * One reader for one question, asked twice and needing one answer: the
 * command's *is a distance required, and is it inside the cap*, and the
 * resolver's *move them*. Two spellings of it would be two places for one
 * printed number to be got wrong.
 *
 * An activation's own effect list and nowhere else — `checkSpellDefinition`
 * refuses the kind in a casting's list and in an area trigger's, because
 * neither has a request to read the feet off.
 */
function altitudeCapOf(activation: SpellActivation): number | null {
  for (const effect of activation.effects) {
    if (effect.kind === 'change-altitude') return effect.upTo;
  }
  return null;
}

/**
 * The creature this casting's mark is on, read off the rider it granted.
 *
 * SRD Hunter's Mark and SRD Hex both hang the extra die on the **caster** and
 * name the creature it is about — `GrantedAttackRider.target` — so "the
 * target" of a mark is a fact the world already holds and nothing has to be
 * carried on the record for it. `OngoingSpell.aimed` cannot answer: it stores
 * what the *cast* declared and the world cannot say, and a creature the
 * casting hung something on is deliberately not in it.
 *
 * Null where this casting marks nobody — a rider released on the caster, or a
 * definition that grants none — which is the refusal {@link activateSpell}
 * turns into `nothing_marked` rather than a target it invented.
 */
function markedBy(
  state: GameState,
  casterId: CharacterId,
  castingId: string,
): CharacterId | null {
  const rider = state.creatures[casterId]?.attackRiders.find(
    (held) => castingIdOf(held.source) === castingId && held.target !== undefined,
  );
  return rider?.target ?? null;
}

export function activateSpell(
  state: GameState,
  casterId: CharacterId,
  command: ActivateSpellCommand,
  supply: Supply,
): Result<SpellResolution> {
  // Before the casting is even looked up. A retry arrives after the first run
  // has already spent the action, and reporting "no such casting" for a
  // casting that has since ended would be the confusion command ids exist to
  // prevent.
  return once(state, `activate:${casterId}`, command, () => {
    const already =
      command.commandId === undefined ? null : commandOutcome(state, command.commandId);
    return {
      events: [],
      castingId: already?.castingId ?? command.castingId,
      outcomes: [],
      unverified: [],
    };
  }, (stamp) => {
    // The same debts that stop a casting, read by the same function — an
    // activation is a Magic action taken into the world exactly as a casting
    // is, and a guard the casting path keeps that this one lacked let Vampiric
    // Touch strike while a damage roll against somebody was still held open.
    const unsettled = unsettledRefusal(state, casterId);
    if (unsettled !== null) return unsettled;

    // **No refusal for "a casting is open", and there never was a rule behind
    // one.** This refused every creature's activation for the whole of another
    // creature's ten-minute rite — a limit of the single pending slot wearing
    // a rule's clothes. SRD lets the cleric act while the wizard performs a
    // Ritual, and what stops an activation is what stops any Magic action: the
    // action economy, and the debts `unsettledRefusal` above already carries.

    const record = state.ongoing[command.castingId];
    if (record === undefined) {
      return err(
        'not_ongoing',
        `${command.castingId} is not a spell that is still running`,
      );
    }

    const definition = supply.content.spell(record.spellId);
    if (definition?.activation === undefined) {
      return err(
        'no_activation',
        `${record.spell} is not a spell its caster can use again on a later turn`,
      );
    }
    const activation = definition.activation;

    // SRD: "**you** can make the attack again." A spell is not a thing lying
    // about for anyone to pick up, and this is the refusal that says so.
    //
    // **One spell in the book hands the action to somebody else**, and it hands
    // it to exactly one creature: SRD Dragon's Breath's "**the target** can
    // take a Magic action to exhale a 15-foot Cone". So the same refusal asks
    // the other question for that definition — is this the creature the casting
    // is on — off `aimed`, which is what the cast declared and the world cannot
    // say. A caster who touched themselves is on that list and may exhale; one
    // who touched somebody else is not, and may not.
    if (activation.by === 'target') {
      if (!record.aimed.includes(casterId)) {
        return err(
          'not_your_spell',
          `${record.spell} is exhaled by the creature it is on — ${record.aimed.join(', ') || 'nobody'} — and ${casterId} is not ${record.aimed.length === 1 ? 'them' : 'among them'}`,
        );
      }
    } else if (record.caster !== casterId) {
      return err(
        'not_your_spell',
        `${command.castingId} is ${record.caster}'s casting; ${casterId} cannot act through it`,
      );
    }

    const caster = creatureOf(state, casterId);
    if (caster === null) return unknownCreature(casterId);

    // **The numbers the casting was made with**, off the record. Re-deriving
    // them from the caster's sheet is how a minute-old Vampiric Touch quietly
    // gets a better attack modifier because the wizard levelled between the
    // casting and the punch.

    // **An activation that only moves the area aims at nobody.** Not
    // `targets.optional`, which is Spiritual Weapon's "you **can** make one
    // melee spell attack" — a target that may be declined. Moonbeam's later
    // Magic action has no attack to decline, so a named target is a caller
    // asking the beam to do something it does not do.
    // **A template this action draws catches whoever it covers**, so a named
    // target is a caller asking a Cone to be aimed at somebody: the geometry
    // decides, exactly as it decides a casting's own area — see
    // {@link SpellActivation.area}.
    const drawn =
      activation.area ?? (activation.redrawsArea === undefined ? undefined : definition.area);
    if (
      activation.movesArea !== undefined ||
      activation.redirects === true ||
      activation.reoptions === true ||
      drawn !== undefined
    ) {
      if (command.targets.length > 0) {
        return err(
          'wrong_target_count',
          `${record.spell}'s later action ${activation.reoptions === true ? 'changes its own form' : drawn === undefined ? 'moves the area' : `fills a ${drawn.kind} and catches whoever is in it`}, got ${command.targets.length} target(s)`,
        );
      }
    } else {
      const optional = definition.targets.optional === true;
      if (command.targets.length > 1 || (command.targets.length === 0 && !optional)) {
        return err(
          'wrong_target_count',
          `${record.spell} strikes one creature at a time, got ${command.targets.length}`,
        );
      }
    }
    const target = command.targets[0] ?? null;
    if (target !== null && creatureOf(state, target) === null) return unknownCreature(target);

    const unverified: string[] = [];

    // — the word a re-choosing action speaks ————————————————————————————————
    //
    // SRD Alter Self: "replace the option you chose with a different one".
    // Before the action is charged, as every stated fact is: a word refused
    // must cost its caster nothing.
    if (activation.reoptions !== true) {
      if (command.option !== undefined) {
        return err(
          'no_option_clause',
          `${record.spell}'s later action changes no form; which branch is not a fact it asks for`,
        );
      }
    } else {
      const branches = definition.options ?? {};
      const names = Object.keys(branches).sort();
      if (command.option === undefined) {
        return err(
          'option_required',
          `${record.spell} prints ${names.map((key) => branches[key]!.label).join(', ')} and the engine will not choose between them; name which`,
        );
      }
      if (!names.includes(command.option)) {
        return err('unknown_option', `${record.spell} prints ${names.join(', ')}, not ${command.option}`);
      }
      if (command.option === record.option) {
        return err(
          'same_option',
          `${record.spell} is already ${branches[command.option]!.label}; the Magic action replaces the option with a different one`,
        );
      }
    }

    // — the two facts a later action states, and the symmetry both keep ————
    //
    // Before the action is charged and before the first die, which is where
    // every stated fact of a casting is asked too: a Magic action refused for
    // a number past its cap must cost its caster nothing.
    const climbs = altitudeCapOf(activation);
    if (climbs === null) {
      if (command.altitude !== undefined) {
        return err(
          'no_altitude_clause',
          `${record.spell}'s later action moves nobody up or down; how far is not a fact it asks for`,
        );
      }
    } else {
      if (command.altitude === undefined) {
        return err(
          'altitude_required',
          `${record.spell} moves the creature it is holding up to ${climbs} feet in either direction, and nobody said how far`,
        );
      }
      // "in either direction" is the sign, "up to 20 feet" is the cap, and the
      // lattice is 5-foot cubes — so nought is an action spent on nothing and
      // seven is a height no position can hold.
      if (
        !Number.isInteger(command.altitude) ||
        command.altitude === 0 ||
        command.altitude % 5 !== 0
      ) {
        return err(
          'bad_altitude',
          `an altitude changes by a whole number of 5-foot spaces, up or down, not ${String(command.altitude)}`,
        );
      }
      if (Math.abs(command.altitude) > climbs) {
        return err(
          'altitude_beyond_the_cap',
          `${record.spell} changes an altitude by up to ${climbs} feet, and ${Math.abs(command.altitude)} is more`,
        );
      }
    }

    // A direction belongs to a re-aiming or to a directional template drawn
    // now, and to nothing else. The *missing* half of each is the geometry's
    // own refusal (`no_direction`, out of `placeArea`), asked below before
    // anything is spent; this is the other half.
    if (activation.redirects !== true && drawn === undefined) {
      if (command.towards !== undefined) {
        return err(
          'not_directional',
          `${record.spell}'s later action re-aims nothing; which way is not a fact it asks for`,
        );
      }
    } else if (activation.redirects === true && command.towards === undefined) {
      return err(
        'direction_required',
        `${record.spell}'s later action changes the direction it blasts in; name which way`,
      );
    }

    // — the point a re-drawn template is centred on ——————————————————————————
    //
    // SRD Call Lightning's "the same point or a different one", asked before
    // the action is charged like every other stated fact here. Where the point
    // may be is the kept origin's business and is checked below, against the
    // same reach a target would be measured by.
    if (drawn === undefined || drawn.origin !== 'point') {
      if (command.at !== undefined) {
        return err(
          'no_point_clause',
          `${record.spell}'s later action centres nothing on a point; where is not a fact it asks for`,
        );
      }
    } else if (command.at === undefined) {
      return err(
        'point_required',
        `${record.spell}'s later action falls on a point of its caster's choosing, and nobody said where`,
      );
    } else {
      // "a point you can see **under the cloud**": measured from the point the
      // casting keeps — where the template was laid — and refused beyond the
      // printed allowance before the action is charged.
      const allowance = activation.redrawsArea;
      if (allowance !== undefined && record.origin !== undefined) {
        const away = distanceBetweenPoints(record.origin, snapToSpace(command.at));
        if (away > allowance) {
          return err(
            'outside_the_kept_point',
            `${record.spell} reaches ${allowance} feet from the point it holds, and the point named is ${away} away`,
          );
        }
      }
    }

    // — the mark, and the printed condition on moving it ————————————————
    //
    // SRD Hunter's Mark: "**If the target drops to 0 Hit Points** before this
    // spell ends, you can take a Bonus Action to move the mark to a new
    // creature you can see within range." SRD Hex writes the same condition
    // and curses a new creature with it. The condition is the whole of what
    // makes the action legal, and it is read off the creature the casting
    // marks rather than off anything the caller says.
    //
    // Before the action is charged, like every other stated fact here: a Bonus
    // Action refused for a quarry still on its feet must cost its caster
    // nothing.
    let marked: CharacterId | null = null;
    if (activation.reAims === true) {
      marked = markedBy(state, casterId, record.castingId);
      if (marked === null) {
        return err(
          'nothing_marked',
          `${record.spell} is running and marks nobody, so there is no mark to move`,
        );
      }
      // "a **new** creature": the action is for moving the mark, and moving it
      // where it already is spends a Bonus Action on nothing.
      if (target === marked) {
        return err(
          'already_marked',
          `${record.spell} already marks ${marked}; the Bonus Action moves it to a new creature`,
        );
      }
      const quarry = creatureOf(state, marked);
      if (quarry !== null && !quarry.vitals.dead && quarry.vitals.hp > 0) {
        return err(
          'quarry_still_standing',
          `${marked} is on ${quarry.vitals.hp} Hit Points, and ${record.spell} moves only when its target drops to 0`,
        );
      }
      // "a new creature **you can see**", asked of the caster's senses exactly
      // as the casting asked them — a declaration first, then what reaches.
      // Three-valued like every sight question: silence is reported and the
      // action goes ahead, and only a declared *no* refuses.
      if (definition.requiresSight === true && target !== null) {
        const seen = canSee(state, casterId, target);
        if (seen === null) {
          unverified.push(
            `nobody has said whether ${casterId} can see ${target}, so ${record.spell} moved to a creature it may not be able to see`,
          );
        } else if (!seen) {
          return err('cannot_see_target', `${casterId} cannot see ${target}`);
        }
      }
    }

    // — the point moves first, and the attack is measured from where it ends —
    //
    // SRD orders it that way — "move the force up to 20 feet **and** repeat the
    // attack against a creature within 5 feet of it" — so a move that brings the
    // force into reach is the whole point of the action. Validated before
    // anything is spent, like everything else.
    const moved = relocateOrigin(state, record, definition, command);
    if (!moved.ok) return moved;
    const legs = moved.value;
    const origin = legs[legs.length - 1] ?? record.origin ?? null;

    // Checked afresh: the creature that was in reach a minute ago may not be.
    if (target !== null) {
      const checked =
        origin === null
          ? reachFromCaster(state, casterId, target, record, activation, unverified)
          : reachFromOrigin(state, target, origin, record, definition, unverified);
      if (checked !== null) return checked;
    }

    // — the template this action draws, and who it covers ————————————————————
    //
    // SRD Dragon's Breath's Cone and SRD Call Lightning's bolt, caught through
    // `areaCatch` — the one ruler a casting's own area is caught through, so
    // Total Cover, the dead, a creature type the spell cannot touch and a ward
    // standing between are all taken out here rather than in a second filter.
    //
    // **From where the actor is standing.** A `self`-origin template starts at
    // whoever took the action, which is the whole of what Dragon's Breath
    // needed: the Cone comes out of the creature that inhaled. A point-origin
    // one is centred where `at` says, and the origin creature of a Cone, Cube,
    // Line or Emanation is left out of it by the geometry, as SRD leaves a
    // caster out of their own.
    //
    // Before the action is charged, because a refusal must cost nothing — and
    // `no_direction` for a Cone nobody aimed comes back out of here.
    let covered: readonly CharacterId[] | null = null;
    if (drawn !== undefined) {
      const caught = areaCatch(
        state,
        casterId,
        { ...areaSourceOf(definition), castLevel: record.level },
        drawn,
        {
          targets: [],
          ...(command.at === undefined ? {} : { at: command.at }),
          ...(command.towards === undefined ? {} : { towards: command.towards }),
        },
        null,
        unverified,
      );
      if (!caught.ok) return caught;
      covered = caught.value;
    }

    // Nothing is rolled until the action is known to be affordable — the same
    // validate-before-rolling rule casting itself obeys. Outside combat there is
    // no economy to spend.
    const events: GameEvent[] = [];
    let current = state;
    const happened = (event: GameEvent): void => {
      events.push(event);
      current = applyEvent(current, event);
    };

    const combat = state.combat;
    if (combat !== null && combat.budgets[casterId] !== undefined) {
      // SRD calls a later action through a running spell a Magic action —
      // Spiritual Weapon's swing, Moonbeam's move — so it is named as one and
      // a spell forbidding the Magic action stops it.
      const spend = { rules: actionRulesOn(state, casterId), as: 'magic' as const };
      const spent =
        activation.action === 'bonus-action'
          ? spendBonusAction(combat, casterId, caster.conditions, spend)
          : spendAction(combat, casterId, caster.conditions, spend);
      if (!spent.ok) return spent;
      happened(
        activation.action === 'bonus-action'
          ? { type: 'bonus-action-spent', id: casterId }
          : { type: 'action-spent', id: casterId },
      );
    }

    // **Before its own content, not after it.** The stamp rides here because
    // this event always happens: the attack it runs may miss, and a missed
    // activation must not be retryable. What moved it *above* the movement is
    // that a beam can end its own casting halfway along — the caster walks it
    // onto themselves, fails the save, and loses Concentration — and the history
    // still has to say the caster took Moonbeam's later Magic action. An event
    // recording that, written after the casting it names has gone, would be the
    // log arriving in the wrong order.
    happened({
      type: 'spell-activated',
      castingId: record.castingId,
      by: casterId,
      // **The one creature a later action leaves behind**, for the one spell
      // that prints a check the creature it probed may attempt: SRD Detect
      // Thoughts' Magic action turns a Range: Self casting on a mind, and the
      // cast aimed at nobody. Pinned only where the definition's check asks for
      // it — see `SpellCheck.attemptBy` — so every other activation writes the
      // event it always wrote.
      ...(definition.check?.attemptBy === 'singled-out' && target !== null
        ? { singledOut: target }
        : {}),
      ...(stamp === null ? {} : { command: stamp }),
    });

    // **The re-choice, whole, and nothing below it.** SRD Alter Self's Magic
    // action takes the old form away and puts the new one on: the event
    // releases every grant this casting hung on its caster and re-pins the
    // word, and the new branch's effects run off the record's own numbers on
    // the caster — with the substitutions the first branch had, so a stated
    // growth type reaches a second pair of claws.
    if (activation.reoptions === true && command.option !== undefined) {
      happened({ type: 'spell-option-changed', castingId: record.castingId, option: command.option });
      const branch = definition.options?.[command.option];
      // `state` and not `current`, for the reason the run below passes it: the
      // resolver replays the accumulator onto the state it is handed.
      const resolvedForm = resolveEffects(state, casterId, creatureOf(current, casterId), definition, {
        castLevel: record.level,
        route: null,
        numbers: record.numbers,
        targets: [casterId],
        unverified,
        supply,
        castingId: record.castingId,
        events,
        effects: statedChoice(
          statedDamageType(branch?.effects ?? [], record.damageType),
          record.choice?.of,
          record.choice?.value,
        ),
        label: activation.label,
      });
      if (!resolvedForm.ok) return resolvedForm;
      // And the branch's own sentences go out with the swap, as they did with
      // the casting.
      unverified.push(
        ...(branch?.unmodelled ?? []).map((gap) => `${record.spell}: ${gap}`),
        ...(branch?.handsOver ?? []).map((printed) => handedOver(record.spell, printed)),
      );
      return ok({ ...resolvedForm.value, unverified });
    }

    // **The curse leaves the creature it was on.** SRD prints the Bonus Action
    // as a *move* — "move the mark to a new creature", "curse a new creature" —
    // and a mark on two creatures is not a thing either sentence offers. So the
    // casting ends on the old one through the door every other release uses,
    // which takes the grants it hung there with it; what the caster holds is
    // replaced rather than released, because a second grant from one source
    // does not stack.
    //
    // Written after `spell-activated` and before the effects, which is the
    // order it happened in: the action was taken, the old curse lifted, and
    // the new one laid.
    if (marked !== null) {
      happened({
        type: 'spell-ended',
        castingId: record.castingId,
        on: marked,
        reason: 're-aimed',
      });
    }

    // **The direction, which is the whole of what the Bonus Action does.**
    // SRD Gust of Wind prints no save on the turning: the opening one is asked
    // at the casting and the only one that recurs is "A creature that ends its
    // turn in the Line must make the same save". So the record's bearing
    // changes here and the spell's own `areaTrigger` catches whoever the new
    // Line is over, at the moment that sentence names — which is why nothing
    // is rolled, settled or moved by this line.
    if (activation.redirects === true && command.towards !== undefined) {
      happened({
        type: 'spell-aim-changed',
        castingId: record.castingId,
        towards: command.towards,
      });
    }

    // — the route, one leg at a time —————————————————————————————————————————
    //
    // SRD Moonbeam: a creature makes the save "when the spell's area moves into
    // its space" — **at that point in the route**, not once the whole sweep is
    // over. The difference is observable and it is not a subtlety: a beam walked
    // onto its own concentrating caster can break that Concentration, and a
    // spell that has ended does not go on to its next waypoint.
    //
    // So each leg is moved, settled, and only then followed by the next. The
    // settlement is `settleAreaEffects` — the same command a turn boundary and a
    // creature's own move already use, reached with the generator this action
    // already holds, so no second resolver exists and no caller supplies a save,
    // a DC, a damage roll or a Concentration decision.
    const outcomes: SpellTargetOutcome[] = [];
    let reached = record.origin ?? null;
    for (const space of legs) {
      // The casting ended on the leg before this one. Not an error and not a
      // rollback: the action was spent, the beam moved, and what it did to the
      // caster is why there is nothing left to move.
      if (current.ongoing[record.castingId] === undefined) break;

      happened({ type: 'spell-origin-moved', castingId: record.castingId, to: space });
      reached = space;

      // A patch the casting sheds follows its origin — SRD Dancing Lights'
      // motes move, and the light they shed is laid again at the new point
      // under the same names, which the fold overwrites. Sourced to the
      // casting as before, so it is still gone when the casting is.
      if (definition.areaLight !== undefined && definition.area !== undefined) {
        const moved = regionOfArea(definition.area, casterId, space, undefined, 'space');
        for (const patch of lightPatchesOf(current, definition, record.castingId, moved, true, record.level)) {
          happened(patch);
        }
      }

      // Everything this leg raised, in the deterministic order settlement
      // already imposes. No command id: this is not a caller's settlement and
      // must not consume one — the activation's own stamp is the retry guard for
      // the whole action, movement and consequences together.
      const settled = settleAreaEffects(current, supply);
      if (!settled.ok) return settled;
      for (const event of settled.value.events) happened(event);
      outcomes.push(...settled.value.outcomes);
      unverified.push(...settled.value.unverified);

      // SRD Flaming Sphere: "If you move the sphere into a creature's space,
      // that creature makes the save against the sphere, **and the sphere
      // stops moving for the turn**."
      //
      // The half of the sentence that is about the route rather than about the
      // save, and it belongs here because here is the only place the route
      // exists: the rest of the legs are simply not travelled, and the point
      // stays where it hit somebody. Read off the debt the fold raised for
      // *this* leg rather than off the geometry again, so what stops the
      // sphere is exactly what the rules said it caught.
      if (
        definition.areaTrigger?.onPointEntry === true &&
        settled.value.settled.some(
          (owed) => owed.castingId === record.castingId && owed.moment === 'area-moved',
        )
      ) {
        unverified.push(
          `${record.spell} was rolled into an occupied space and stopped there; the rest of the route was not travelled`,
        );
        break;
      }
    }

    // The activation's own effects, from where the area actually ended up. The
    // caster is re-read: a route that ended its own casting may have ended the
    // caster too, and `resolveEffects` is explicit about a caster who has gone.
    // **The actor, and the numbers are still the caster's.** SRD Dragon's
    // Breath's Cone comes out of the creature that inhaled, so the blow names
    // *them* as its dealer — which is the fact SRD Hellish Rebuke reads, "damage
    // from a creature that you can see", and a goblin scorched by a fighter's
    // breath rebukes the fighter. Nothing about the spell moves with the actor:
    // the level, the route and the save DC are `record.numbers`, pinned at the
    // cast and passed below, so a fighter who breathes fire does not roll it off
    // their own sheet.
    const resolved = resolveEffects(state, casterId, creatureOf(current, casterId), definition, {
      // The level the casting was made at. A wizard who gained a level since
      // does not upcast a spell already in the air.
      castLevel: record.level,
      route: null,
      numbers: record.numbers,
      targets: covered ?? (target === null ? [] : [target]),
      unverified,
      supply,
      castingId: record.castingId,
      events,
      // **A re-aiming action runs the casting's own effects**, because the
      // book prints no second sentence for the later turn: Hunter's Mark moves
      // *the mark* and Hex curses a new creature with *the curse*. Read
      // through the same two substitutions the cast ran them through, off the
      // record rather than out of a fresh request — the caster named the
      // ability once, when they cast it.
      // **And a re-drawing action runs them too**, for the same reason written
      // about the same list: SRD Call Lightning calls down lightning "in that
      // way again", and the way is the one sentence the spell printed once.
      //
      // **The substitutions travel with every list, not only those two.** SRD
      // Dragon's Breath's Cone deals "damage of the chosen type", and the type
      // was chosen at the cast and pinned on the record — so the activation's
      // own list is read through the same two readers. Both are the identity
      // for a casting that stated nothing, which is every activation written
      // before this line.
      effects: statedChoice(
        statedDamageType(
          activation.reAims === true || activation.redrawsArea !== undefined
            ? definition.effects
            : activation.effects,
          record.damageType,
        ),
        record.choice?.of,
        record.choice?.value,
      ),
      label: activation.label,
      // The object the casting was pointed at, off the record rather than out
      // of a fresh request: SRD Heat Metal deals "**this** damage again" to the
      // thing it was cast on, and an activation that asked again could heat
      // one object on this turn and another on the next.
      ...(record.object === undefined ? {} : { object: record.object }),
      // **The weather the cloud rose in**, off the record rather than out of a
      // fresh request: SRD Call Lightning's storm was a fact about the world at
      // the cast, and a bolt called down nine minutes later falls in the storm
      // the spell took hold of.
      ...(record.inAStorm === undefined ? {} : { inAStorm: record.inAStorm }),
      // The one fact a later action states rather than reads off the record:
      // how far, and which way — see {@link ActivateSpellCommand.altitude}.
      ...(command.altitude === undefined ? {} : { altitude: command.altitude }),
      ...(reached === null ? {} : { from: reached }),
    });
    if (!resolved.ok) return resolved;

    // What the route did on the way is part of what the action did. Ordered
    // before the activation's own effects because it happened before them.
    return ok({
      ...resolved.value,
      outcomes: [...outcomes, ...resolved.value.outcomes],
    });
  });
}

