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
import { type Point } from '../positioning.js';
import { actionRulesOn } from '../standing.js';
import { lightPatchesOf, type Supply } from './casting.js';
import { regionOfArea } from '../spells.js';
import { creatureOf, unknownCreature } from './command.js';
import { unsettledRefusal } from './holds.js';
import { reachFromCaster, reachFromOrigin, relocateOrigin } from './ongoing.js';
import { resolveEffects } from './spell-resolution.js';
import { type SpellResolution, type SpellTargetOutcome } from './targeting.js';
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

    // SRD: "**you** can make the attack again." A spell is not a thing lying
    // about for anyone to pick up, and this is the refusal that says so.
    if (record.caster !== casterId) {
      return err(
        'not_your_spell',
        `${command.castingId} is ${record.caster}'s casting; ${casterId} cannot act through it`,
      );
    }

    const caster = creatureOf(state, casterId);
    if (caster === null) return unknownCreature(casterId);

    const definition = supply.content.spell(record.spellId);
    if (definition?.activation === undefined) {
      return err(
        'no_activation',
        `${record.spell} is not a spell its caster can use again on a later turn`,
      );
    }
    const activation = definition.activation;

    // **The numbers the casting was made with**, off the record. Re-deriving
    // them from the caster's sheet is how a minute-old Vampiric Touch quietly
    // gets a better attack modifier because the wizard levelled between the
    // casting and the punch.

    // **An activation that only moves the area aims at nobody.** Not
    // `targets.optional`, which is Spiritual Weapon's "you **can** make one
    // melee spell attack" — a target that may be declined. Moonbeam's later
    // Magic action has no attack to decline, so a named target is a caller
    // asking the beam to do something it does not do.
    if (activation.movesArea !== undefined) {
      if (command.targets.length > 0) {
        return err(
          'wrong_target_count',
          `${record.spell}'s later action moves the area and strikes nobody, got ${command.targets.length} target(s)`,
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
      ...(stamp === null ? {} : { command: stamp }),
    });

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
    }

    // The activation's own effects, from where the area actually ended up. The
    // caster is re-read: a route that ended its own casting may have ended the
    // caster too, and `resolveEffects` is explicit about a caster who has gone.
    const resolved = resolveEffects(state, casterId, creatureOf(current, casterId), definition, {
      // The level the casting was made at. A wizard who gained a level since
      // does not upcast a spell already in the air.
      castLevel: record.level,
      route: null,
      numbers: record.numbers,
      targets: target === null ? [] : [target],
      unverified,
      supply,
      castingId: record.castingId,
      events,
      effects: activation.effects,
      label: activation.label,
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

