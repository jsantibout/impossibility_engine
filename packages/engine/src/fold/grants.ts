/**
 * The seven families of granted modifier, and the one rule they share.
 *
 * A bonus, an Armour Class, a roll modifier, a damage defence, a Speed, an
 * attack rider and a condition Immunity. **Re-granting from the same source
 * replaces rather than stacks** in every one of them; what differs is only what
 * counts as the source's identity, which each case states where it departs.
 */
import { rollModifierKey } from '../roll-modifiers.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import { creatureOf, withCreature, seamOf, unhandledEvent, type Applying } from './common.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const GRANTS_EVENTS = [
  'bonus-applied',
  'armor-class-granted',
  'roll-modifier-granted',
  'damage-defense-granted',
  'speed-modifier-granted',
  'attack-rider-granted',
  'condition-immunity-granted',
  'bonus-removed',
] as const;

/** The narrowed union this seam reduces, `Extract`ed from the list above. */
export type GrantsEvent = Extract<GameEvent, { type: (typeof GRANTS_EVENTS)[number] }>;

/** Whether an event is this seam's. Built from the same list, so the two cannot drift. */
export const isGrantsEvent = seamOf(GRANTS_EVENTS);

/**
 * Reduce one of this seam's events.
 *
 * Exported so `applyOne` may call it and for no other reason: it is not in
 * `fold/index.ts`, nothing under `commands/` can reach it, and a log becomes a
 * state by exactly one route.
 */
export function applyGrants({ state, next }: Applying, event: GrantsEvent): GameState {
  switch (event.type) {
    case 'bonus-applied': {
      const creature = creatureOf(state, event, event.id);
      // Re-applying the same source replaces it rather than stacking: a second
      // Bless from the same casting is the same Bless.
      const bonuses = [
        ...creature.bonuses.filter((held) => held.source !== event.bonus.source),
        event.bonus,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { bonuses }, creature);
    }

    case 'armor-class-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces it rather than stacking, the
      // same rule `bonus-applied` follows: a second Mage Armor from the same
      // casting is the same Mage Armor.
      const armorClasses = [
        ...creature.armorClasses.filter((held) => held.source !== event.armorClass.source),
        event.armorClass,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { armorClasses }, creature);
    }

    case 'roll-modifier-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting the same rolls from the same source replaces rather than
      // stacks — the rule `bonus-applied` and `armor-class-granted` follow —
      // but **the source alone is not the identity here**, because one casting
      // can grant two: Beacon of Hope's Wisdom saves and Death Saving Throws
      // are one sentence and two modifiers. See `rollModifierKey`.
      const key = rollModifierKey(event.modifier.source, event.modifier.modifier.selector);
      const rollModifiers = [
        ...creature.rollModifiers.filter(
          (held) => rollModifierKey(held.source, held.modifier.selector) !== key,
        ),
        event.modifier,
      ].sort((a, b) => {
        const left = rollModifierKey(a.source, a.modifier.selector);
        const right = rollModifierKey(b.source, b.modifier.selector);
        return left < right ? -1 : left > right ? 1 : 0;
      });
      return withCreature(next, event.id, { rollModifiers }, creature);
    }

    case 'damage-defense-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces it rather than stacking —
      // the rule `bonus-applied` and `armor-class-granted` follow, and the one
      // the SRD itself insists on here: "multiple instances of Resistance to
      // the same damage type count as only one", so there is nothing a second
      // copy could add.
      //
      // **The source alone is the identity**, unlike `roll-modifier-granted`.
      // Beacon of Hope needed a per-selector key because one casting grants two
      // modifiers in one sentence; no SRD sentence grants two *defences*, and a
      // per-kind key here would be the identity the `grants` timer deliberately
      // does not have.
      const grantedDefenses = [
        ...creature.grantedDefenses.filter((held) => held.source !== event.defense.source),
        {
          ...event.defense,
          // Lower-cased on the way in, so a fold compares byte for byte however
          // the type was spelled and the keys match the table `applyDamage`
          // sums into.
          damageTypes: [...event.defense.damageTypes.map((t) => t.toLowerCase())].sort(),
        },
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { grantedDefenses }, creature);
    }

    case 'speed-modifier-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces rather than stacking, which
      // is the rule `bonus-applied`, `armor-class-granted` and
      // `damage-defense-granted` all follow. **The source alone is the
      // identity**, as it is for a defence: `roll-modifier-granted` needed a
      // per-selector key because Beacon of Hope grants two modifiers in one
      // sentence, and no SRD sentence changes one creature's Speed twice.
      const speedModifiers = [
        ...creature.speedModifiers.filter((held) => held.source !== event.modifier.source),
        event.modifier,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { speedModifiers }, creature);
    }

    case 'attack-rider-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces rather than stacking, which
      // is the rule every other grant in the family follows. **The source
      // alone is the identity**, as it is for a defence and a Speed: no SRD
      // sentence hangs two riders on one creature from one casting, and
      // re-casting Hunter's Mark at a new quarry is the *same* casting's rider
      // pointed somewhere else rather than a second one.
      const attackRiders = [
        ...creature.attackRiders.filter((held) => held.source !== event.rider.source),
        event.rider,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { attackRiders }, creature);
    }

    case 'condition-immunity-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces rather than stacking, which
      // is the rule every other grant in the family follows — and the one the
      // SRD itself insists on here, exactly as it does for a Resistance: an
      // Immunity is a boolean, so there is nothing a second copy could add.
      //
      // **The source alone is the identity**, as it is for a defence, a Speed
      // and a rider: no SRD sentence makes one creature immune to two
      // *separate* runs of conditions from one casting — Heroes' Feast's
      // "Immunity to the Frightened and Poisoned conditions" is one clause
      // about two names, which is the plural `conditions` below.
      const grantedConditionImmunities = [
        ...creature.grantedConditionImmunities.filter(
          (held) => held.source !== event.immunity.source,
        ),
        {
          ...event.immunity,
          // Sorted and deduplicated on the way in, so a fold compares byte for
          // byte however the sentence was transcribed — the same treatment
          // `damage-defense-granted` gives its damage types, for the same
          // reason: this reaches serialised state and the log.
          conditions: [...new Set(event.immunity.conditions)].sort(),
        },
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { grantedConditionImmunities }, creature);
    }

    case 'bonus-removed': {
      const creature = creatureOf(state, event, event.id);
      return withCreature(
        next,
        event.id,
        { bonuses: creature.bonuses.filter((held) => held.source !== event.source) },
        creature,
      );
    }
  }

  return unhandledEvent(event);
}
