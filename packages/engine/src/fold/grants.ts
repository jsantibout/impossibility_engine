/**
 * The thirteen families of granted modifier, and the one rule they share.
 *
 * A bonus, an Armour Class, a roll modifier, a damage defence, a Speed, an
 * attack rider, a condition Immunity, a payout at a turn boundary, a rule
 * about what a turn may be spent on, a Reaction put in somebody's hands, a
 * rule about regaining hit points, a hit point maximum held up, and a
 * condition's benefit withheld. **Re-granting from the same source
 * replaces rather than stacks** in every one of them; what differs is only what
 * counts as the source's identity, which each case states where it departs.
 *
 * And the two removals that are nobody else's: a bonus taken off by name, and
 * a grant a roll **used up**. The second is the ending SRD Guiding Bolt and
 * Vicious Mockery name, and its body is the one `fold/expiry.ts` performs when
 * a `grants` deadline arrives — the same release, reached by a die rather than
 * by the clock.
 */
import { actionRuleKey } from '../combat.js';
import { rollModifierKey } from '../roll-modifiers.js';
import type { DeniedBenefit } from '../conditions.js';
import type { GameEvent } from '../events.js';
import type { GameState } from '../state.js';
import {
  CorruptLogError,
  creatureOf,
  withCreature,
  seamOf,
  unhandledEvent,
  type Applying,
} from './common.js';
import { releaseGrants } from './release.js';

/** The event types this seam owns. Every one of them, and no other seam's. */
export const GRANTS_EVENTS = [
  'bonus-applied',
  'armor-class-granted',
  'roll-modifier-granted',
  'passive-defense-granted',
  'decoy-destroyed',
  'damage-defense-granted',
  'speed-modifier-granted',
  'attack-rider-granted',
  'weapon-rider-granted',
  'condition-immunity-granted',
  'turn-payout-granted',
  'action-rule-granted',
  'reaction-granted',
  'healing-rule-granted',
  'benefit-denied',
  'hit-point-maximum-adjusted',
  'bonus-removed',
  'roll-modifier-consumed',
  'reaction-grant-consumed',
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

    case 'passive-defense-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces it rather than stacking, the
      // rule every family here follows: casting Mirror Image twice is one hall
      // of duplicates and not two, and the later casting's count is the one
      // that stands. The source alone is the identity — unlike a roll
      // modifier, no SRD casting hangs two passive defences of its own on one
      // creature, and if one ever does it is two sentences and two sources.
      const passiveDefenses = [
        ...creature.passiveDefenses.filter((held) => held.source !== event.defense.source),
        event.defense,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { passiveDefenses }, creature);
    }

    case 'decoy-destroyed': {
      const creature = creatureOf(state, event, event.id);
      // **A number moved, not a grant replaced.** The count is how much of the
      // spell is left rather than a fact about the creature, so it is edited
      // in place — see the event's own note for why this is the one grant in
      // the engine that may be.
      //
      // Floored at zero rather than refused below it: a log that destroyed a
      // fourth duplicate is a log nothing in this engine can write, and a
      // negative count would throw a negative number of dice.
      const passiveDefenses = creature.passiveDefenses.map((held) =>
        held.source === event.source && held.defense.kind === 'decoys'
          ? { ...held, defense: { ...held.defense, remaining: Math.max(0, held.defense.remaining - 1) } }
          : held,
      );
      return withCreature(next, event.id, { passiveDefenses }, creature);
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

    case 'weapon-rider-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces rather than stacking, the
      // rule every grant in the family follows. **The source alone is the
      // identity**, as it is for a defence, a Speed and a rider: no SRD
      // sentence imbues two weapons in one casting, and SRD Magic Weapon and
      // Shillelagh both say "the spell ends early if you cast it again" — so a
      // second casting is a second id and `replacesPriorCasting` is what takes
      // the first away, not a key collision here.
      const weaponRiders = [
        ...creature.weaponRiders.filter((held) => held.source !== event.rider.source),
        event.rider,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { weaponRiders }, creature);
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

    case 'turn-payout-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces rather than stacking, the
      // rule every grant in the family follows. **The source alone is the
      // identity**, as it is for a defence, a Speed, a rider and an Immunity:
      // no SRD sentence pays one creature twice a turn out of one casting, and
      // a second copy of Heroism's clause from the same casting is the same
      // clause.
      const payouts = [
        ...creature.payouts.filter((held) => held.source !== event.payout.source),
        event.payout,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { payouts }, creature);
    }

    case 'action-rule-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting the same **statement** from the same source replaces
      // rather than stacking — the rule every grant in the family follows —
      // but **the source alone is not the identity here**, for the reason it
      // is not in `roll-modifier-granted` two cases above: one casting can
      // say two things. SRD Magic Jar prints them in one entry — "You can't
      // move or take Reactions" and "The only action you can take is to
      // project your soul", a `forbids` and a `permits-only` — and under a
      // source key the second silently evicted the first, so the spell's own
      // paragraph lost half of itself between the definition and the state.
      //
      // Stinking Cloud's "an action or a Bonus Action" is still *one* rule
      // naming two slots, which is the plural `slots` inside it; what the
      // compound key admits is a second **sentence**. See `actionRuleKey`.
      const key = actionRuleKey(event.rule.source, event.rule.rule);
      const actionRules = [
        ...creature.actionRules.filter((held) => actionRuleKey(held.source, held.rule) !== key),
        event.rule,
      ].sort((a, b) => {
        const left = actionRuleKey(a.source, a.rule);
        const right = actionRuleKey(b.source, b.rule);
        return left < right ? -1 : left > right ? 1 : 0;
      });
      return withCreature(next, event.id, { actionRules }, creature);
    }

    case 'healing-rule-granted': {
      const creature = creatureOf(state, event, event.id);
      // The source alone is the identity, as it is for a defence, a Speed, a
      // rider, an Immunity and a payout: a second Beacon of Hope from the same
      // casting is the same Beacon of Hope, and a casting that both maximised
      // and forbade would be one sentence contradicting itself rather than two
      // grants — `healingRuleOf` is where a contradiction between *different*
      // sources is settled.
      const healingRules = [
        ...creature.healingRules.filter((held) => held.source !== event.rule.source),
        event.rule,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { healingRules }, creature);
    }

    case 'benefit-denied': {
      const creature = creatureOf(state, event, event.id);
      // **The source and the condition together are the identity**, which is
      // `action-rule-granted`'s key rather than the plain source every other
      // grant in the family uses — and for that case's reason. One casting
      // can deny two benefits: SRD Faerie Fire is one sentence about the
      // Invisible condition, and a homebrew that named two would lose the
      // first to the second under a source key, silently. A grant carries
      // one condition (see `DeniedBenefit`), so the pair is the whole of it.
      const key = (denial: DeniedBenefit): string => `${denial.source}|${denial.condition}`;
      const deniedBenefits = [
        ...creature.deniedBenefits.filter((held) => key(held) !== key(event.denial)),
        event.denial,
      ].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      return withCreature(next, event.id, { deniedBenefits }, creature);
    }

    case 'hit-point-maximum-adjusted': {
      const creature = creatureOf(state, event, event.id);
      if (!Number.isInteger(event.adjustment.amount) || event.adjustment.amount <= 0) {
        throw new CorruptLogError(
          event,
          `an effect holds a hit point maximum up by a positive whole number, got ${event.adjustment.amount}`,
        );
      }
      // Source-keyed like the eleven above, so a re-cast replaces rather than
      // stacks. **Nothing here touches the vitals**: the maximum is settled by
      // `settleHitPointMaximum` in the derived pass, which is the only place
      // that reads this list — because the *removals* are derived too, and one
      // arithmetic on the way in and a different one on the way out is how the
      // two come to disagree.
      const hitPointMaxima = [
        ...creature.hitPointMaxima.filter((held) => held.source !== event.adjustment.source),
        event.adjustment,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { hitPointMaxima }, creature);
    }

    case 'reaction-granted': {
      const creature = creatureOf(state, event, event.id);
      // Re-granting from the same source replaces rather than stacking, the
      // rule every grant in the family follows. **The source alone is the
      // identity**, and the source carries the giver — so one Bard inspiring
      // the same ally twice has inspired them once, and two Bards doing it
      // have given them two dice. That is the whole of what the giver's name
      // in `conferredSource` buys.
      const grantedReactions = [
        ...creature.grantedReactions.filter((held) => held.source !== event.reaction.source),
        event.reaction,
      ].sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
      return withCreature(next, event.id, { grantedReactions }, creature);
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

    case 'roll-modifier-consumed': {
      const creature = creatureOf(state, event, event.id);
      // **One line, and it is the `grants` deadline's line.** SRD Guiding Bolt
      // and Vicious Mockery each name a roll that uses the grant up, which is
      // an ending nothing else in the family has — and the *body* of that
      // ending is the one `fold/expiry.ts` already performs when a deadline
      // arrives: everything that source granted this creature, in every
      // family, matched on the bare source.
      //
      // Which is deliberately more than "the modifier that was spent". A
      // source is what a grant is linked by, and no SRD sentence spends half
      // of one; `releaseGrants` says why the identity that decides whether a
      // re-grant replaces is not the identity that decides an ending.
      return withCreature(next, event.id, releaseGrants(creature, event.source), creature);
    }

    case 'reaction-grant-consumed': {
      const creature = creatureOf(state, event, event.id);
      // The same line, one family along: SRD Bardic Inspiration's die "is
      // expended when it's used", which is an ending a deadline cannot see and
      // the giver has no part in. `releaseGrants` again, so a conferral that
      // hung two things loses both, exactly as it would at the hour.
      return withCreature(next, event.id, releaseGrants(creature, event.source), creature);
    }
  }

  return unhandledEvent(event);
}
