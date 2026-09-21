/**
 * Damage that has been rolled and not yet applied.
 *
 * Two callers, one arithmetic. A weapon attack's damage and a spell's both
 * arrive as typed components that Reactions may still reduce, and both then
 * meet the target's defences, the Concentration save and the death rules. The
 * SRD orders those steps — "adjustments ... are applied first; Resistance is
 * applied second" — and the order is observable, so exactly one function
 * applies it.
 *
 * It sits below `attacks.ts` and `reactions.ts` and above `casting.ts`,
 * which is the shape of the dependency: landing damage needs
 * `resolveDamage`, and both the attack and the Reaction that answers it need
 * to land damage.
 */

import { type Ability, type CharacterId, err, ok, type Result } from '@ie/shared';
import { applyDamage, type DamageComponent, rawDamageTotal } from '../attack.js';
import { parseNotation } from '../dice.js';
import { spendReaction } from '../combat.js';
import { isIncapacitated } from '../conditions.js';
import {
  applyEvent,
  type CreatureState,
  type GameEvent,
  type GameState,
  type PendingDamage,
  type PendingHitRider,
  type StatedRoll,
} from '../events.js';
import type { RollProvenance } from '../rolls.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  offersForDamage,
  reactionAddends,
  type ReactionAmount,
  type ReactionFeature,
  type ReactionOffer,
} from '../reactions.js';
import { remaining, tallied } from '../resources.js';
import { actionRulesOn, type CastingDamageFeature, defensesOf } from '../standing.js';
import {
  type ConcentrationConsequence,
  type Supply,
  resolveDamage,
} from './casting.js';
import { creatureOf, unknownCreature } from './command.js';
import { rollSpellDice } from './rolls.js';

/**
 * The faces a damage roll showed, as an event, or null where it threw none.
 *
 * **Owner, 2026-09-21:** "each individual damage dice needs to reach the log,
 * specifically for spells like sorcerous burst and chromatic orb, which burst
 * on certain numbers. it also creates transparency for things like the great
 * weapon fighting style feat." The dice were always there — `RollOutcome.dice`
 * is every die in the order it was rolled, dropped and rerolled ones included
 * — and on the held path they already reached the log inside `damage-rolled`.
 * Nothing carried them there on the ordinary path, which is the asymmetry this
 * closes. See `damage-dice-recorded` in `events.ts` for the whole argument.
 *
 * **Null where nothing was rolled**, which is not tidiness either: a blow made
 * entirely of modifiers has no faces to report, and an event with an empty
 * dice list in it would be a record of nothing appearing in a log beside every
 * flat amount a DM ever stated. Emitting one only where a die was thrown also
 * means no existing path that deals unrolled damage grows an event.
 *
 * The provenance comes off the roll itself rather than being assumed: a
 * component the engine threw carries no `stated`, and that absence is the
 * claim — see {@link StatedRoll}.
 */
export function damageDiceRecorded(
  target: CharacterId,
  components: readonly DamageComponent[],
  source: string,
  by?: CharacterId,
): GameEvent | null {
  if (!components.some((component) => (component.roll?.dice.length ?? 0) > 0)) return null;

  return {
    type: 'damage-dice-recorded',
    target,
    ...(by === undefined ? {} : { by }),
    source,
    rolled: rawDamageTotal(components),
    components: components.map((component) => ({
      source: component.source,
      type: component.type,
      roll: component.roll?.provenance.id ?? null,
      dice: component.roll?.dice ?? [],
      flat: component.flat,
      total: component.total,
      ...statedFrom(component.roll?.provenance),
    })),
  };
}

/**
 * The `stated` half of a roll's provenance, or nothing at all.
 *
 * One reading of `RollProvenance` in one place, so no emitter has to remember
 * that `engine` is the absence rather than a value. Spread into an event
 * literal: `...statedFrom(roll?.provenance)`.
 */
export function statedFrom(
  provenance: RollProvenance | undefined,
): { readonly stated: StatedRoll } | Record<string, never> {
  if (provenance === undefined || provenance.source === 'engine') return {};
  return { stated: { id: provenance.id, source: provenance.source, note: provenance.note } };
}

/** What the held damage currently comes to, after everything taken off so far. */
export function heldDamageTotal(pending: PendingDamage): number {
  const taken = pending.reductions.reduce((sum, r) => sum + r.amount, 0);
  return Math.max(0, rawDamageTotal(pending.components) - taken);
}

/**
 * Spread a reduction across the damage types it came off.
 *
 * **SRD orders this and does not apportion it.** "Modifiers to damage are
 * applied in the following order: adjustments such as bonuses, penalties, or
 * multipliers are applied first; Resistance is applied second" — so a
 * reduction is an *adjustment* and lands before Resistance, which is
 * observable: 10 Fire against a fire-resistant target reduced by 7 is 1 in
 * that order and 0 in the other.
 *
 * What the SRD never says is which *type* a reduction comes off when an attack
 * deals two, because every worked example it gives has one. Uncanny Dodge
 * halves "the attack's damage", Deflect Attacks reduces "the attack's total
 * damage" — the total, which `applyDamage` cannot take as one number because
 * Resistance is per type.
 *
 * So the engine chooses, deterministically and in one place: **largest raw
 * amount first, ties broken by type name.** It is a choice rather than a rule,
 * which is why it is stated here rather than buried; what it buys is that the
 * pre-defence total is always right and nothing is ever apportioned into a
 * fraction.
 */
export function adjustmentsFor(
  components: readonly DamageComponent[],
  reduction: number,
): Record<string, number> {
  const rawByType = new Map<string, number>();
  for (const component of components) {
    rawByType.set(
      component.type,
      (rawByType.get(component.type) ?? 0) + Math.max(0, component.total),
    );
  }

  const order = [...rawByType.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const adjustments: Record<string, number> = {};
  let left = reduction;
  for (const [type, raw] of order) {
    if (left <= 0) break;
    const off = Math.min(left, raw);
    adjustments[type] = -off;
    left -= off;
  }
  return adjustments;
}

/**
 * Deal damage, unless somebody may answer it first.
 *
 * The single funnel for the weapon-attack path, and the one decision that
 * keeps an ordinary attack an ordinary attack: with no eligible reactor the
 * damage is dealt in the same breath it was rolled, the same events come out,
 * and no caller learns that a window exists. That is the rule `pendingMove`
 * already follows, where a move that provokes nobody simply happens.
 *
 * **Spell damage does not come through here**, and that is a stated limit
 * rather than an oversight: a spell rolls its damage once for every target it
 * caught, so holding one target's share open would mean holding the whole
 * casting open per target — a different debt entirely. Cutting Words can
 * therefore answer a sword and not a Fireball.
 */
export function landDamage(
  state: GameState,
  target: CharacterId,
  components: readonly DamageComponent[],
  source: string,
  supply: Supply,
  options: {
    readonly critical?: boolean;
    readonly by?: CharacterId;
    readonly fromAttack?: boolean;
    /**
     * A rider this blow bought, for the window to hold until the defender has
     * answered — see {@link PendingDamage.rider}.
     *
     * Ignored where no window opens, which is where the caller applies it in
     * the same breath as it always has: there is nobody to answer first.
     */
    readonly rider?: PendingHitRider;
  },
): Result<{
  readonly events: readonly GameEvent[];
  readonly amount?: number;
  readonly concentration?: ConcentrationConsequence;
  readonly offers: readonly ReactionOffer[];
  readonly unverified: readonly string[];
}> {
  const possible = offersForDamage(state, {
    target,
    by: options.by ?? null,
    fromAttack: options.fromAttack === true,
    damageTypes: [...new Set(components.map((c) => c.type))].sort(),
  });

  if (possible.offers.length === 0) {
    const dealt = dealSpellDamage(state, target, components, source, supply, options);
    if (!dealt.ok) return dealt;
    return ok({
      events: dealt.value.events,
      amount: dealt.value.amount,
      concentration: dealt.value.concentration,
      offers: [],
      unverified: possible.unverified,
    });
  }

  const damage: PendingDamage = {
    target,
    by: options.by ?? null,
    source,
    components,
    critical: options.critical === true,
    fromAttack: options.fromAttack === true,
    reductions: [],
    offers: possible.offers,
    ...(options.rider === undefined ? {} : { rider: options.rider }),
  };

  return ok({
    events: [{ type: 'damage-rolled', damage }],
    offers: possible.offers,
    unverified: possible.unverified,
  });
}

/**
 * Spend what a reaction feature costs, or refuse.
 *
 * The Reaction is only spent **in combat** — outside it there is no economy,
 * the same reading `resolveCast`, `activateFeature` and `useSelfHeal` take.
 * The pool is spent either way, because a pool is not part of the economy.
 *
 * And a Reaction somebody **gave** this creature is spent by being used, which
 * is a third cost rather than a variant of the second: the pool it came out of
 * belongs to the giver and was charged when they gave it away.
 */
export function spendReactionCost(
  state: GameState,
  reactor: CharacterId,
  creature: CreatureState,
  feature: ReactionFeature,
): Result<GameEvent[]> {
  const events: GameEvent[] = [];

  if (feature.costsReaction) {
    if (state.combat !== null && state.combat.budgets[reactor] !== undefined) {
      const spent = spendReaction(state.combat, reactor, creature.conditions, {
        rules: actionRulesOn(state, reactor),
      });
      if (!spent.ok) return spent;
      events.push({ type: 'reaction-spent', id: reactor });
    } else if (isIncapacitated(creature.conditions)) {
      // Outside combat there is no Reaction to spend and `spendReaction` is
      // never asked, but SRD Incapacitated still forbids taking one.
      return err('incapacitated', `${reactor} is Incapacitated and can't take a Reaction`);
    }
  }

  if (feature.pool !== null) {
    if (remaining(creature.resources, feature.pool) < 1) {
      return err('exhausted', `${reactor} has no uses of ${feature.name} left`);
    }
    events.push({ type: 'resource-spent', id: reactor, key: feature.pool, amount: 1 });
  }

  // SRD Bardic Inspiration: "A Bardic Inspiration die is expended **when it's
  // used**." A Reaction somebody gave this creature costs no pool of theirs —
  // the giver paid — so what a use spends is the grant itself, and this is the
  // one place every window's command already asks what a Reaction costs.
  if (feature.granted !== undefined) {
    events.push({
      type: 'reaction-grant-consumed',
      id: reactor,
      source: feature.granted.source,
    });
  }

  return ok(events);
}

/** Every named contribution a reaction's amount made, for the audit trail. */
export function reactionContributions(
  amount: ReactionAmount,
  abilities: Readonly<Record<Ability, number>>,
  dieTotal: number,
  halved: number,
): { readonly source: string; readonly amount: number }[] {
  const parts: { source: string; amount: number }[] = [];
  if (amount.dice !== undefined) parts.push({ source: amount.dice, amount: dieTotal });
  if (amount.halve === true) parts.push({ source: 'halved', amount: halved });
  for (const addend of amount.plus ?? []) {
    parts.push({
      source: addend.label,
      amount: reactionAddends({ plus: [addend] }, abilities).total,
    });
  }
  return parts;
}

/**
 * Apply a spell's rolled damage to a target, defences and Concentration and all.
 *
 * Three things a spell must not have to remember, gathered in one place:
 *
 * - **The target's defences.** `applyDamage` has always taken them; nothing
 *   passed them, because they were not in state. A fire-immune creature took
 *   full damage from Fire Bolt, silently.
 * - **The Concentration the damage put at risk.** `resolveDamage` rolls that
 *   save itself, which is exactly why it exists — a caller who forgets leaves
 *   a spell running that the rules have ended.
 * - **Death and unconsciousness**, which `damageCreature` beneath it owns.
 *
 * Damage is summed per type before defences are applied, never per component:
 * halving 5 and 5 separately gives 4, halving their sum gives 5.
 */
export function dealSpellDamage(
  state: GameState,
  target: CharacterId,
  components: readonly DamageComponent[],
  source: string,
  supply: Supply,
  options: {
    readonly critical?: boolean;
    readonly by?: CharacterId;
    /**
     * SRD Overchannel: "This damage ignores Resistance and Immunity."
     *
     * The target's defences are not consulted at all rather than cancelled one
     * by one, because the sentence names both halves of `DamageDefenses` and
     * says nothing about Vulnerability — and an empty record is exactly "a
     * creature with no defences", which `applyDefenses` already answers for.
     */
    readonly ignoresDefenses?: boolean;
  },
): Result<{
  readonly events: readonly GameEvent[];
  readonly amount: number;
  readonly concentration: ConcentrationConsequence;
}> {
  const victim = state.creatures[target];
  if (victim === undefined) return unknownCreature(target);

  // A creature's own defences and the ones its features grant, together. The
  // stat block's entries alone would miss a Sorcerer's Elemental Affinity.
  const applied = applyDamage(
    components,
    options.ignoresDefenses === true ? {} : defensesOf(state, target),
  );
  const resolved = resolveDamage(
    state,
    target,
    {
      amount: applied.total,
      source,
      ...(options.critical === true ? { critical: true } : {}),
      ...(options.by === undefined ? {} : { by: options.by }),
    },
    supply,
  );
  if (!resolved.ok) return resolved;

  // The faces first, then what they came to: this is the chronology of the
  // moment, and the only place every unheld damage roll passes through. A held
  // one reports its dice on `damage-rolled` instead and does not come here at
  // all — `settleDamage` deals its damage through `resolveDamage` directly —
  // so the faces reach the log exactly once by either road.
  const dice = damageDiceRecorded(target, components, source, options.by);

  return ok({
    events: dice === null ? resolved.value.events : [dice, ...resolved.value.events],
    amount: applied.total,
    concentration: resolved.value.concentration,
  });
}

/**
 * What a `casting-damage` feature charges its holder for having used it.
 *
 * SRD Overchannel, which is the only line in the book of this shape: "The first
 * time you do so, you suffer no adverse effect. If you use this feature again
 * before you finish a Long Rest, you take 2d12 Necrotic damage for each level
 * of the spell slot immediately after you cast it. This damage ignores
 * Resistance and Immunity. Each time you use this feature again before
 * finishing a Long Rest, the Necrotic damage per spell level increases by
 * 1d12."
 *
 * Three sentences and three decisions:
 *
 * - **The use is always counted**, including the free one, because "the first
 *   time" is a fact about how many uses have gone before and nothing else could
 *   answer it. The count is a `Tally` — see {@link CastingDamageCost} for why
 *   it is not a pool — and the tag rides the use because nothing declares one.
 * - **The dice are `(base + extra × step) × slot level`**, where `extra` is how
 *   many uses have already been paid for. The second use of the feature at a
 *   level 3 slot is 6d12; the third is 9d12.
 * - **The damage ignores the caster's defences**, which is the one clause that
 *   needed anything new on the damage path — and it is an *absence* of
 *   defences rather than a cancellation of each, because that is what the
 *   sentence names.
 *
 * Everything after the dice is the path a spell's damage already takes, so the
 * drop to 0, the Unconscious, death and the Concentration the backlash put at
 * risk all behave exactly as a Fire Bolt's would.
 */
export function payCastingDamageCost(
  state: GameState,
  who: CharacterId,
  feature: CastingDamageFeature,
  slotLevel: number,
  supply: Supply,
): Result<readonly GameEvent[]> {
  const cost = feature.costs;
  if (cost === undefined) return ok([]);

  const caster = creatureOf(state, who);
  if (caster === null) return unknownCreature(who);

  const used = tallied(caster.resources, cost.key);
  const counted: GameEvent = {
    type: 'resource-spent',
    id: who,
    key: cost.key,
    amount: 1,
    tally: cost.recovers,
  };
  const events: GameEvent[] = [counted];
  if (used < cost.freeUses) return ok(events);

  const base = parseNotation(cost.dicePerSlotLevel);
  if (!base.ok) return base;
  const step = parseNotation(cost.increasesBy);
  if (!step.ok) return step;
  if (base.value.sides !== step.value.sides) {
    return err(
      'mismatched_backlash_dice',
      `${feature.name} escalates by a d${step.value.sides} on a cost printed in d${base.value.sides}s; one price is counted in one die`,
    );
  }

  const perLevel = base.value.count + (used - cost.freeUses) * step.value.count;
  const count = perLevel * Math.max(0, slotLevel);
  if (count <= 0) return ok(events);

  const current = events.reduce(applyEvent, state);
  const rolled = rollSpellDice(
    supply,
    caster.sheet,
    feature.name,
    cost.damageType,
    `${count}d${base.value.sides}`,
  );
  if (!rolled.ok) return rolled;

  const hurt = dealSpellDamage(current, who, rolled.value, feature.name, supply, {
    ...(cost.ignoresDefenses === true ? { ignoresDefenses: true } : {}),
  });
  if (!hurt.ok) return hurt;

  return ok([...events, ...hurt.value.events]);
}

/**
 * Dice a DM called for, thrown by the engine, landed like any other damage.
 *
 * The falling brazier, the collapsing floor, the boiling pitch. `resolveDamage`
 * already takes an *amount* a DM adjudicated, and that is a different act: an
 * amount has already met whatever defences the person saying it remembered,
 * where "4d6 Fire" is a kind of damage the engine measures for itself.
 *
 * **It is a command because throwing the dice is not something a caller may
 * do for itself.** `rollAttackDamage` is public and a caller holding an `Rng`
 * could reach it — and would consume a roll id and advance the generator with
 * no `rolls-issued` event to record either, because only a command emits one.
 * The dice would then be one roll ahead of the log, and every number after
 * them would differ on replay. This is the door that keeps the two in step.
 *
 * Everything after the dice is the path a spell's damage already takes
 * ({@link dealSpellDamage}), so Resistance, Vulnerability, Immunity, Temporary
 * Hit Points, the drop to 0 and the Unconscious that follows it, death, and
 * the Concentration save the damage put at risk all behave exactly as they do
 * for a Fire Bolt. Nothing here re-states any of them.
 *
 * **No Reaction window opens**, and that is the same stated limit
 * {@link landDamage} records for a spell: Uncanny Dodge answers a sword, and a
 * ceiling is not one.
 *
 * The victim's own sheet is what the dice are rolled against, and it
 * contributes nothing — `rollSpellDice` drops the weaponless component the
 * roller always adds, and a brazier carries nobody's ability modifier. It is
 * the victim's rather than the source's because a trap has no sheet at all,
 * which is the same reading `collectDueDamage` takes for a hit whose caster
 * may be dead by the time it falls.
 */
export interface ImprovisedDamageCommand extends CommandIdentity {
  /** Dice notation the table called for: `4d6`. Never a number a die showed. */
  readonly dice: string;
  /** Which kind, because Resistance is per type and a brazier burns. */
  readonly damageType: string;
  /** What did it, in the caller's own words. Recorded as the damage's source. */
  readonly source: string;
  /** The creature that dealt it, where one did. A trap has none. */
  readonly by?: CharacterId;
}

export interface ImprovisedDamageResolution {
  readonly events: readonly GameEvent[];
  /** The dice as they were rolled, each carrying the id the engine issued. */
  readonly components: readonly DamageComponent[];
  /** What the dice came to, before the target's defences. */
  readonly rolled: number;
  /** What actually landed, after them. */
  readonly amount: number;
  readonly concentration: ConcentrationConsequence;
  /** True when this command id had already been applied; `events` is empty. */
  readonly duplicate: boolean;
}

export function rollImprovisedDamage(
  state: GameState,
  target: CharacterId,
  command: ImprovisedDamageCommand,
  supply: Supply,
): Result<ImprovisedDamageResolution> {
  return once(state, `improvised-damage:${target}`, command, () => {
    return {
      events: [],
      components: [],
      rolled: 0,
      amount: 0,
      concentration: { kind: 'none' },
      duplicate: true,
    };
  }, (stamp) => {
    const victim = creatureOf(state, target);
    if (victim === null) return unknownCreature(target);

    // Notation is validated before a die is thrown, so a malformed `4d` comes
    // back as a refusal that moved nothing — which is what makes a refused
    // call free for a caller that rebuilds its generator from state.
    const issuedBefore = supply.issuer.count;
    const rolled = rollSpellDice(
      supply,
      victim.sheet,
      command.source,
      command.damageType,
      command.dice,
    );
    if (!rolled.ok) return rolled;

    // The stamp rides the `rolls-issued`, which is the one event this command
    // always writes: the damage that follows could be a zero against an immune
    // target, and a retry must be a no-op either way.
    const events: GameEvent[] = [
      {
        type: 'rolls-issued',
        count: supply.issuer.count - issuedBefore,
        rng: supply.rng.snapshot(),
        ...(stamp === null ? {} : { command: stamp }),
      },
    ];

    const hurt = dealSpellDamage(
      events.reduce(applyEvent, state),
      target,
      rolled.value,
      command.source,
      supply,
      command.by === undefined ? {} : { by: command.by },
    );
    if (!hurt.ok) return hurt;

    return ok({
      events: [...events, ...hurt.value.events],
      components: rolled.value,
      rolled: rawDamageTotal(rolled.value),
      amount: hurt.value.amount,
      concentration: hurt.value.concentration,
      duplicate: false,
    });
  });
}
