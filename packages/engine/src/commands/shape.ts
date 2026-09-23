/**
 * A creature becoming another creature — SRD Wild Shape's verb.
 *
 * > "As a Bonus Action, you shape-shift into a Beast form that you have
 * > learned for this feature. You stay in that form for a number of hours
 * > equal to half your Druid level or until you use Wild Shape again, have the
 * > Incapacitated condition, or die. You can also leave the form early as a
 * > Bonus Action."
 *
 * Two commands and no number the caller produced. `assumeShape` takes the
 * feature and the form's stat-block id, and everything else is read: the pool
 * and the action off the sheet's own `ShapeShift`, the block out of content,
 * the merged sheet from `assumeStatBlock`, the hours and the Temporary Hit
 * Points off the numbers creation resolved at the class level. `revertShape`
 * is the Bonus Action that leaves early. Neither *ends* a form itself: every
 * ending is the `feature` leaving `activeFeatures` — a deadline, a lost
 * condition, a `feature-ended` — and `settleShapes` in the fold puts the sheet
 * back, so the four endings the SRD prints are one mechanism.
 *
 * **What is pinned is the whole merged sheet**, exactly as `addCreature` pins
 * a stat block: the fold opens no catalogue, and a log replayed against next
 * year's bestiary wears the Wolf it wore.
 */

import { type CharacterId, err, ok, type Result } from '@ie/shared';
import { isIncapacitated } from '../conditions.js';
import type { Content } from '../content.js';
import { type GameEvent, type GameState } from '../events.js';
import { type CommandIdentity, once } from '../idempotency.js';
import { adaptMonster, assumeStatBlock, formIneligibility } from '../monster.js';
import { remaining } from '../resources.js';
import { HOUR } from '../time.js';
import { creatureOf, spendFor, unknownCreature } from './command.js';
import { schedule } from './conditions.js';
import { mayAct } from './holds.js';

export interface AssumeShapeCommand extends CommandIdentity {
  /** The feature that takes the form — SRD's `druid:wild-shape`. */
  readonly feature: string;
  /** The stat block's id, one of the forms the character has learned. */
  readonly form: string;
}

/**
 * Take a form, paying everything it costs.
 *
 * Validated whole before anything is spent, in the order a table would ask:
 * is there such a feature, is the character able, is the form one the book
 * prints and this character knows and this level allows, is there a use left.
 * Then the action, the use, and the swap — with a running form ended first,
 * because SRD Wild Shape lasts "until you use Wild Shape again" and the new
 * form is laid over the character's own sheet, never over the old form's.
 */
export function assumeShape(
  state: GameState,
  id: CharacterId,
  command: AssumeShapeCommand,
  content: Content,
): Result<GameEvent[]> {
  return once(state, `assume-shape:${id}`, command, () => [], (stamp) => {
    // A mandatory effect this creature has been caught by, or a turn whose start
    // has not arrived. After the duplicate check, never before it.
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const definition = (creature.sheet.shapeShifts ?? []).find(
      (shape) => shape.feature === command.feature,
    );
    if (definition === undefined) {
      return err('no_such_feature', `${id} has no feature called ${command.feature} that takes a form`);
    }

    // SRD: the form ends on the Incapacitated condition, so it cannot begin
    // under one either — the same clause read from the same list.
    if (isIncapacitated(creature.conditions)) {
      return err('incapacitated', `${id} is Incapacitated and cannot take a form`);
    }

    const block = content.monsterById(command.form);
    if (block === null) return err('unknown_monster', `no stat block with the id ${command.form}`);
    if (!definition.knownForms.includes(command.form)) {
      const learned =
        definition.knownForms.length === 0 ? 'no forms yet' : definition.knownForms.join(', ');
      return err(
        'form_not_known',
        `${id} has not learned the ${block.name} form; ${definition.name} knows ${learned}`,
      );
    }
    // Asked again at the door, although creation asked it of every known form:
    // a sheet whose list has gone stale against its book is refused here
    // rather than worn.
    const why = formIneligibility(block, definition.formType, definition);
    if (why !== null) return err('form_not_eligible', `${block.name} is ${why}`);

    if (remaining(creature.resources, definition.pool) < 1) {
      return err('exhausted', `${id} has no uses of ${definition.name} left`);
    }

    const events: GameEvent[] = [];

    // The action economy only exists in combat; outside it there is nothing to
    // spend, exactly as `activateFeature` finds.
    if (state.combat !== null && definition.action !== 'none') {
      const spent = spendFor(state, id, definition.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }
    events.push({ type: 'resource-spent', id, key: definition.pool, amount: 1 });

    // SRD: "or until you use Wild Shape again". The running form ends, the
    // fold puts the character's own sheet back, and the new form is laid over
    // *that* — which is why the original is read here rather than the sheet
    // as it stands.
    const own = creature.shape === null ? creature.sheet : creature.shape.original.sheet;
    if (creature.shape !== null && creature.activeFeatures.includes(creature.shape.feature)) {
      events.push({
        type: 'feature-ended',
        id,
        feature: creature.shape.feature,
        reason: 'dismissed',
      });
    }

    const form = adaptMonster(block, id);
    events.push({ type: 'feature-activated', id, feature: definition.feature });
    events.push({
      type: 'shape-assumed',
      id,
      feature: definition.feature,
      form: block.id,
      sheet: assumeStatBlock(own, form, definition.keeps),
      size: form.size,
      ...(stamp === null ? {} : { command: stamp }),
    });

    // SRD: "you gain a number of Temporary Hit Points equal to your Druid
    // level" — with no lifetime of their own, so none is filed: the ruling of
    // 2026-09-18 has them last until spent or the Long Rest.
    if (definition.temporaryHitPoints > 0) {
      events.push({ type: 'temporary-hp-granted', id, amount: definition.temporaryHitPoints });
    }

    // Hours, in and out of a fight alike: the clock is the same clock, and a
    // form does not end at a turn boundary. The `feature` target is what the
    // expiry pass drops from `activeFeatures`, and `settleShapes` does the rest.
    const timer = schedule(
      state,
      { kind: 'feature', on: id, feature: definition.feature },
      { kind: 'seconds', seconds: definition.hours * HOUR },
    );
    if (!timer.ok) return timer;
    events.push(timer.value);

    return ok(events);
  });
}

/**
 * Leave a form early, as the SRD prices it: a Bonus Action in a fight and
 * nothing outside one. The use that took the form stays spent.
 *
 * Emits the same `feature-ended` a deadline would have, so the fold's one
 * route back to the character's own sheet is the route taken.
 */
export function revertShape(
  state: GameState,
  id: CharacterId,
  command: CommandIdentity,
): Result<GameEvent[]> {
  return once(state, `revert-shape:${id}`, command, () => [], (stamp) => {
    const owedHere = mayAct(state, id);
    if (owedHere !== null) return owedHere;

    const creature = creatureOf(state, id);
    if (creature === null) return unknownCreature(id);

    const shape = creature.shape;
    if (shape === null) return err('not_shaped', `${id} is in no form to leave`);

    // The form's own feature record, for the price of leaving — read off the
    // sheet as it stands, which keeps the holder's class features in a form.
    const definition = (creature.sheet.shapeShifts ?? []).find((s) => s.feature === shape.feature);

    const events: GameEvent[] = [];
    if (state.combat !== null && definition !== undefined && definition.action !== 'none') {
      const spent = spendFor(state, id, definition.action);
      if (!spent.ok) return spent;
      events.push(spent.value);
    }
    events.push({
      type: 'feature-ended',
      id,
      feature: shape.feature,
      reason: 'dismissed',
      ...(stamp === null ? {} : { command: stamp }),
    });
    return ok(events);
  });
}
