import { type Ability, ok, type Result, type RollMode, type Skill } from '@ie/shared';
import type { Rng } from './dice.js';
import { parseNotation } from './dice.js';
import { rollRecorded, type RecordedRoll, type RollIssuer } from './rolls.js';

/**
 * Named modifiers shared by every D20 Test.
 *
 * This lives in its own module because both `checks.ts` and `attack.ts` need
 * it, and `attack.ts` already imports `checks.ts`.
 */

/**
 * A named modifier to a roll.
 *
 * The `source` is carried all the way through to the result so a log can say
 * *why* a number was what it was — "Guidance", "+1 Longsword", "Archery" —
 * rather than presenting an unexplained total.
 *
 * Most modifiers are flat, but several are dice: Guidance adds 1d4 to an
 * ability check, Bless adds 1d4 to an attack roll, Bardic Inspiration adds a
 * die that grows with level. A bonus may carry either or both.
 */
export interface Bonus {
  readonly source: string;
  readonly flat?: number;
  /** Dice notation, e.g. `1d4` for Guidance. */
  readonly dice?: string;
  /**
   * Which way the rolled dice push. Adding, unless stated.
   *
   * Bane is Bless with a minus sign — "the target must subtract 1d4 from the
   * attack roll or save" — and the sign belongs here rather than in the
   * notation, because `-1d4` is not dice notation and teaching the parser to
   * read it would make every other consumer handle negative dice counts.
   * A flat bonus needs no such flag: it can simply be negative.
   */
  readonly direction?: 'add' | 'subtract';
}

/**
 * What a lasting bonus applies to.
 *
 * The first three are rolls. `ac` is not — it is a number the rules compare a
 * roll *against* — and it is here rather than in its own mechanism because the
 * SRD writes it in the same breath: Shield of Faith's "+2 bonus to AC" and
 * Bless's "+1d4 to the attack roll" are one sentence shape with two targets.
 *
 * Only the flat half of a bonus reaches an Armour Class. No SRD spell grants a
 * rolled one, and a d4 of AC has no moment at which it could be rolled: an
 * Armour Class is a standing number that many attacks are measured against,
 * not an event.
 */
export type BonusApplies = 'attack' | 'save' | 'ability-check' | 'ac';

/**
 * What a *standing* flat bonus applies to: everything above, and damage.
 *
 * **Damage is on this side only, and that is a fact about the two lifetimes
 * rather than an oversight.** A spell that adds damage adds it as a rider or
 * as `extraDamage` on the casting that deals it — there is a moment, a source
 * and a type — so `bonusesFor` has never had a damage reader and a member
 * here would be data nothing applies. A magic weapon has no such moment: "a
 * bonus to attack rolls **and damage rolls** made with this magic weapon" is
 * one sentence with two halves, derived on every swing, and splitting it
 * across two grant kinds would let an item carry half of a line the SRD never
 * writes by halves.
 *
 * Widening `BonusApplies` itself would put an unread member in the spell
 * vocabulary, which is the failure the content validator exists to prevent.
 *
 * **`attack` is narrower on this side than on the other, and the difference is
 * a named missing shape rather than a decision.** A spell's `ActiveBonus`
 * aimed at `attack` reaches a spell attack roll as well as a weapon one; a
 * standing bonus aimed at it reaches the weapon attack alone, because that is
 * the only attack path that gathers one. Closing the gap by wiring it into
 * `resolveEffects` would be the *wrong* fix, because every SRD item that
 * bonuses a spell attack bonuses **only** that — Rod of the Pact Keeper's "+1
 * bonus to spell attack rolls and to the saving throw DCs", Staff of Power's
 * "+2 bonus to Armor Class, saving throws, and spell attack rolls" — so the
 * member they want is `spell-attack`, beside this one and not inside it. It is
 * named here (`a-bonus-to-spell-attack-rolls`) so that whoever transcribes
 * those items finds the gap before writing `attack` and getting a weapon bonus
 * they did not mean.
 */
export type StandingBonusApplies = BonusApplies | 'damage';

/**
 * Which of the rolls a bonus applies to it actually reaches.
 *
 * **Beside {@link BonusApplies} rather than inside it**, and the docstring
 * above is the argument: a member of that type says *what a bonus applies to*
 * — a family of roll, or the one standing number the SRD writes in the same
 * breath — and a skill is not one of those. `ability-check` and `skill` are
 * not alternatives; a skill check **is** an ability check, so a member spelled
 * `skill` would have to be read as "an ability check, but". Widening the type
 * is also the specific failure its docstring names: every member has to be
 * read by `bonusesFor`, and a narrowing read as a family would either reach
 * every check or none.
 *
 * So it is the shape {@link RollSelector} already uses for a *mode*, where the
 * family is `roll` and the narrowings sit beside it as filters that may both
 * be absent. Two engine facts say the same thing from the other end:
 * `standingCheckBonuses` is a **sibling gatherer** of `standingBonuses` rather
 * than a member of `StandingBonusApplies`, and `checkBonuses` already takes a
 * skill as an argument rather than reading one off a grant.
 *
 * Both filters **narrow**: absent means the whole family, and a bonus that
 * names one is withheld from a roll that does not match. A caller with no
 * skill to name — Initiative, a bare ability check — gets only the bonuses
 * that name none either, which is `checkBonuses`' conservative direction and
 * the same one for the same reason.
 *
 * The SRD prints both halves and neither is the other:
 *
 * > Guidance: "the creature adds 1d4 to any ability check using **the chosen
 * > skill**"; Pass without Trace: "a +10 bonus to **Dexterity (Stealth)**
 * > checks"; Enthrall: "a −10 penalty to **Wisdom (Perception)** checks".
 * > Slow: "a −2 penalty to AC and **Dexterity saving throws**" — one ability's
 * > saves, whose penalty would otherwise land on every save the target ever
 * > makes, including the one the spell itself calls for.
 *
 * **One readable pairing per filter, and the validator holds them to it**: a
 * skill on an ability check, an ability on a saving throw, and nothing else.
 * That is not a taste — it is which gatherer is handed which fact.
 * {@link bonusesFor}'s `of` comes from `checkBonuses`, which is told the skill
 * and not the ability, and from `savingSupport`, which is told the ability and
 * has no skill to be told; the attack gatherer is told neither. So a skill
 * named on a save reaches nothing, an ability named on an attack widens back
 * to every swing, an ability named on an *ability check* withholds the bonus
 * from every check there is, and an Armour Class is not a roll and is made
 * with nothing. "Dexterity (Stealth)" is written `{ skill: 'stealth' }` and
 * loses nothing, because a skill names its own governing ability.
 */
export interface BonusNarrowing {
  /** The ability the roll is made with. Readable on a saving throw alone. */
  readonly ability?: Ability;
  /** The skill the check uses. Readable on an ability check alone. */
  readonly skill?: Skill;
}

/**
 * A bonus an ongoing effect has hung on a creature.
 *
 * `Bonus` is a modifier a caller passes to one roll. This is the same thing
 * *stored*, with two extra facts: which rolls it touches, and which way it
 * pushes — because Bane is Bless with a minus sign and modelling them as two
 * mechanisms would be the same mistake `interveneAfterRoll` already avoided.
 *
 * The `source` carries the casting id (`Bless#cast:3`), which is what ties the
 * bonus to the spell that made it and ends it when that spell ends.
 */
export interface ActiveBonus {
  readonly source: string;
  readonly bonus: Bonus;
  readonly applies: readonly BonusApplies[];
  readonly direction: 'add' | 'subtract';
  /**
   * Which of those rolls it actually reaches — see {@link BonusNarrowing}.
   *
   * Absent is every bonus the SRD writes about a whole family, which is most
   * of them: Bless reaches every attack roll and every save its target makes.
   */
  readonly only?: BonusNarrowing;
}

/**
 * The bonuses a creature carries that apply to this kind of roll.
 *
 * Subtraction is folded in here rather than at the reading site: a caller
 * asking "what applies to my save" should get modifiers it can add, not a list
 * it has to know the sign convention for.
 *
 * `of` is what the roll knows about itself — the ability it is made with, the
 * skill it uses — and it is only ever read to *withhold*: a bonus that names
 * neither reaches every roll of the family it applies to, exactly as it did
 * before {@link BonusNarrowing} existed. A caller that knows nothing passes
 * nothing and gets the unnarrowed bonuses alone, which is the conservative
 * direction `checkBonuses` already takes for the feature-side twin.
 */
export function bonusesFor(
  held: readonly ActiveBonus[],
  kind: BonusApplies,
  of?: BonusNarrowing,
): readonly Bonus[] {
  return held
    .filter((active) => active.applies.includes(kind) && reaches(active.only, of))
    .map((active) =>
      active.direction === 'add'
        ? active.bonus
        : {
            ...active.bonus,
            ...(active.bonus.flat === undefined ? {} : { flat: -active.bonus.flat }),
            direction: 'subtract' as const,
          },
    );
}

/**
 * Whether a narrowed bonus reaches the roll asking.
 *
 * Every filter the bonus names must be matched by a fact the roll supplied.
 * **An unanswered filter withholds**, which is the direction that cannot be
 * wrong twice: a Guidance narrowed to Religion that reached a check nobody
 * named a skill for would be the unnarrowed bonus back again, wearing a field
 * that said otherwise.
 */
function reaches(only: BonusNarrowing | undefined, of: BonusNarrowing | undefined): boolean {
  if (only === undefined) return true;
  if (only.ability !== undefined && only.ability !== of?.ability) return false;
  if (only.skill !== undefined && only.skill !== of?.skill) return false;
  return true;
}

/** A bonus after its dice, if any, have been rolled. */
export interface ResolvedBonus {
  readonly source: string;
  readonly flat: number;
  readonly roll: RecordedRoll | null;
  readonly total: number;
}

/**
 * Advantage or disadvantage with an attribution.
 *
 * Advantage cancels rather than stacks, so when a roll comes out normal it is
 * worth being able to say which effects cancelled each other out.
 */
export interface ModeSource {
  readonly source: string;
  readonly mode: RollMode;
}

/**
 * Flat bonuses are folded into the d20's own modifier rather than added
 * afterwards, so `roll.total` stays meaningful as "the die plus everything
 * static". Dice bonuses are rolled separately by {@link rollBonusDice}.
 */
export function flatBonusTotal(bonuses: readonly Bonus[] | undefined): number {
  return (bonuses ?? []).reduce((sum, b) => sum + (b.flat ?? 0), 0);
}

/**
 * Check every bonus's notation before anything is rolled.
 *
 * Rolling first and validating afterwards left a malformed bonus returning an
 * error *after* it had advanced the generator and consumed a roll id — so a
 * rejected operation still moved authoritative state, and a replay would
 * diverge from the live session. Validate the whole operation, then roll.
 */
export function validateBonusDice(bonuses: readonly Bonus[] | undefined): Result<true> {
  for (const bonus of bonuses ?? []) {
    if (bonus.dice === undefined) continue;
    const parsed = parseNotation(bonus.dice);
    if (!parsed.ok) return parsed;
  }
  return ok(true);
}

/** Roll the dice half of any bonuses that have one. */
export function rollBonusDice(
  issuer: RollIssuer,
  rng: Rng,
  bonuses: readonly Bonus[] | undefined,
): Result<ResolvedBonus[]> {
  const resolved: ResolvedBonus[] = [];

  for (const bonus of bonuses ?? []) {
    if (bonus.dice === undefined) continue;
    const outcome = rollRecorded(issuer, rng, bonus.dice);
    if (!outcome.ok) return outcome;
    // The die is rolled either way and kept in the record either way; only the
    // contribution's sign differs, so the log still shows what Bane rolled.
    const sign = bonus.direction === 'subtract' ? -1 : 1;
    resolved.push({
      source: bonus.source,
      flat: 0,
      roll: outcome.value,
      total: outcome.value.total * sign,
    });
  }

  return ok(resolved);
}

export const sumResolved = (bonuses: readonly ResolvedBonus[]): number =>
  bonuses.reduce((sum, b) => sum + b.total, 0);
