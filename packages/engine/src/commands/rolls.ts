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
  ok,
  type Result,
  type RollMode,
} from '@ie/shared';
import { type DamageComponent, rollAttackDamage } from '../attack.js';
import { type Bonus, bonusesFor, flatBonusTotal, type ModeSource } from '../bonuses.js';
import { type CharacterSheet } from '../character.js';
import { type D20TestResult, skillName } from '../checks.js';
import { type ConditionState, isIncapacitated } from '../conditions.js';
import { type EffectCheck } from '../timers.js';
import { type CreatureState, type GameEvent, type GameState } from '../events.js';
import { distanceBetween } from '../positioning.js';
import { type SpellCheck } from '../spell-definitions.js';
import {
  canSee,
  effectiveConditions,
  rollModesFor,
  standingBonuses,
  standingSaveBonuses,
} from '../standing.js';
import { type Supply } from './casting.js';

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
): Result<readonly DamageComponent[]> {
  const rolled = rollAttackDamage(
    supply.issuer,
    supply.rng,
    sheet,
    {
      weapon: null,
      targetAc: 0,
      extraDamage: [{ source, type, ...(dice === undefined ? {} : { dice }) }],
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
): {
  readonly bonuses: readonly Bonus[];
  readonly modes: readonly (RollMode | ModeSource)[];
  readonly conditions: ConditionState;
} {
  const merged = new Map<string, Bonus>();
  for (const bonus of bonusesFor(victim.bonuses, 'save')) merged.set(bonus.source, bonus);
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
      rollModesFor(state, { family: 'saving-throw', roller: who, ability }).modes,
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
 * No narrowing is offered. An ability check is not made *with* an object the
 * way an attack is — the SRD's tool bonuses are worded as the character's, not
 * the tool's — and `checkContent` refuses the pairing outright.
 */
export function checkBonuses(
  state: GameState,
  who: CharacterId,
  supplied: readonly Bonus[] | undefined,
): readonly Bonus[] {
  const standing = standingBonuses(state, who, 'ability-check');
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
): { readonly modes: readonly ModeSource[]; readonly unverified: readonly string[] } {
  return rollModesFor(
    state,
    { family: 'attack', roller: attacker, against: target },
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

