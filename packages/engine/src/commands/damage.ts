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
import {
  applyDamage,
  type DamageComponent,
  type DamageDefenses,
  type DamageReduction,
  rawDamageTotal,
} from '../attack.js';
import { parseNotation } from '../dice.js';
import { canUseFeatureThisTurn, spendReaction } from '../combat.js';
import { damageReductionsOf, reductionApplies } from '../damage-reduction.js';
import { isIncapacitated, sourceOfInstance } from '../conditions.js';
import { rollSavingThrow } from '../checks.js';
import { castingIdOf, castingSource } from '../spells.js';
import { type EffectTarget } from '../timers.js';
import {
  hasPrintedTrait,
  printedAbsorption,
  printedLineSource,
  printedTypeAversion,
  printedTypeSlow,
} from '../monster.js';
import { OBJECT_CREATURE_TYPE } from '../objects.js';
import { endOfNextTurn } from '../time.js';
import { schedule } from './conditions.js';
import {
  applyEvent,
  type CreatureState,
  type GameEvent,
  type GameState,
  type PendingDamage,
  type PendingHitRider,
  type StatedRoll,
} from '../events.js';
import { rollRecorded, type RollProvenance } from '../rolls.js';
import { type CommandIdentity, once } from '../idempotency.js';
import {
  offersForDamage,
  reactionAddends,
  type ReactionAmount,
  type ReactionFeature,
  type ReactionOffer,
} from '../reactions.js';
import { remaining, tallied } from '../resources.js';
import {
  actionRulesOn,
  type CastingDamageFeature,
  defensesOf,
  sheetAsItStands,
  spellDamageRiders,
} from '../standing.js';
import {
  type ConcentrationConsequence,
  type Supply,
  resolveDamage,
} from './casting.js';
import { creatureOf, damageTakenIn, unknownCreature } from './command.js';
import { holdBindsOn } from './unarmed.js';
import { recordD20Test, rollSpellDice, savingSupport } from './rolls.js';

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
function damageDiceRecorded(
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
 * SRD Siege Monster: "The elemental deals double damage to objects and
 * structures."
 *
 * **An adjustment, in SRD's own order.** "Modifiers to damage are applied in
 * the following order: adjustments such as bonuses, penalties, or
 * **multipliers** are applied first; Resistance is applied second" — so the
 * doubling goes in beside {@link adjustmentsFor}'s reduction rather than being
 * applied to what comes back, and a door with Resistance to Bludgeoning takes
 * half of twenty rather than twice of five.
 *
 * **Per type, because that is the shape an adjustment has here.** A blow of
 * two kinds is doubled in both, which is what "double damage" says about a
 * blow rather than about a die.
 *
 * **"Structures" names nothing this engine holds**, and that is the whole of
 * what is handed over: a declared object is the one thing that can be broken,
 * so the multiplier lands on `OBJECT_CREATURE_TYPE` and a castle wall is
 * whatever the table declared it as.
 *
 * **Two roads and one rule, which is why this is exported.** A blow held open
 * at a Reaction window settles through `settleDamage` in
 * `commands/reactions.ts` rather than here — and the window is not offered off
 * the *target's* Reactions alone: `offersForDamage` walks every creature and
 * skips only a reactor whose feature reaches `self`, so a Bard within sixty
 * feet of an Earth Elemental smashing a door holds that blow open with Cutting
 * Words. That road called `applyDamage` with the reductions alone and the
 * doubling was skipped; it calls this on the way past now, at the same step
 * and out of the same function, exactly as `standingReductionOf` is shared.
 * The same was true of {@link printedTypeTriggers} one function down.
 */
export function siegeDoubling(
  state: GameState,
  target: CharacterId,
  by: CharacterId | undefined,
  components: readonly DamageComponent[],
): Record<string, number> {
  if (by === undefined) return {};
  if (state.creatures[target]?.creatureType !== OBJECT_CREATURE_TYPE) return {};
  const dealer = state.creatures[by];
  if (dealer === undefined || !hasPrintedTrait(dealer.sheet, 'deals-double-damage-to-objects')) {
    return {};
  }

  const extra: Record<string, number> = {};
  for (const component of components) {
    extra[component.type] = (extra[component.type] ?? 0) + Math.max(0, component.total);
  }
  return extra;
}

/**
 * What a blow of a named type does to the creature's own printed traits.
 *
 * Two sentences, two verbs, and the verbs are the whole of what tells them
 * apart — see {@link printedAbsorption} and {@link printedTypeAversion}:
 *
 * - SRD Lightning Absorption is "**subjected to**", so the amount is what was
 *   rolled at the creature before its own defences. Both blocks that print it
 *   are immune to the type, and an amount read after Immunity would always be
 *   nought.
 * - SRD Aversion to Fire is "**takes**", so the clause follows damage that
 *   actually landed and a defence that turned the whole blow aside turns the
 *   clause aside with it.
 *
 * **Outside a fight the penalty is reported rather than hung**, because its
 * span is a moment in the turn order and there is no order to pin it in. That
 * is `schedule`'s own refusal, taken here in the direction every unsettled
 * clause on a stat-block line takes: the blow lands, and the sentence the
 * engine could not carry is named.
 *
 * **On both roads that land damage**, which is what {@link siegeDoubling}
 * above says about itself and for the same reason: a blow somebody held open
 * at a Reaction window settles in `commands/reactions.ts`, and a Flesh Golem
 * struck by lightning a Bard held open absorbed nothing until that road asked
 * this function too. It is asked there after the damage has landed, which is
 * where this road asks it and what both sentences are about.
 */
export function printedTypeTriggers(
  state: GameState,
  target: CharacterId,
  components: readonly DamageComponent[],
  byType: Readonly<Record<string, number>>,
): { readonly events: readonly GameEvent[]; readonly unverified: readonly string[] } {
  const sheet = state.creatures[target]?.sheet;
  if (sheet === undefined) return { events: [], unverified: [] };

  const events: GameEvent[] = [];
  const unverified: string[] = [];

  const absorbed = printedAbsorption(sheet);
  if (absorbed !== null) {
    const raw = components
      .filter((component) => component.type === absorbed)
      .reduce((sum, component) => sum + Math.max(0, component.total), 0);
    // `heal` clamps at the maximum, so nothing here has to.
    if (raw > 0) events.push({ type: 'healed', id: target, amount: raw });
  }

  const aversion = printedTypeAversion(sheet);
  if (aversion !== null && (byType[aversion.damageType] ?? 0) > 0) {
    // One grant per roll the sentence names, because a `RollModifier` carries
    // one selector — `printedSunlight` reads the same nouns the same way — and
    // they share a source, so one deadline ends all of them.
    // **Named for the rule and not for the heading**, which is the one place
    // this reader differs from `printedSunlight`: a sheet's `stated.traits`
    // carries the shapes the parser read and not the headings they were
    // printed under, and a `roll-modifier-granted`'s source is both what a
    // roll reports and the key its deadline ends. So the source says what the
    // rule *is* — which names a damage type and no catalogue entry.
    const hung = printedLineSource(target, `Disadvantage after ${aversion.damageType} damage`);
    const timer = schedule(state, { kind: 'grants', on: target, source: hung }, endOfNextTurn(target));
    if (!timer.ok) {
      unverified.push(
        `${target} took ${aversion.damageType} damage and its block gives it Disadvantage until the end of its next turn; there is no turn order for that moment to be pinned in, so nothing was hung`,
      );
    } else {
      for (const roll of aversion.rolls) {
        events.push({
          type: 'roll-modifier-granted',
          id: target,
          modifier: {
            source: hung,
            // The block's own heading is not in hand here, so the grant is
            // named by the line that dealt the damage; what a roll reports is
            // `ActiveRollModifier.source`, which is the key the deadline ends.
            modifier: { mode: 'disadvantage', selector: { roll, relation: 'roller' } },
          },
        });
      }
      events.push(timer.value);
    }
  }

  // SRD Freeze: "If the elemental takes Cold damage, its Speed decreases by 20
  // feet until the end of its next turn." The same trigger, the same span, and
  // a Speed on the end of it instead of a roll mode — so the reading of
  // "takes" is the same and so is the deadline.
  const slowed = printedTypeSlow(sheet);
  if (slowed !== null && (byType[slowed.damageType] ?? 0) > 0) {
    const hung = printedLineSource(target, `Speed cut after ${slowed.damageType} damage`);
    const timer = schedule(state, { kind: 'grants', on: target, source: hung }, endOfNextTurn(target));
    if (!timer.ok) {
      unverified.push(
        `${target} took ${slowed.damageType} damage and its block cuts its Speed by ${slowed.feet} feet until the end of its next turn; there is no turn order for that moment to be pinned in, so nothing was hung`,
      );
    } else {
      events.push(
        {
          type: 'speed-modifier-granted',
          id: target,
          modifier: { source: hung, change: 'add', feet: -slowed.feet },
        },
        timer.value,
      );
    }
  }

  return { events, unverified };
}

/**
 * The repeat saves a **blow** raises, rolled where the blow landed.
 *
 * SRD Hideous Laughter: "At the end of each of its turns **and each time it
 * takes damage**, it makes another Wisdom saving throw. The target has
 * Advantage on the save if the save is triggered by damage. On a successful
 * save, the spell ends."
 *
 * **Rolled here rather than owed as a debt**, which is the one decision in
 * this function and `RepeatSave.alsoWhenDamaged` is where it is argued: a turn
 * boundary raises what it owes because nothing else knows the moment has come,
 * and a blow is a command with a generator in its hand. Owing it would key on
 * the turn — `pendingSaveKey` is `<effect>@<turn>` — so a creature struck
 * twice in one turn would owe one save, which is not what "each time" says.
 *
 * **Asked of the world the blow left behind.** The timers are read off the
 * state *after* the damage has been folded on, so a condition the same blow
 * ended — SRD Sleep's "ends for the target if it takes damage" — raises
 * nothing, and a creature the blow killed is not asked to save. That is the
 * ordering the sentence itself has: it takes damage, and **then** it makes
 * another saving throw.
 *
 * **What a success ends is read off the timer, exactly as the boundary reads
 * it.** A condition's instance names the source, a casting's grants name it,
 * and `castingIdOf` turns it into the casting a `spell-ended` addresses —
 * `on: null` for "the spell ends" and `on: <target>` for "on itself". A
 * source that is no casting has nothing here for a `spell-ended` to name, and
 * the condition it holds is the thing a success would end, so the removal is
 * written directly; the SRD prints no such line today and the branch says so
 * rather than dropping the save.
 *
 * Walked in key order so two readers of one state roll the same dice in the
 * same order — the rule `raiseTurnSaves` keeps about the very same timers.
 */
export function repeatsRaisedByDamage(
  state: GameState,
  target: CharacterId,
  supply: Supply,
): Result<{ readonly events: readonly GameEvent[]; readonly unverified: readonly string[] }> {
  const events: GameEvent[] = [];
  const unverified: string[] = [];
  let current = state;

  for (const key of Object.keys(state.timers).sort()) {
    const timer = current.timers[key];
    const hook = timer?.repeatSave;
    if (timer === undefined || hook?.alsoWhenDamaged === undefined) continue;
    // "**it** takes damage" — the creature the save is anchored to, which is
    // the one `RepeatSave.of` already names for the boundary.
    if (hook.of !== target) continue;

    const victim = current.creatures[target];
    if (victim === undefined || victim.vitals.dead) continue;

    const host = hostOfTimer(current, timer.target);
    if (host === null) {
      unverified.push(
        `${hook.label}: ${target} took damage and owes this save, and nothing here says what put the effect there, so it was not rolled`,
      );
      continue;
    }

    const on = timer.target;
    const about =
      on.kind === 'condition'
        ? victim.conditions.instances
            .filter((held) => held.id === on.instance || held.impliedBy === on.instance)
            .map((held) => held.condition)
        : [];
    const support = savingSupport(
      current,
      target,
      victim,
      hook.ability,
      supply,
      about,
      castingIdOf(host) !== null,
    );
    const save = rollSavingThrow(
      supply.issuer,
      supply.rng,
      sheetAsItStands(current, target) ?? victim.sheet,
      hook.ability,
      {
        dc: hook.dc,
        conditions: support.conditions,
        // "The target has Advantage on the save if the save is triggered by
        // damage", attributed so the log says which sentence granted it.
        modes: [...support.modes, { source: hook.label, mode: hook.alsoWhenDamaged.mode }],
        bonuses: support.bonuses,
      },
    );
    if (!save.ok) return save;

    const settled: GameEvent[] = [
      recordD20Test(
        target,
        hook.label,
        save.value,
        save.value.success ? 'shakes it off' : 'still held',
      ),
      // **A success that ends nothing ends nothing here either.** SRD Bestow
      // Curse's Dodge face is the one hook that says so, and the road this
      // function is on — a repeat raised by damage rather than by a boundary —
      // reads the same three values the boundary does.
      ...(save.value.success && hook.onSuccess !== 'nothing'
        ? endingFor(current, timer.target, hook.onSuccess, host, target)
        : []),
    ];
    events.push(...settled);
    current = settled.reduce(applyEvent, current);
  }

  return ok({ events, unverified });
}

/**
 * What put the effect a timer stands over there, where the timer can say.
 *
 * The three kinds `raiseTurnSaves` reads, answered the same way: a condition
 * carries its source inside its instance id, a casting's grants carry it as
 * the source they were made under, and a casting's own timer has it on the
 * live record. Null for a casting with no record, which is a log this engine
 * did not write.
 */
function hostOfTimer(state: GameState, target: EffectTarget): string | null {
  if (target.kind === 'condition') return sourceOfInstance(target.instance);
  if (target.kind === 'grants') return target.source;
  if (target.kind !== 'casting') return null;
  const record = state.ongoing[target.castingId];
  return record === undefined ? null : castingSource(record.spell, target.castingId);
}

/** What a success ends, written as the events that end it. */
function endingFor(
  state: GameState,
  target: EffectTarget,
  onSuccess: 'end-casting' | 'end-on-target',
  source: string,
  who: CharacterId,
): readonly GameEvent[] {
  const castingId = castingIdOf(source);
  if (castingId !== null) {
    return [
      {
        type: 'spell-ended',
        castingId,
        on: onSuccess === 'end-casting' ? null : who,
        reason: 'saved-against',
      },
    ];
  }
  // No casting behind it, so what the success ends is the condition the save
  // was against — the reading `fold/timers.ts` takes of the same sentence at a
  // turn boundary, written here as the removal it performs.
  if (target.kind !== 'condition') return [];
  return (state.creatures[who]?.conditions.instances ?? [])
    .filter((held) => held.id === target.instance)
    .map((held) => ({ type: 'condition-removed', id: who, condition: held.condition, source }));
}

/** A standing reduction, rolled: what it took off and what the log says about it. */
export interface StandingReduction {
  readonly events: readonly GameEvent[];
  /** What comes off the total, before any defence is applied. */
  readonly amount: number;
}

/**
 * What the reductions standing on a creature take off this blow.
 *
 * SRD Resistance, the cantrip: "When the creature takes damage of the chosen
 * type before the spell ends, the creature reduces the total damage taken by
 * 1d4. A creature can benefit from this spell only once per turn." Three
 * sentences and three decisions, and none of them is the arithmetic —
 * {@link adjustmentsFor} has answered "off which type" since Uncanny Dodge
 * needed it, and the reduction is fed into that as a total exactly as a
 * Reaction's is.
 *
 * **One helper, because there are two roads to a hit and only one rule.**
 * {@link dealSpellDamage} lands a blow nobody may answer; `settleDamage`
 * lands one somebody held open at a Reaction window. A reduction written into
 * the first alone would be skipped by every blow a defender answered, which is
 * precisely the blow a defender is most likely to be holding a ward against.
 *
 * **The die is thrown here and its faces reach the log**, because that is what
 * every die this engine throws does: a `roll-recorded` names the ward, the
 * notation and what it prevented, so the total the target lost can be read
 * back out of the log rather than taken on trust.
 *
 * **"Only once per turn" is the engine's own ledger** — `feature-used`, keyed
 * on the grant's `source`, which is the casting id and therefore already
 * unique per casting. Two Resistances on one creature are two allowances; one
 * Resistance and two blows in a turn is one. Outside combat there are no turns
 * and nothing restricts it, which is the reading `canUseFeatureThisTurn`
 * already takes of every once-per-turn line in the book — and the `feature-used`
 * is written only where a budget exists to hold it, because a log that says a
 * feature was used outside combat is a log the fold refuses.
 */
export function standingReductionOf(
  state: GameState,
  target: CharacterId,
  components: readonly DamageComponent[],
  supply: Supply,
): Result<StandingReduction> {
  const standing = damageReductionsOf(state, target).filter((reduction) =>
    reductionApplies(reduction, components),
  );
  if (standing.length === 0) return ok({ events: [], amount: 0 });

  const combat = state.combat;
  const counted = combat !== null && combat.budgets[target] !== undefined;
  const events: GameEvent[] = [];
  let amount = 0;

  for (const reduction of standing) {
    const capped = reduction.oncePerTurn === true && counted;
    if (capped && !canUseFeatureThisTurn(combat!, target, reduction.source)) continue;

    const rolled = rollRecorded(supply.issuer, supply.rng, reduction.dice);
    if (!rolled.ok) return rolled;
    amount += rolled.value.total;

    events.push({
      type: 'roll-recorded',
      who: target,
      label: reduction.label,
      natural: rolled.value.total,
      total: rolled.value.total,
      contributions: [{ source: reduction.dice, amount: rolled.value.total }],
      outcome: `${rolled.value.total} damage prevented`,
    });
    if (capped) {
      events.push({
        type: 'feature-used',
        id: target,
        feature: reduction.source,
        turn: combat!.turnsTaken,
      });
    }
  }

  return ok({ events, amount });
}

/** What the penalties standing on a dealer take off this blow, and its dice. */
export interface DealtPenalty {
  readonly events: readonly GameEvent[];
  /** One entry per penalty, for the record a held blow carries. */
  readonly reductions: readonly DamageReduction[];
  /** What comes off the total, before any defence is applied. */
  readonly amount: number;
}

/**
 * What the penalties standing on the creature **dealing** this blow take off it.
 *
 * SRD Ray of Enfeeblement: "it also subtracts 1d8 from all its damage rolls."
 * SRD Enlarge/Reduce, reduced: "deal 1d4 less damage on a hit (this can't
 * reduce the damage below 1)." The Gold Dragon Wyrmling's Weakening Breath
 * prints the third.
 *
 * **{@link standingReductionOf}'s mirror, one creature along.** That reads
 * the grants on whoever is *hit*; this reads the grants on whoever *swung*,
 * and the two feed the same adjustment because SRD's "Order of Application"
 * puts every penalty in one step before Resistance. They are two functions
 * rather than one because they read two creatures and two grant families, and
 * a single walk would have had to be told which end it was standing at.
 *
 * **The die is thrown here and its faces reach the log**, the rule every die
 * this engine throws keeps: a `roll-recorded` names the spell, the notation
 * and what it took off, so the number a blow lost can be read back out of the
 * log rather than taken on trust.
 *
 * **The floor is read against the blow's total**, because that is what SRD's
 * parenthesis is about — the damage the target takes, not any one component of
 * it. Absent is no floor, which is what Ray of Enfeeblement prints: a 1d8 off
 * a dagger can leave nothing at all. Where several penalties stand at once the
 * strictest floor wins and the surplus is trimmed off the last of them, so the
 * entries a held blow carries still sum to what actually came off.
 *
 * **Nothing at all where nobody is named as the dealer**, which is a fall, a
 * poison and a DM's improvised amount: those are not a creature's damage roll,
 * and a sentence about "its damage rolls" has nothing to say about them.
 */
export function damagePenaltyOf(
  state: GameState,
  dealer: CharacterId | undefined,
  components: readonly DamageComponent[],
  supply: Supply,
): Result<DealtPenalty> {
  const nothing: DealtPenalty = { events: [], reductions: [], amount: 0 };
  if (dealer === undefined) return ok(nothing);

  // Sorted by source, for `damageReductionsOf`'s reason: two penalties would
  // otherwise be rolled in whatever order the grants happened to be filed in,
  // and the order *is* which penalty gets which die.
  const standing = [...(state.creatures[dealer]?.damagePenalties ?? [])].sort((a, b) =>
    a.source < b.source ? -1 : a.source > b.source ? 1 : 0,
  );
  if (standing.length === 0) return ok(nothing);

  // A blow that came to nothing has no damage roll to subtract from, so no die
  // is thrown: throwing one would move the generator for a subtraction that
  // could take nothing off, which is a replay divergence bought for no rule.
  const raw = rawDamageTotal(components);
  if (raw === 0) return ok(nothing);

  const entries: {
    source: string;
    roll: DamageReduction['roll'];
    /** What the amount was made of, named apart so the log can add up. */
    parts: { readonly source: string; readonly amount: number }[];
    rolled: number;
    amount: number;
  }[] = [];
  let floor = 0;

  for (const penalty of standing) {
    let rolled: DamageReduction['roll'] = null;
    if (penalty.dice !== undefined) {
      const outcome = rollRecorded(supply.issuer, supply.rng, penalty.dice);
      if (!outcome.ok) return outcome;
      rolled = outcome.value;
    }
    const amount = (rolled?.total ?? 0) + (penalty.flat ?? 0);
    if (penalty.floor !== undefined) floor = Math.max(floor, penalty.floor);
    entries.push({
      source: penalty.label,
      roll: rolled,
      // **The die and the printed number apart.** A grant may carry both —
      // `checkDamagePenalty` asks only that it carry one of them — and a
      // single contribution naming the notation would say the d8 showed nine.
      // Every number in this engine's log has to be one that could have
      // happened.
      parts: [
        ...(penalty.dice === undefined
          ? []
          : [{ source: penalty.dice, amount: rolled?.total ?? 0 }]),
        ...(penalty.flat === undefined
          ? []
          : [{ source: 'the printed number', amount: penalty.flat }]),
      ],
      rolled: amount,
      amount,
    });
  }

  // "This can't reduce the damage below 1": the cap is on the total, and the
  // surplus comes off the last entry so the record still adds up.
  const ceiling = Math.max(0, raw - floor);
  let total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  for (let i = entries.length - 1; i >= 0 && total > ceiling; i -= 1) {
    const over = total - ceiling;
    const off = Math.min(over, entries[i]!.amount);
    entries[i] = { ...entries[i]!, amount: entries[i]!.amount - off };
    total -= off;
  }

  // **The log is written after the trimming, not during it**, which is the
  // whole reason the loop above writes no event. The grant came to what it
  // came to — `natural` and `total` are the throw, and the contributions name
  // the die and the printed number apart so a reader can add them up — but
  // what the blow actually lost is the trimmed amount, and an outcome line
  // naming the throw would tell a table five where three came off. SRD
  // Enlarge/Reduce is the sentence that makes the two differ.
  const events: GameEvent[] = entries.map((entry) => ({
    type: 'roll-recorded',
    who: dealer,
    label: entry.source,
    natural: entry.rolled,
    total: entry.rolled,
    contributions: entry.parts,
    outcome: `${entry.amount} subtracted from the damage`,
  }));

  return ok({
    events,
    reductions: entries.map(({ source, roll, amount }) => ({ source, roll, amount })),
    amount: total,
  });
}

/**
 * The generator moving, as an event, or nothing where it did not move.
 *
 * `rolls-issued` carries a **delta**, and `fold/rolls.ts` accumulates it into
 * `rollsIssued` — which is what the next command starts its roll ids from. So
 * a die thrown with no count beside it has the next roll reusing an id the log
 * already holds, silently. Every command that rolls writes one; this is the
 * spelling for a command that rolls in the middle of somebody else's work and
 * has to record its own share narrowly.
 *
 * No stamp: a command identifies itself on the event it *always* emits, and
 * this one is conditional by construction.
 */
export const rollsIssuedSince = (supply: Supply, before: number): readonly GameEvent[] =>
  supply.issuer.count > before
    ? [
        {
          type: 'rolls-issued',
          count: supply.issuer.count - before,
          rng: supply.rng.snapshot(),
        },
      ]
    : [];

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
      unverified: [...possible.unverified, ...dealt.value.unverified],
    });
  }

  // **What the swinger's own penalty takes off, on the road a defender is
  // holding open.** SRD Ray of Enfeeblement subtracts from the damage *roll*,
  // so it is settled where the roll is rather than where the blow lands — and
  // the debt already has a slot for it, `PendingDamage.reductions`, which
  // `heldDamageTotal` subtracts and `settleDamage` feeds to `adjustmentsFor`
  // beside the defender's own ward. So neither this road nor the other has a
  // rule of its own, and the unheld one asks {@link dealSpellDamage} for the
  // very same answer one line above.
  const issuedBefore = supply.issuer.count;
  const penalty = damagePenaltyOf(state, options.by, components, supply);
  if (!penalty.ok) return penalty;

  const damage: PendingDamage = {
    target,
    by: options.by ?? null,
    source,
    components,
    critical: options.critical === true,
    fromAttack: options.fromAttack === true,
    reductions: penalty.value.reductions,
    offers: possible.offers,
    ...(options.rider === undefined ? {} : { rider: options.rider }),
  };

  return ok({
    events: [
      ...penalty.value.events,
      ...rollsIssuedSince(supply, issuedBefore),
      { type: 'damage-rolled', damage },
    ],
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
  blow: readonly DamageComponent[],
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
    /**
     * This blow is a **spell's** damage that no attack roll bought.
     *
     * SRD Bestow Curse's fourth face: "If you deal damage to the target with
     * an attack roll **or a spell**, the target takes an extra 1d8 Necrotic
     * damage." The attack half is already answered a road away — every attack
     * gathers its riders through `grantedAttackRiders` before the blow is
     * rolled, and hands them in as components — so what this flag marks is the
     * *other* road, and gathering on both would throw the die twice.
     *
     * **Set by the three effect resolvers that raise a casting's damage without
     * an attack roll**, and by nothing else that is not a spell: a fall, a
     * Fire Shield's flames, a feature's pool, a monster's printed save and a
     * DM's stated amount are none of them "a spell", and the flag is what
     * keeps the sentence to what it says.
     *
     * **And one seam a spell's damage does reach is deliberately not marked
     * yet**, because it is another track's file: `commands/turns.ts` deals a
     * casting's *scheduled* hit (SRD Acid Arrow's second round), an ongoing
     * casting's per-turn payout and the burn a repeat save collects before the
     * die, and all three are a spell dealing damage to a creature. So Bestow
     * Curse's die does not ride a Moonbeam tick today. That is a known gap
     * with a named seam rather than a rule: whoever owns those three call
     * sites sets the flag there and nothing else has to change.
     */
    readonly fromSpell?: true;
  },
): Result<{
  readonly events: readonly GameEvent[];
  readonly amount: number;
  /**
   * What each **type** in the blow came to after the target's own defences.
   *
   * SRD Vampire Spawn's Bite: "5 (1d4 + 3) Piercing damage plus 10 (3d6)
   * Necrotic damage. The target's Hit Point maximum decreases by an amount
   * equal to the **Necrotic** damage taken." One blow, two components, and a
   * clause about one of them — which {@link amount} cannot answer and
   * `applyDamage` already computes on the way past.
   *
   * **What the defences left, which is not always what was taken.** A damage
   * threshold turns a whole blow aside, so a caller reading one component out
   * of this asks {@link amount} first: nought taken is nought of every type.
   */
  readonly byType: Readonly<Record<string, number>>;
  readonly concentration: ConcentrationConsequence;
  /**
   * Clauses this blow applied without being able to check them — a side nobody
   * has declared, a holder nobody has placed, an Undead Fortitude thrown
   * against an amount with no type. `resolveDamage`'s own report, handed
   * straight on: this is the funnel's answer and not a second one. Empty for
   * almost every blow.
   */
  readonly unverified: readonly string[];
}> {
  const victim = state.creatures[target];
  if (victim === undefined) return unknownCreature(target);

  // **The die a curse hangs on every blow its caster lands, on the road an
  // attack does not take.** SRD Bestow Curse: "If you deal damage to the
  // target with an attack roll **or a spell**, the target takes an extra 1d8
  // Necrotic damage." A component of its own, so it meets the target's
  // defences separately — which is the whole reason it is not folded into the
  // spell's own dice — and thrown **before** the two subtractions below,
  // because it is part of the damage roll they come off.
  //
  // The dealer's own sheet where they are still here, for the reason
  // `burnBeforeTheSave` reads the recipient's: the components kept are the
  // rider's own, so nothing off the sheet reaches the number and the roll
  // cannot fail for want of a caster who has since died.
  const issuedBeforeRider = supply.issuer.count;
  const carried =
    options.fromSpell === true && options.by !== undefined
      ? spellDamageRiders(state.creatures[options.by], target)
      : [];
  const riders: DamageComponent[] = [];
  for (const rider of carried) {
    const rolled = rollSpellDice(
      supply,
      state.creatures[options.by!]?.sheet ?? victim.sheet,
      rider.source,
      rider.type,
      rider.dice,
    );
    if (!rolled.ok) return rolled;
    riders.push(...rolled.value);
  }
  const riderCounted = rollsIssuedSince(supply, issuedBeforeRider);
  const components = riders.length === 0 ? blow : [...blow, ...riders];

  // **What the creature that swung has to take off its own roll, first.** SRD
  // Ray of Enfeeblement: "it also subtracts 1d8 from all its damage rolls."
  // The subtraction is part of the damage *roll*, so its die is thrown before
  // the defender's ward is asked about anything — which is the chronology the
  // events below are written in, and the order is what decides which die each
  // of the two gets. Nothing at all where nobody is named as the dealer — a
  // fall, a poison, a DM's stated amount — for the reason `damagePenaltyOf`
  // gives; and both amounts then go into one adjustment, because SRD's Order
  // of Application puts every penalty in one step before Resistance.
  const issuedBeforePenalty = supply.issuer.count;
  const penalty = damagePenaltyOf(state, options.by, components, supply);
  if (!penalty.ok) return penalty;
  const penaltyCounted = rollsIssuedSince(supply, issuedBeforePenalty);

  // **What a ward standing on the defender takes off, before anything else.**
  // SRD's order of application puts an adjustment first and Resistance second,
  // so this is computed here and handed to `applyDamage` as the adjustment
  // rather than subtracted from what comes back. `settleDamage` does exactly
  // the same with the same helper, which is what keeps a blow somebody
  // answered and a blow nobody could from being two different rules.
  const issuedBeforeWard = supply.issuer.count;
  const warded = standingReductionOf(state, target, components, supply);
  if (!warded.ok) return warded;
  // **And the die is counted here rather than by whoever called.** Thirteen
  // commands reach this function and five of them take their generator delta
  // *before* the call — the ordinary weapon attack among them — so a ward that
  // trusted the caller would throw a d4 nobody counted, leave `rollsIssued`
  // short, and have the next command reuse a roll id the log already holds.
  //
  // **Counting it twice is the safe direction and is precedented one line
  // down**: `resolveDamage` emits its own narrow `rolls-issued` for an Undead
  // Fortitude save while a casting's effect loop counts the same die again. A
  // doubled count *skips* roll ids and never reuses one, which is the whole of
  // what `rollsIssued` is for.
  //
  // **What this promises about the snapshot is the ward's own and no more.**
  // The `rng` it carries is read after the d4 and before anything else this
  // function throws, so it is never behind the generator at the moment it is
  // written and never displaces a later reading: every roll that follows —
  // `resolveDamage`'s save — writes its own. Whether the *log's last* snapshot
  // is the live generator is a wider claim and not one to make here; a rider
  // resolved after the blow (`applyHitRider`, from `resolveAttack`) throws
  // without writing one at all, which is that road's gap rather than this
  // one's.
  const wardCounted = rollsIssuedSince(supply, issuedBeforeWard);

  // A creature's own defences and the ones its features grant, together. The
  // stat block's entries alone would miss a Sorcerer's Elemental Affinity.
  // The ward's reduction and SRD Siege Monster's multiplier, which are one
  // list because the book makes them one step: "adjustments such as bonuses,
  // penalties, or multipliers are applied first; Resistance is applied
  // second." Nothing in the SRD prints both on one blow, and the sum is what
  // either would be alone where only one is present.
  const adjustments = adjustmentsFor(components, warded.value.amount + penalty.value.amount);
  for (const [type, extra] of Object.entries(
    siegeDoubling(state, target, options.by, components),
  )) {
    adjustments[type] = (adjustments[type] ?? 0) + extra;
  }

  // — what a hold binds its holder with — W7-B10 ————————————————————————————
  //
  // SRD Animated Rug of Smothering: "While grappling the target, … the rug
  // halves the damage it takes (round down), and the target takes the same
  // amount of damage." Both halves of the one sentence, here beside each
  // other: the halving is a Resistance to every type in the blow — which is
  // the glossary's own rounding — and the sharing is the blow's outcome dealt
  // again to whoever is held, below. Read off the holder's block and the
  // standing hold rather than pinned, because a grapple has no record to carry
  // a clause. **The held road does not pass through here**: a blow a defender
  // held open lands through `settleDamage`, which asks `defensesOf` alone, so a
  // Rug struck by a blow a Cutting Words answered halves nothing — a gap
  // named rather than a rule, because `defensesOf` cannot read the block
  // without a runtime cycle through `monster.ts`.
  const binding = options.ignoresDefenses === true ? null : holdBindsOn(state, target);
  const defenses = defensesOf(state, target);
  const halving: Record<string, DamageDefenses> = { ...defenses };
  if (binding?.binds.halvesDamageTaken === true) {
    for (const component of components) {
      halving[component.type] = { ...halving[component.type], resistant: true };
    }
  }
  const applied = applyDamage(
    components,
    options.ignoresDefenses === true ? {} : halving,
    adjustments,
  );
  const resolved = resolveDamage(
    state,
    target,
    {
      amount: applied.total,
      source,
      // **What kinds this blow was made of, carried past the arithmetic.**
      // The total is what the defences left; the types are what SRD Undead
      // Fortitude's "unless the damage is Radiant" reads, and nothing else on
      // the command can answer it. Sorted and de-duplicated, because a log is
      // compared byte for byte and the order components happened to be rolled
      // in is not a fact about the blow.
      types: [...new Set(components.map((component) => component.type))].sort(),
      ...(options.critical === true ? { critical: true } : {}),
      ...(options.by === undefined ? {} : { by: options.by }),
    },
    supply,
  );
  if (!resolved.ok) return resolved;

  // "and the target takes the same amount of damage" — the other half of the
  // Rug's sentence, dealt to each creature the holder holds, through the same
  // funnel, as what the holder took after the halving above. Under its own
  // source so the log says why, with the blow's dealer, of the blow's types;
  // never along a chain, because a share is not a blow the holder's hold
  // binds. Shaped as SRD Warding Bond's share is (`bondSharedDamage`), which
  // is the same sentence about a casting.
  const shared: GameEvent[] = [];
  const sharedUnverified: string[] = [];
  if (binding?.binds.sharesDamageWithHeld === true && !source.endsWith(SHARED_BY_HOLD)) {
    const taken = damageTakenIn(resolved.value.events, applied.total);
    if (taken > 0) {
      let world = resolved.value.events.reduce(applyEvent, state);
      for (const who of binding.held) {
        if (world.creatures[who]?.vitals.dead === true) continue;
        const passed = resolveDamage(
          world,
          who,
          {
            amount: taken,
            source: `${source} (${target}'s hold${SHARED_BY_HOLD}`,
            types: [...new Set(components.map((component) => component.type))].sort(),
            ...(options.by === undefined ? {} : { by: options.by }),
          },
          supply,
        );
        if (!passed.ok) return passed;
        shared.push(...passed.value.events);
        sharedUnverified.push(...passed.value.unverified);
        world = passed.value.events.reduce(applyEvent, world);
      }
    }
  }

  // The faces first, then what they came to: this is the chronology of the
  // moment, and the only place every unheld damage roll passes through. A held
  // one reports its dice on `damage-rolled` instead and does not come here at
  // all — `settleDamage` deals its damage through `resolveDamage` directly —
  // so the faces reach the log exactly once by either road.
  const dice = damageDiceRecorded(target, components, source, options.by);

  // **What the blow bought whoever was watching is `resolveDamage`'s now**,
  // and it used to be computed here. SRD Dark One's Blessing asks about the
  // *outcome* rather than the swing, and this is only one of the roads to that
  // outcome: a DM's improvised amount reaches `resolveDamage` without passing
  // through here at all. So the question is asked at the funnel every road
  // shares, and comes back on the events and the report below — see
  // `commands/drop-rewards.ts`.

  // **After the blow has landed, because both sentences are about it having
  // landed.** The heal reads what was rolled and the penalty reads what was
  // taken, and a `healed` written before the `damage-taken` it answers would
  // be a log nobody could narrate in order.
  const triggered = printedTypeTriggers(state, target, components, applied.byType);

  // **And the saves the blow itself raises**, asked of the world the blow left
  // behind: SRD Hideous Laughter's "each time it takes damage, it makes
  // another Wisdom saving throw". See {@link repeatsRaisedByDamage} for why
  // this is rolled here rather than owed as a debt.
  const issuedBeforeRaised = supply.issuer.count;
  const raised = repeatsRaisedByDamage(
    [...resolved.value.events, ...triggered.events].reduce(applyEvent, state),
    target,
    supply,
  );
  if (!raised.ok) return raised;
  // **And the saves it threw are counted here**, by the rule the ward's d4
  // above follows and for the same reason: five of the thirteen commands that
  // reach this function take their generator delta *before* the call, so a die
  // this road threw and nobody counted would leave `rollsIssued` short and let
  // the next command reuse a roll id the log already holds.
  const raisedCounted = rollsIssuedSince(supply, issuedBeforeRaised);

  return ok({
    // The faces, then the ward's own die, then what the two came to: the
    // chronology of the moment, which is the rule the line above states. The
    // spoils ride at the end of `resolveDamage`'s own events, because nothing
    // is owed until the creature is down.
    events: [
      ...(dice === null ? [] : [dice]),
      ...riderCounted,
      ...penalty.value.events,
      ...penaltyCounted,
      ...warded.value.events,
      ...wardCounted,
      ...resolved.value.events,
      ...shared,
      ...triggered.events,
      ...raised.value.events,
      ...raisedCounted,
    ],
    // What landed, which is what the defences left of the roll *and* what a
    // damage threshold let through. `damageTakenIn` reads it off the event the
    // command wrote rather than re-deriving it here, so there is one answer.
    amount: damageTakenIn(resolved.value.events, applied.total),
    // What the defences left of each component, for the one clause in the
    // book that asks about one of them — see the field's own note.
    byType: applied.byType,
    concentration: resolved.value.concentration,
    // **Everything the funnel could not settle, not merely the watcher's
    // half.** An Undead Fortitude save thrown against an amount with no type
    // is reported by `resolveDamage` too, and this road used to drop it on the
    // floor while the DM's own door reported it.
    unverified: [
      ...resolved.value.unverified,
      ...sharedUnverified,
      ...triggered.unverified,
      ...raised.value.unverified,
    ],
  });
}

/** The tail a shared blow's source carries, so a share is never shared again. */
const SHARED_BY_HOLD = ', shared)';

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

  // **The events only, and the funnel's report is dropped here.** This returns
  // a bare list and has nowhere to put a sentence — the same shape, and the
  // same named gap, as `beginCombat`'s payouts. Nothing is lost today: the
  // backlash is typed, so Undead Fortitude is applied whole, and it names no
  // dealer, so `rewardsForDropping` pays nobody for a caster who overchannelled
  // themselves to death.
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
  /**
   * Clauses the funnel applied without being able to check them.
   *
   * The same report `resolveDamage` hands the DM's stated-amount door, on the
   * door beside it: this one names a kind, so SRD Undead Fortitude is applied
   * whole and says nothing — but a feature watching the creature fall still
   * needs a side the table has declared and a scene it has laid out, and a
   * brazier dropped by nobody's ally is as silent as one dropped by somebody's.
   */
  readonly unverified: readonly string[];
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
      unverified: [],
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
      unverified: hurt.value.unverified,
      duplicate: false,
    });
  });
}
