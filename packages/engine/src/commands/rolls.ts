/**
 * The rolls a command makes on a creature's behalf, and what they gather first.
 *
 * `savingSupport` is the reason this is a module: three separate domains roll
 * a saving throw — a casting's Concentration check, a D20 Test a DM calls for,
 * the save a turn boundary owes — and every one of them has to gather the same
 * three sources of bonus and mode before the die is thrown. One gatherer, or
 * three places for a stored Bless to be forgotten.
 */

import {
  type Ability,
  ABILITY_NAMES,
  type CharacterId,
  type ConditionName,
  err,
  ok,
  type Result,
  type RollMode,
  type Skill,
} from '@ie/shared';
import { type DamageComponent, rollAttackDamage } from '../attack.js';
import { type DieEffect, explodeOnMax, parseNotation, rerollDice } from '../dice.js';
import { type Bonus, bonusesFor, flatBonusTotal, type ModeSource } from '../bonuses.js';
import { type RecordedRoll } from '../rolls.js';
import { abilityModifier, type CharacterSheet } from '../character.js';
import { type D20TestResult, skillName } from '../checks.js';
import { type ConditionState, isIncapacitated } from '../conditions.js';
import { type EffectCheck } from '../timers.js';
import { type CreatureState, type GameEvent, type GameState } from '../events.js';
import { distanceBetween } from '../positioning.js';
import { consumedRollModifiers, type RollQuery } from '../roll-modifiers.js';
import { type DieRule, type SpellCheck } from '../spell-definitions.js';
import {
  areaBonuses,
  canSee,
  type CastingDamageFeature,
  effectiveConditions,
  electableCastingDamage,
  rollModesFor,
  sensesPerceiving,
  standingBonuses,
  standingCheckBonuses,
  standingSaveBonuses,
} from '../standing.js';
import { type Supply } from './casting.js';

/**
 * The `roll-modifier-consumed` events a roll owes, one per grant it used up.
 *
 * **Written once because four rollers say it**, and none of them did before
 * SRD Help: the flag was refused on every family but `attack`, because nothing
 * else spent one. Help hangs a one-shot Advantage on an **ability check** —
 * "that ally has Advantage on the next ability check they make with the chosen
 * skill" — so `resolveTest`, `resolveEffectCheck`, the escape check and the
 * three glossary actions spend one through this, and `oneShotProblem` narrowed
 * to the families that still do not.
 *
 * **The two attack rollers still spell the loop out and are not four and
 * five**, which is a fact about their queries rather than about the loop: one
 * gathers `sensesPerceiving` to spend exactly what it read, and the other
 * folds each event as it goes because a casting's resolver carries its state
 * forward. Either could take this helper the day its call site stops needing
 * the difference; neither is a second copy of the rule, which is
 * `consumedRollModifiers`.
 *
 * The caller passes the very query its `rollModesFor` call used, which is what
 * keeps "what was read" and "what was spent" from ever disagreeing:
 * `consumedRollModifiers` asks the same {@link selectorMatches} the gatherer
 * did.
 */
export function spentRollModifiers(state: GameState, query: RollQuery): GameEvent[] {
  return consumedRollModifiers(state, query).map((spent) => ({
    type: 'roll-modifier-consumed',
    id: spent.holder,
    source: spent.source,
  }));
}

/**
 * Turn a completed D20 test into the log's record of it.
 *
 * `roll-recorded` changes no state; it exists so the log can say why a number
 * was what it was. Every named contribution goes in, including ones that
 * subtracted, so a normal-looking total can still explain itself.
 *
 * **And every mode, with its source.** A contribution is a named *amount* and
 * Advantage is not one, so a ruling reached the returned result and nothing
 * else: the log showed a d20 at 17 and could not say that two were thrown for
 * it. The sources that cancelled are here too, because a roll that came out
 * `normal` from two opposite rulings is a different fact from a roll nobody
 * ruled on. Omitted entirely when nothing modified the roll, so a log that
 * carried no such field goes on not carrying one.
 */
export function recordD20Test(
  who: CharacterId,
  label: string,
  result: D20TestResult,
  outcome?: string,
): GameEvent {
  return {
    type: 'roll-recorded',
    who,
    label,
    natural: result.natural,
    total: result.total,
    ...(result.modeSources.length === 0 ? {} : { modes: result.modeSources }),
    // **And the throw this one replaced.** `D20TestResult.supersedes` is
    // filled two ways — by `rerollTest`, after a Reaction, and by the pipeline
    // itself for a rule that costs nothing — and this is the one place the
    // sixteen callers of this function funnel through, so both reach the log
    // by writing nothing here twice. Omitted when nothing was superseded, so
    // every log that carried no such field goes on not carrying one.
    ...(result.supersedes === undefined ? {} : { supersedes: result.supersedes }),
    contributions: [
      // What is left of the modifier once every named flat bonus inside it has
      // been named: the ability, the proficiency, and whatever else the sheet
      // contributed. The named ones follow, so the sum is unchanged and a +1
      // Longsword or an Aura of Protection reads as itself rather than as a
      // bigger number nobody can account for.
      { source: 'modifier', amount: result.modifier - flatBonusTotal(result.flatBonuses) },
      ...result.flatBonuses.map((bonus) => ({ source: bonus.source, amount: bonus.flat ?? 0 })),
      ...result.bonuses.map((bonus) => ({ source: bonus.source, amount: bonus.total })),
    ],
    ...(outcome === undefined ? {} : { outcome }),
  };
}

/**
 * Roll a spell's dice, with no weapon and no ability modifier attached.
 *
 * `rollAttackDamage` is the engine's one damage roller and it is built around
 * a weapon, so a spell borrows it with `weapon: null` and its own dice as
 * `extraDamage`, then keeps only its own components. The Unarmed Strike the
 * weaponless branch contributes is flat, so nothing is rolled for it and the
 * generator does not move — but it would be in the total, which is why the
 * filter is here rather than at each call site.
 */
/**
 * Fold a spell's printed flat addend into what its dice rolled.
 *
 * SRD prints two of these — Finger of Death's "7d8 + 30" and Disintegrate's
 * "10d6 + 40" — and the number is part of the damage rather than a separate
 * effect. `DiceScaling` carried it from the start and nothing on this path
 * read it, so both spells rolled their dice and silently dropped the addend.
 *
 * It lands once, on the first component, and it does **not** double on a
 * critical: "roll the attack's damage dice twice, add them together, and add
 * any relevant modifiers as normal."
 */
export function withFlatAddend(
  components: readonly DamageComponent[],
  addend: number,
): readonly DamageComponent[] {
  if (addend === 0 || components.length === 0) return components;
  const [first, ...rest] = components as readonly [DamageComponent, ...DamageComponent[]];
  return [{ ...first, flat: first.flat + addend, total: first.total + addend }, ...rest];
}

/**
 * What the caster's own features are doing to this casting's damage, gathered
 * once at the casting and read by every damage roll it makes.
 *
 * The four arms of `CastingDamageAlteration` collapsed into the four questions
 * a damage roll actually asks, because a roll site wants "what die, how much
 * flat, and is there a floor" rather than a list to walk. Gathered by
 * `castingDamageFeatures`; assembled by the casting command; `NO_ALTERATIONS`
 * is what every other run of an effect list carries.
 *
 * **`addend` is mutable on purpose**, which is the `events`/`outcomes`/`held`
 * rule of `EffectContext` applied to a number. SRD says "add your Charisma
 * modifier to **one damage roll** of that spell", and the only way one roll out
 * of several can take it is for the taking to be recorded somewhere both of
 * them can see. {@link takeCastingAddend} is the taking.
 */
export interface CastingAlterations {
  /** SRD Foe Slayer: a die replaced wherever this casting rolls that die. */
  die: { readonly from: number; readonly to: number } | null;
  /** SRD Overchannel: every die takes its highest face and nothing is thrown. */
  maximum: boolean;
  /** SRD Potent Cantrip: a miss and a made save still deal half. */
  halfWhenAvoided: boolean;
  /** Not yet taken by any roll of this casting. Zeroed by the first that does. */
  addend: number;
  /**
   * SRD Heightened Spell: a mode on the saves this casting forces on one named
   * creature, keyed by that creature.
   *
   * **Here rather than on the request the save site can no longer see**, and
   * beside the three features above for the same reason they are here: this is
   * the bag of what the caster's own election is doing to *this* casting, and
   * a save resolver already reads it for `halfWhenAvoided`. Empty for every
   * casting that bought no such option, which is all but one.
   */
  saveModes: Readonly<Record<string, { readonly mode: RollMode; readonly source: string }>>;
  /**
   * SRD Empowered Spell: how many of the next damage roll's dice go back in
   * the cup, lowest first, and what bought it.
   *
   * **Taken once**, exactly as {@link addend} is and for the same sentence —
   * the book says "when you roll damage for a spell", and a Fireball catching
   * six goblins rolls six times here. {@link takeCastingReroll} is the taking.
   */
  reroll: { readonly count: number; readonly source: string } | null;
  /**
   * SRD Seeking Spell: one missed spell attack of this casting thrown again,
   * and the price the miss then pays.
   *
   * Nulled by the throw that uses it, for {@link reroll}'s reason: the book
   * buys one reroll and a Scorching Ray misses five times.
   */
  rerollMissedAttack: {
    readonly source: string;
    readonly cost: { readonly key: string; readonly amount: number };
  } | null;
  /**
   * SRD Agonizing Blast: "add your Charisma modifier to that spell's **damage
   * rolls**" — so the addend above is not spent by the roll that takes it.
   *
   * A flag rather than a second addend, because the two are the same number
   * arriving from features that disagree only about how many rolls it reaches.
   * A casting reached by both adds both to every roll; the alternative is two
   * running totals and an ordering rule between them, for a pairing no SRD
   * character can currently hold — Agonizing Blast names a Warlock cantrip and
   * the two singular writers reach a Sorcerer's and a Wizard's spells.
   */
  addendEveryRoll: boolean;
}

/** What a casting with no such feature behind it carries. */
export const NO_ALTERATIONS = (): CastingAlterations => ({
  die: null,
  maximum: false,
  halfWhenAvoided: false,
  addend: 0,
  saveModes: {},
  reroll: null,
  rerollMissedAttack: null,
  addendEveryRoll: false,
});

/**
 * Take the "one damage roll" addend, once.
 *
 * Zero every time after the first, which is what makes SRD's *one* roll one
 * roll: a Fireball that catches six goblins rolls six times in this engine —
 * the definition's dice are thrown per target — and the modifier lands on the
 * first of them. That is a choice rather than a rule, made here rather than
 * buried, and it is the closest honest reading available: the SRD lets the
 * caster pick which roll, and the engine never picks between candidates when
 * the caller could say, so what it does instead is take the first and record
 * the number it added in the damage the log already carries.
 */
export function takeCastingAddend(alterations: CastingAlterations): number {
  const taken = alterations.addend;
  // SRD Agonizing Blast says "damage rolls", so there is nothing to spend: the
  // addend stands for every roll this casting makes. Every other writer of this
  // shape says "one damage roll", and for those the first roll takes it.
  if (!alterations.addendEveryRoll) alterations.addend = 0;
  return taken;
}

/**
 * Take the "when you roll damage" reroll, once.
 *
 * {@link takeCastingAddend} on the option beside it, written to the same
 * sentence and null every time after the first: SRD Empowered Spell buys one
 * damage roll's worth of rerolls and the engine's Fireball rolls once per
 * goblin, so the first roll of the casting takes it.
 */
export function takeCastingReroll(
  alterations: CastingAlterations,
): { readonly count: number; readonly source: string } | null {
  const taken = alterations.reroll;
  alterations.reroll = null;
  return taken;
}

/**
 * Throw the lowest dice of a casting's damage again, and use the new rolls.
 *
 * SRD Empowered Spell, applied across **every component of one damage roll**,
 * because "the damage dice" is the spell's damage and SRD Ice Knife's
 * Piercing and Cold are one roll of one spell. The dice are chosen from the
 * bottom — see the `reroll-damage-dice` arm for why a stated count is the
 * whole of the player's choice — and ties break on the order thrown, so a
 * replay picks the same dice.
 *
 * A die a keep clause already dropped is left alone: it is not damage this
 * roll is dealing, and `rerollDice` would keep it dropped anyway. The
 * component's total is recomputed off the roll it now holds, so the number
 * that reaches the target is the number the faces add up to.
 */
export function rerollLowestDamageDice(
  /**
   * The whole supply and not a bare generator, which is `rollSpellDice`'s
   * shape one function along and taken for its reason: a roller inside a
   * command is handed what a command holds, and the boundary sweep reads a
   * bare `Rng` on the engine's surface as a primitive a door might reach.
   */
  supply: Supply,
  components: readonly DamageComponent[],
  count: number,
  source: string,
): Result<readonly DamageComponent[]> {
  const candidates = components.flatMap((component, at) =>
    (component.roll?.dice ?? [])
      .filter((die) => die.disposition === 'counted')
      .map((die) => ({ at, index: die.index, value: die.value })),
  );
  if (candidates.length === 0 || count <= 0) return ok(components);

  const chosen = [...candidates]
    .sort((a, b) => a.value - b.value || a.at - b.at || a.index - b.index)
    .slice(0, count);

  const out = [...components];
  for (const at of new Set(chosen.map((one) => one.at))) {
    const component = out[at]!;
    const thrown = rerollDice(
      supply.rng,
      component.roll!,
      chosen.filter((one) => one.at === at).map((one) => one.index),
      source,
    );
    if (!thrown.ok) return thrown;
    // The provenance is the one the engine stamped on this component's throw
    // and the rerolled dice are inside it, so the log has one roll with every
    // face it ever showed rather than two rolls a reader has to join up — and
    // the stamp cannot be laundered on the way through, which is what
    // `checkExternalSource` is for.
    const roll: RecordedRoll = { ...thrown.value, provenance: component.roll!.provenance };
    // The **difference** the new faces made, rather than a second derivation
    // of what a component's total is made of: `withFlatAddend` may already
    // have put a printed addend on this component, and re-deriving would drop
    // it.
    out[at] = { ...component, roll, total: component.total + roll.total - component.roll!.total };
  }
  return ok(out);
}

/**
 * The features the caster elected on this casting, or a refusal naming one they
 * have not got.
 *
 * **Refused when the creature does not hold it, accepted when it simply does
 * not reach.** A caller who names a feature this caster has no claim to has
 * made a mistake worth reporting; a caller who elects Overchannel and then
 * casts a cantrip has done something the rules allow, because a grant's `when`
 * is a narrowing and casting outside one is legal. Refusing the second would be
 * the engine inventing a rule, and it would make every optional feature a thing
 * the caller had to re-decide per spell.
 */
export function electedFeatures(
  state: GameState,
  who: CharacterId,
  named: readonly string[] | undefined,
): Result<readonly string[]> {
  if (named === undefined || named.length === 0) return ok([]);
  const held = electableCastingDamage(state, who);
  const stranger = named.find((feature) => !held.includes(feature));
  if (stranger !== undefined) {
    return err(
      'no_such_feature',
      `${who} has no feature ${stranger} that this casting could use`,
    );
  }
  return ok(named);
}

/**
 * The features reaching this casting, as the four questions a damage roll asks.
 *
 * Every arm collapses here and the ability modifier is read **now**, off the
 * sheet as it stands, for the reason every other number a casting makes is: it
 * is the caster's modifier at the moment they cast, and a Headband of Intellect
 * moves it exactly as it moves the save DC.
 *
 * Two features adding a modifier to one casting both land, and both land on the
 * same roll — a Sorcerer/Wizard casting a Fire Evocation as a Wizard is reached
 * by Elemental Affinity and Empowered Evocation at once, and each says "one
 * damage roll of that spell" without saying it must be a different one.
 */
export function castingAlterations(
  features: readonly CastingDamageFeature[],
  sheet: CharacterSheet,
): CastingAlterations {
  const alterations = NO_ALTERATIONS();
  for (const feature of features) {
    const alters = feature.alters;
    switch (alters.kind) {
      case 'ability-modifier':
        alterations.addend += abilityModifier(sheet.abilities[alters.ability]);
        // SRD Agonizing Blast's plural — see {@link CastingAlterations}.
        if (alters.everyRoll === true) alterations.addendEveryRoll = true;
        break;
      case 'die':
        // The first wins, and no SRD feature writes a second: a die substituted
        // twice would be two features disagreeing about one notation, which is
        // a rules dispute rather than arithmetic.
        if (alterations.die === null) alterations.die = { from: alters.from, to: alters.to };
        break;
      case 'half-when-avoided':
        alterations.halfWhenAvoided = true;
        break;
      case 'maximum':
        alterations.maximum = true;
        break;
    }
  }
  return alterations;
}

/**
 * A casting's damage notation as its caster's features leave it, and whatever
 * they turn into a flat number.
 *
 * Two of the four alterations are about the dice and this is where both of them
 * happen, before anything is thrown:
 *
 * - **`die`** substitutes the face count and leaves the rest alone, so SRD Foe
 *   Slayer's `1d6` becomes `1d10` and a notation rolling anything else is
 *   untouched.
 * - **`maximum`** throws nothing at all: the notation goes away and its highest
 *   possible total comes back as a flat number. The generator does not move,
 *   which is why a maximised casting replays without a die.
 *
 * `doubled` is the Critical Hit, and it matters only to `maximum`: the SRD
 * doubles the dice and this maximises whatever dice end up being rolled, so a
 * critical maximises twice as many of them. For `die` it is irrelevant, because
 * `rollAttackDamage` does its own doubling over whatever notation it is given.
 */
export function alteredCastingDice(
  alterations: CastingAlterations,
  dice: string | undefined,
  doubled = false,
): Result<{ readonly dice?: string; readonly flat: number }> {
  if (dice === undefined) return ok({ flat: 0 });

  let notation = dice;
  if (alterations.die !== null) {
    const parsed = parseNotation(notation);
    if (!parsed.ok) return parsed;
    if (parsed.value.sides === alterations.die.from) {
      notation = `${parsed.value.count}d${alterations.die.to}`;
    }
  }

  if (!alterations.maximum) return ok({ dice: notation, flat: 0 });

  const parsed = parseNotation(notation);
  if (!parsed.ok) return parsed;
  const count = doubled ? parsed.value.count * 2 : parsed.value.count;
  return ok({ flat: count * parsed.value.sides });
}

/**
 * A spell's declared die rule, as the per-die effects the generator takes.
 *
 * **The declaration names a derivation and this is where it is derived.** SRD
 * Sorcerous Burst caps its extra d8s at "your spellcasting ability modifier",
 * which is a fact about the caster rather than about the spell, so the
 * catalogue says *which* number it wants and the engine reads it off the
 * numbers the casting pinned. A definition stating a literal would be content
 * answering a question only the sheet can — the mistake inviolable rule 4
 * exists to prevent, arriving on a cap instead of on an id.
 *
 * A modifier of zero or less caps the rule at nothing, which is the arithmetic
 * and not a special case: a Sorcerer with a Charisma of 10 adds no dice.
 *
 * Absent rule, empty list, and the roll is thrown exactly as it was before this
 * field existed — which is what keeps every log written until now folding
 * unchanged.
 */
export function declaredDieEffects(
  rule: DieRule | undefined,
  spellcastingModifier: number,
  name: string,
): readonly DieEffect[] {
  if (rule === undefined) return [];
  switch (rule.kind) {
    case 'bonus-die-on-max':
      return [explodeOnMax(Math.max(0, capOf(rule.cap, spellcastingModifier)), name)];
  }
}

/** The one derivation a {@link DieRule} cap names — see `DieRuleCap`. */
function capOf(cap: DieRule['cap'], spellcastingModifier: number): number {
  switch (cap) {
    case 'spellcasting-modifier':
      return spellcastingModifier;
  }
}

/**
 * A pinned notation as the caster's features leave it.
 *
 * The half of {@link alteredCastingDice} that reaches a die nobody is throwing
 * yet — SRD Hunter's Mark's rider, written into `attack-rider-granted` at the
 * casting and rolled by every later attack. Only the substitution reaches here:
 * a maximisation is about what this casting deals "on the turn you cast it",
 * and a rider is by definition every turn after.
 */
export function alteredRiderDice(
  alterations: CastingAlterations,
  dice: string,
): Result<string> {
  if (alterations.die === null) return ok(dice);
  const parsed = parseNotation(dice);
  if (!parsed.ok) return parsed;
  return ok(
    parsed.value.sides === alterations.die.from
      ? `${parsed.value.count}d${alterations.die.to}`
      : dice,
  );
}

/**
 * **`dice` may be absent, and then nothing is thrown.** An amount the content
 * prints as a flat number — Potion of Heroism's ten Temporary Hit Points —
 * has no notation, and `rollAttackDamage` already answers a dice-free extra
 * with a component whose roll is null: no die, no roll id, and a generator
 * that has not moved. The component still comes back, carrying zero, because
 * `withFlatAddend` lands the printed number on the *first* component and an
 * empty list would drop it.
 *
 * **The weaponless component is dropped by position rather than by name.**
 * `rollAttackDamage` always contributes the Unarmed Strike first and the one
 * extra second, so the two readings agree for every caller whose `source` is
 * a spell's name — and they stop agreeing the moment a caller's source is
 * free text, which `rollImprovisedDamage` made true: a DM ruling spelled
 * "Unarmed Strike" would have kept a component carrying a stranger's
 * Strength modifier.
 */
export function rollSpellDice(
  supply: Supply,
  sheet: CharacterSheet,
  source: string,
  type: string,
  dice: string | undefined,
  effects: readonly DieEffect[] = [],
): Result<readonly DamageComponent[]> {
  const rolled = rollAttackDamage(
    supply.issuer,
    supply.rng,
    sheet,
    {
      weapon: null,
      targetAc: 0,
      extraDamage: [
        {
          source,
          type,
          ...(dice === undefined ? {} : { dice }),
          // On the component rather than on the whole roll, which costs nothing
          // here — there is one component — and keeps one reading of where a
          // spell's declared rule lives across every site that rolls one.
          ...(effects.length === 0 ? {} : { effects }),
        },
      ],
    },
    false,
  );
  if (!rolled.ok) return rolled;
  return ok(rolled.value.components.slice(1));
}

/**
 * The modes standing on a roll and the modes a caller supplied, as one list.
 *
 * **A `ModeSource`'s source is an identity**, and this is the one place that
 * is decided. Two things named the same are one thing: a caller who also
 * knows about Danger Sense does not apply it twice, and a source that
 * contradicts itself is a contradiction rather than a cancellation, so the
 * later word wins — the same ruling `rollModifierKey` states for a casting
 * that grants Advantage and then Disadvantage on the same rolls.
 *
 * **It exists because the two branches of one command disagreed about that.**
 * `resolveTest`'s saving throw merged through {@link savingSupport} and its
 * ability check concatenated, so a `source` was an identity on one kind of
 * D20 Test and a label on the other. That produced a real bug — two rulings a
 * DM spelled alike collapsed into one on the save, which then rolled at
 * Disadvantage while reporting a single ruling — and it was fixed at the
 * caller, which protects one caller. One gatherer is the fix at the seam.
 *
 * A bare `RollMode` has no source to key on, so it rides through as given and
 * ahead of the named ones; `checks.ts` gives it the name `situational`. The
 * named keep insertion order, which is what puts what the world already had
 * before what the caller has just said.
 */
export function mergedModes(
  standing: readonly (RollMode | ModeSource)[],
  supplied: readonly (RollMode | ModeSource)[],
): readonly (RollMode | ModeSource)[] {
  const named = new Map<string, ModeSource>();
  const bare: RollMode[] = [];
  for (const mode of [...standing, ...supplied]) {
    if (typeof mode === 'string') bare.push(mode);
    else named.set(mode.source, mode);
  }
  return [...bare, ...named.values()];
}

/**
 * Everything that applies to a creature's saving throw, gathered in one place.
 *
 * Same rule as Alert on Initiative: a modifier somebody has to remember is a
 * modifier a character silently stops having. Three sources, and they arrive
 * by three different routes:
 *
 * - **Stored** on the creature, by a spell that hung it there — Bless, Bane.
 * - **Standing**, from a class feature, derived from the state of the world at
 *   this instant — Aura of Protection, Danger Sense. Nothing stores these,
 *   because whether they apply changes when somebody walks away.
 * - **Supplied** by the caller, for whatever the engine cannot see.
 *
 * Deduplicated by source, so a helpful caller passing Bless as well does not
 * apply it twice. The conditions come back too: a feature can say a condition
 * has no effect on this creature right now, and every roll that reads
 * conditions has to read that instead.
 *
 * **And what the save is *about*, where the caller knows.** SRD Fey Ancestry
 * grants Advantage "on saving throws you make to avoid or end the Charmed
 * condition", and a gatherer that could not be told which save this is would
 * hand an elf that Advantage on every Wisdom save she ever made. Only the
 * caller knows: a casting's resolver reads its own condition riders, and the
 * turn boundary reads the timer whose condition its repeat would end. A caller
 * with none says nothing, and a condition-keyed selector reads that as a miss
 * rather than a guess — which is every Concentration check, every
 * Counterspell save and every save a DM simply calls for.
 *
 * **And whether it is a save against magic**, for the same reason and read the
 * same way. SRD Magic Resistance grants Advantage "on saving throws against
 * spells and other magical effects", and only the caller knows which kind of
 * save this is: a spell's own resolver says yes outright, the turn boundary
 * asks whether the effect its repeat would end came from a casting, and a
 * printed stat-block line says nothing, because a dragon's breath is not a
 * spell. Silence is a miss — see {@link RollQuery.magical}.
 */
export function savingSupport(
  state: GameState,
  who: CharacterId,
  victim: CreatureState,
  ability: Ability,
  supply: {
    readonly bonuses?: readonly Bonus[] | undefined;
    readonly modes?: readonly (RollMode | ModeSource)[] | undefined;
  },
  /** The conditions this save would avoid or end, where it is about any. */
  about?: readonly ConditionName[],
  /** Whether a spell or other magical effect forced it. Silence is "no". */
  magical?: boolean,
  /**
   * Whether this is the save made to **maintain Concentration**. Silence is
   * "no", for the reason the two answers above take silence that way: SRD
   * Eldritch Mind and War Caster name one save out of every Constitution save
   * their holder makes, and a gatherer that guessed would hand a Warlock
   * Advantage on every one of them.
   */
  concentration?: boolean,
): {
  readonly bonuses: readonly Bonus[];
  readonly modes: readonly (RollMode | ModeSource)[];
  readonly conditions: ConditionState;
} {
  const merged = new Map<string, Bonus>();
  // The ability the save is made with, so a penalty the SRD narrows to one
  // ability's saves reaches those and no others: Slow's "a −2 penalty to AC
  // and **Dexterity** saving throws" would otherwise land on the Wisdom save
  // the spell itself calls for at the end of every turn.
  for (const bonus of bonusesFor(victim.bonuses, 'save', { ability })) {
    merged.set(bonus.source, bonus);
  }
  for (const bonus of standingSaveBonuses(state, who, ability)) merged.set(bonus.source, bonus);
  // And the flat half: a Ring of Protection's "+1 bonus to ... saving throws".
  // No narrowing is offered because a saving throw is not made *with* anything,
  // which is the pairing `checkContent` refuses outright.
  for (const bonus of standingBonuses(state, who, 'save')) merged.set(bonus.source, bonus);
  for (const bonus of supply.bonuses ?? []) merged.set(bonus.source, bonus);

  // A bare RollMode has no source to deduplicate on, so it rides through as
  // given; a ModeSource is keyed, which is what stops a caller who also knows
  // about Danger Sense applying it twice. {@link mergedModes} is that rule,
  // and it is a function rather than a block here because the ability check
  // needs the same one.
  return {
    bonuses: [...merged.values()],
    modes: mergedModes(
      rollModesFor(state, {
        family: 'saving-throw',
        roller: who,
        ability,
        // Passed through exactly as the caller answered, empty included — the
        // rule `rollerPerceives` follows on an attack. Absent is "nobody
        // asked" and an empty list is "asked, and this save is about no
        // condition at all", which SRD Slow's failure really is: three grants
        // and nothing imposed. Both read as a miss on a condition-keyed
        // selector, and collapsing one into the other here would make that
        // agreement a coincidence rather than a rule.
        ...(about === undefined ? {} : { aboutConditions: about }),
        // Passed through exactly as the caller answered, for the reason the
        // conditions above are: an unkeyed save is not SRD Magic Resistance's
        // sentence, and a gatherer that guessed would hand a devil Advantage
        // on every save it ever makes.
        ...(magical === undefined ? {} : { magical }),
        // And which save this is, passed through the same way: one caller says
        // yes — the Concentration save a blow forces — and every other save
        // says nothing, which a Concentration-keyed selector reads as a miss.
        ...(concentration === undefined ? {} : { concentration }),
      }).modes,
      supply.modes ?? [],
    ),
    conditions: effectiveConditions(state, who),
  };
}

/**
 * The flat bonuses standing on a creature that reach an ability check.
 *
 * {@link savingSupport}'s thin counterpart, and thin for a reason: a saving
 * throw has one command behind it and an ability check has four, each
 * gathering its own modes from its own question. What they all lacked was the
 * *bonuses* — a Stone of Good Luck's "+1 bonus to ability checks" reached none
 * of them — so this is the one place that answer is worked out, rather than
 * four places that could come to disagree.
 *
 * Deduplicated by source and the caller's copy wins, exactly as
 * {@link savingSupport} merges, so a DM who also knows about the stone does not
 * apply it twice.
 *
 * Initiative is one of the four: SRD makes it an ability check, which is why
 * "a magic item's bonus applies" to it and why `rollInitiativeFor` asks here.
 *
 * No narrowing is offered *by an item*. An ability check is not made *with* an
 * object the way an attack is — the SRD's tool bonuses are worded as the
 * character's, not the tool's — and `checkContent` refuses the pairing
 * outright.
 *
 * **The skill is a narrowing of the other kind**, and it is the feature's: SRD
 * Divine Order and Primal Order bonus two named skills each, so a gatherer that
 * could not be told which check this is would hand a Cleric their Arcana bonus
 * on a Stealth check. A caller that has no skill — Initiative, an effect's bare
 * ability check — asks for none and gets only the bonuses that name no skill
 * either, which is the conservative direction.
 */
export function checkBonuses(
  state: GameState,
  who: CharacterId,
  supplied: readonly Bonus[] | undefined,
  skill?: Skill,
): readonly Bonus[] {
  // **And the bonuses a running spell hung on the creature**, which reached no
  // ability check at all until a spell was narrow enough to want one: nothing
  // called `bonusesFor(bonuses, 'ability-check')` anywhere, so a `buff` aimed
  // at the family landed in state and was read by nobody. SRD Guidance is what
  // notices — "the creature adds 1d4 to any ability check using the chosen
  // skill" — and it wants both halves of this function at once: the gatherer,
  // and the skill it is narrowed to.
  //
  // The skill is passed on rather than filtered here, because withholding is
  // `bonusesFor`'s rule and one reading of it is what keeps the ongoing and
  // the standing halves answering the same way.
  // **And what an area the creature is standing in is doing to its checks**,
  // which is the third gatherer and the one whose answer changes when anybody
  // walks. SRD Pass without Trace's "+10 bonus to Dexterity (Stealth) checks"
  // holds "while in the aura", so it is derived from the scene on every read
  // and joins here rather than being hung on the creature — see
  // `areaBonuses`.
  const held = state.creatures[who]?.bonuses ?? [];
  const standing = [
    ...bonusesFor(held, 'ability-check', skill === undefined ? undefined : { skill }),
    ...standingBonuses(state, who, 'ability-check'),
    ...(skill === undefined ? [] : standingCheckBonuses(state, who, skill)),
    ...areaBonuses(state, who, 'ability-check', skill === undefined ? undefined : { skill }),
  ];
  if (standing.length === 0) return supplied ?? [];

  const merged = new Map<string, Bonus>();
  for (const bonus of standing) merged.set(bonus.source, bonus);
  for (const bonus of supplied ?? []) merged.set(bonus.source, bonus);
  return [...merged.values()];
}

/**
 * Every standing mode that reaches an attack roll, gathered from both ends.
 *
 * **SRD Dodge says "any attack roll made against you"; it does not say "with a
 * weapon."** Blur writes the same sentence. `resolveAttack` read the
 * defender's standing effects and the spell attack inside `resolveEffects`
 * read nothing about the defender at all, so a **Dodging creature was easier
 * to hit with a Fire Bolt than with a club** — silently, because each path was
 * correct on its own terms.
 *
 * One gatherer for both, because two copies of this block is exactly how that
 * fork came about, and splitting the command layer by domain put the copies in
 * different modules — where neither author would see the other.
 *
 * The sight clause is the **target's** view of the attacker, not the
 * attacker's of the target, and a scene nobody has set is `null` rather than
 * `false`: undeclared is not the same as blind.
 *
 * **So the senses read are the target's**, which is the one place in the
 * engine where the looker runs against the direction of the action: Dodge's
 * "if *you* can see the attacker" is spoken by the creature being rolled
 * against, and the attacker's own Darkvision has nothing to say about it.
 * `rollModesFor` calls this the *holder's* view, and the holder is the
 * target for every `ifSeen` grant that exists — all of them select
 * `against-holder`, because the clause is only ever written on the defending
 * side. A grant that held `ifSeen` on the roller would need its own answer
 * rather than this one, and there is nowhere in the engine to write one.
 */
export function defendingModes(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
  /**
   * The ability this swing is being made with, where the caller has settled
   * one.
   *
   * SRD Reckless Attack grants Advantage on "attack rolls using Strength", so
   * a gatherer that could not say which ability the swing used handed the
   * benefit to every swing its holder made. It is the *settled* answer —
   * `attackAbility`, past Finesse's choice and a style's offer — and a caller
   * with none says so rather than guessing, which an ability-keyed selector
   * reads as a miss.
   */
  ability?: Ability | null,
  /**
   * What a **spell's** attack roll knows about itself and a weapon's does not:
   * that a spell made it, and which class the casting was made through.
   *
   * SRD Innate Sorcery: "You have Advantage on the attack rolls of Sorcerer
   * spells you cast." Only the spell attack site can answer either half —
   * `resolveAttack` passes nothing, which is what makes a club not a spell —
   * and `castThrough` is read off the casting's own route, absent for a feat's
   * granted route, a stat block's declaration and an item's.
   */
  spell?: { readonly through?: string },
): { readonly modes: readonly ModeSource[]; readonly unverified: readonly string[] } {
  return rollModesFor(
    state,
    {
      family: 'attack',
      roller: attacker,
      against: target,
      ...(ability === undefined || ability === null ? {} : { ability }),
      ...(spell === undefined ? {} : { spellAttack: true as const }),
      ...(spell?.through === undefined ? {} : { castThrough: spell.through }),
      // SRD Blur: "An attacker is immune to this effect if it perceives you
      // with Blindsight or Truesight." The **attacker's** senses, read at the
      // one roll that has two participants, so a selector on the defender can
      // be switched off by what the creature rolling can perceive.
      //
      // `sensesPerceiving`, and deliberately neither `canSee` nor
      // `canSomehowSee`: both of those answer a sentence about *seeing* and
      // put the table's declaration first, and ordinary sight is precisely
      // what Blur defeats. The declared line above is Dodge's clause and
      // rightly keeps its own reader; this is a different question about the
      // same pair, asked from the other end.
      rollerPerceives: sensesPerceiving(state, attacker, target),
      // And whether the roller can *see* the defender — SRD Faerie Fire's
      // gate — which is the ordinary sight question, declaration first.
      rollerSees: canSee(state, attacker, target),
    },
    { seenByHolder: canSee(state, target, attacker) },
  );
}

/**
 * SRD "Ranged Attacks": "You have Disadvantage on the attack roll if you are
 * within 5 feet of an enemy who can see you and who isn't Incapacitated."
 *
 * Four conditions, and the function is the four of them in order. "Enemy" is
 * the declared side, the same fact an aura reads for "ally"; a creature nobody
 * has placed on a side is nobody's enemy either, so it hampers nothing and
 * says so rather than applying the rule silently.
 *
 * Sight is the target-of-the-rule's view of the attacker — *can the enemy see
 * you* — and it is three-valued: a creature **declared** unable to see the
 * attacker is out of the sentence, and one nobody has mentioned is left in it,
 * because undeclared is not blind.
 *
 * **It lives beside `defendingModes` for the same reason that does.** A spell
 * attack is a ranged attack when the spell says so, and the weapon attack's
 * copy of this walk was in a module the caster's path could not reach without
 * a cycle. One gatherer, or two spellings of one sentence drifting apart.
 */
export function enemyWithinFiveFeet(
  state: GameState,
  id: CharacterId,
): { readonly near: boolean; readonly unverified: readonly string[] } {
  const scene = state.scene;
  const mine = state.creatures[id]?.side ?? null;
  if (scene === null) return { near: false, unverified: [] };

  let near = false;
  const unsided: CharacterId[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const other = state.creatures[key];
    if (other === undefined || other.id === id) continue;
    if (isIncapacitated(other.conditions) || other.vitals.dead) continue;
    // "…who can see you." Declared blindness is a fact and excuses the
    // attacker; an undeclared sight line is not, and leaves the rule standing.
    //
    // The **enemy's** senses, because the enemy is who must see — and they
    // cannot change this answer, which is worth saying rather than leaving a
    // reader to wonder. A sense only ever turns "nobody has said" into yes,
    // and the only value that excuses the attacker here is a declared no. It
    // is threaded through anyway so that the looker is named at every call
    // and a later rule that wants to tell null from true already has it.
    if (canSee(state, other.id, id) === false) continue;

    const apart = distanceBetween(scene, id, other.id);
    if (!apart.ok || apart.value > 5) continue;

    // Declared and allied: the rule does not apply, and nothing is missing.
    if (mine !== null && other.side === mine) continue;
    // Declared and opposed: the rule applies.
    if (mine !== null && other.side !== null) {
      near = true;
      continue;
    }
    // Nobody has said. Withholding is the conservative direction and it was
    // also **silent** — a creature standing at the archer's elbow either is or
    // is not an enemy, and an unfired rule looks exactly like a rule that
    // checked and found nothing.
    unsided.push(other.id);
  }

  return {
    near,
    unverified:
      unsided.length === 0
        ? []
        : [
            `nobody has said whose side ${unsided.join(', ')} ${unsided.length === 1 ? 'is' : 'are'} on, so the Disadvantage a ranged attack takes with an enemy within 5 feet was not applied`,
          ],
  };
}

/**
 * Whether an ally of the attacker is standing within 5 feet of their target,
 * and able to act.
 *
 * SRD Pack Tactics: "…if at least one of the wolf's allies is within 5 feet of
 * the creature and the ally doesn't have the Incapacitated condition."
 *
 * **The mirror of `enemyWithinFiveFeet`, and deliberately beside it.** The
 * same three facts decide both — a declared side, a measured distance, a
 * creature able to act — and two spellings of that walk in two modules is
 * exactly how the ranged-attack rule and the spell-attack rule came to
 * disagree. Where it differs it differs because the sentences do:
 *
 * - it measures from the **target** rather than from the roller;
 * - it wants allies rather than enemies;
 * - it asks nothing about sight, because Pack Tactics does not — the ranged
 *   rule's "who can see you" has no counterpart in "at least one of its
 *   allies is within 5 feet";
 * - and it falls silent once it has found an ally, because the withholding it
 *   reports is a rule that went **unapplied**, and a rule that has already
 *   fired went nowhere unapplied.
 *
 * "Ally" is the declared side, the same fact an aura reads. A creature nobody
 * has put on a side is nobody's ally, so it grants nothing and says so — an
 * undeclared side is a missing fact, and a rule that quietly resolved it
 * either way would be deciding one.
 *
 * The attacker is not their own ally: SRD says "one of its allies", and a
 * creature standing next to the thing it is biting is the ordinary case rather
 * than a pack.
 */
export function allyWithinFiveFeetOf(
  state: GameState,
  attacker: CharacterId,
  target: CharacterId,
): { readonly near: boolean; readonly unverified: readonly string[] } {
  const scene = state.scene;
  if (scene === null) return { near: false, unverified: [] };

  const mine = state.creatures[attacker]?.side ?? null;
  let near = false;
  const unsided: CharacterId[] = [];

  for (const key of Object.keys(state.creatures).sort()) {
    const other = state.creatures[key];
    if (other === undefined || other.id === attacker || other.id === target) continue;
    // "…and the ally doesn't have the Incapacitated condition." A dead one
    // helps nobody either, and for the same reason.
    if (isIncapacitated(other.conditions) || other.vitals.dead) continue;

    const apart = distanceBetween(scene, target, other.id);
    if (!apart.ok || apart.value > 5) continue;

    if (mine !== null && other.side === mine) {
      near = true;
      continue;
    }
    if (mine !== null && other.side !== null) continue;
    unsided.push(other.id);
  }

  return {
    near,
    unverified:
      near || unsided.length === 0
        ? []
        : [
            `nobody has said whose side ${unsided.join(', ')} ${unsided.length === 1 ? 'is' : 'are'} on, so the Advantage a creature takes while an ally of its own stands over its target was not applied`,
          ],
  };
}

/**
 * Turn a definition's check into the one the timer will carry.
 *
 * The DC is the caster's spell save DC unless the SRD prints a number, and the
 * label is derived rather than transcribed so that thirty definitions cannot
 * disagree about how a roll reads in the log.
 */
export function effectCheckFrom(
  check: SpellCheck | undefined,
  spell: string,
  saveDc: number,
): EffectCheck | undefined {
  if (check === undefined) return undefined;
  return {
    ability: check.ability,
    ...(check.skill === undefined ? {} : { skill: check.skill }),
    dc: check.dc ?? saveDc,
    onSuccess: check.onSuccess,
    label: `${ABILITY_NAMES[check.ability]}${check.skill === undefined ? '' : ` (${skillName(check.skill)})`} check vs ${spell}`,
  };
}

