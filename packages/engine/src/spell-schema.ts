import {
  ABILITIES,
  CONDITIONS,
  DAMAGE_TYPES,
  err,
  ok,
  SKILL_ABILITY,
  SKILLS,
  type Ability,
  type Result,
  type Skill,
} from '@ie/shared';
import { rollSelectorProblems } from './roll-modifiers.js';
import { parseNotation } from './dice.js';
import { conditionRiderOf, modifierRidersOf } from './spell-definitions.js';
import type {
  ConditionRider,
  DiceScaling,
  ModifierRider,
  SpellArea,
  SpellCheck,
  SpellDefinition,
  SpellEffect,
} from './spell-definitions.js';
import type { DefenseKind } from './attack.js';
import type { Bonus, BonusApplies } from './bonuses.js';
import type { RollModifier } from './roll-modifiers.js';

/**
 * Whether a spell definition is *coherent*, asked of a value rather than of a
 * compilation.
 *
 * The catalogue in `spell-definitions.ts` is already pure declarative data —
 * 125 object literals, no expressions, no hooks, and no spell-name special
 * case anywhere in the runtime. What it never had is anything that checks a
 * definition at **runtime**: the TypeScript compiler was the only guard, so a
 * definition that did not arrive through `tsc` — authored by a DM, read from a
 * file, proposed by a model — had nothing to check it at all.
 *
 * This is that guard, and it is deliberately three things kept apart:
 *
 * | | |
 * |---|---|
 * | **schema validity** (here) | the shape is coherent: closed vocabularies, dice that parse, combinations that mean something. True of homebrew as readily as of the book |
 * | **SRD conformance** (`scripts/spell-oracle.ts`) | this definition agrees with the spell the book prints. Only applies to a definition whose id *is* a printed spell |
 * | **this casting** (`commands/`) | range, slot, sight, creature type, action economy — the world, not the definition |
 *
 * Conflating the first two is how "valid" comes to mean "official", which is
 * the one thing a definition layer must not do: a DM's invented spell is valid
 * engine data and is not SRD-conformant, and both halves of that sentence are
 * load-bearing.
 *
 * **Every rule below was run against all 125 catalogue definitions before it
 * was written, and none of them fires.** These are the rules the catalogue
 * already obeys, moved to where a *new* definition meets them — instead of
 * being discovered by a sweep test casting the spell and finding nothing
 * happened.
 */

/** One thing wrong with a definition, and where. */
export interface SpellDefinitionProblem {
  /**
   * The path to the offending field, e.g. `effects[0].damageType`.
   *
   * A path rather than a name for the same reason `CharacterProblem` carries
   * one: an author fixing a definition wants to be pointed at the line, and a
   * spell's mechanics are nested two and three deep.
   */
  readonly field: string;
  readonly code: string;
  readonly reason: string;
}

const SCHOOLS: ReadonlySet<string> = new Set([
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
]);

const DAMAGE: ReadonlySet<string> = new Set(DAMAGE_TYPES);
const CONDITION_NAMES: ReadonlySet<string> = new Set(CONDITIONS);
/** The three answers `DamageDefenses` holds, as data, for untyped input. */
const DEFENSE_KINDS: ReadonlySet<string> = new Set<DefenseKind>([
  'resistant',
  'immune',
  'vulnerable',
]);
const CASTING_TIMES: ReadonlySet<string> = new Set([
  'action',
  'bonus-action',
  'reaction',
  'long',
]);
const ABILITY_NAMES_SET: ReadonlySet<Ability> = new Set(ABILITIES);
const SKILL_NAMES: ReadonlySet<Skill> = new Set(SKILLS);
/** Every kind of roll a granted mode can pick out — see `RollFamily`. */
const ROLL_FAMILIES: ReadonlySet<string> = new Set([
  'attack',
  'ability-check',
  'saving-throw',
  'initiative',
  'death-save',
]);
const AREA_KINDS: ReadonlySet<string> = new Set([
  'sphere',
  'cylinder',
  'cone',
  'cube',
  'line',
  'emanation',
]);

/** The shapes whose origin is a creature rather than a coordinate. */
const selfOrigin = (area: SpellArea): boolean => area.origin === 'self';

/**
 * Every notation a scaling carries, with the path each was found at.
 *
 * `scaledDiceFor` splits a notation on `d` and does arithmetic on the halves,
 * so a malformed one does not throw — it produces `NaNd6`, which is a spell
 * that silently rolls nothing. Checking the notation is the cheapest place to
 * catch that, and it is the same `validateBonusDice` discipline: parse
 * everything before anything is thrown.
 */
function checkScaling(
  scaling: DiceScaling,
  level: number,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  for (const [key, notation] of [
    ['dice', scaling.dice],
    ['perSlotLevelAbove', scaling.perSlotLevelAbove],
  ] as const) {
    if (notation === undefined) continue;
    if (!parseNotation(notation).ok) {
      found.push({
        field: `${path}.${key}`,
        code: 'bad_dice',
        reason: `"${notation}" is not dice notation`,
      });
    }
  }

  // A cantrip has no slot, so nothing about it can grow with one: SRD gives it
  // a Cantrip Upgrade read off the *caster*. `scaledDiceFor` takes the cantrip
  // branch and never looks at a per-slot field, so the number would simply be
  // ignored — the quietest possible way to be wrong.
  if (level === 0) {
    for (const key of ['perSlotLevelAbove', 'flatPerSlotLevelAbove'] as const) {
      if (scaling[key] !== undefined) {
        found.push({
          field: `${path}.${key}`,
          code: 'slot_scaling_on_cantrip',
          reason: 'a cantrip is cast with no spell slot, so nothing about it scales with one',
        });
      }
    }
  } else if (scaling.cantripUpgradesAt !== undefined) {
    // And the mirror, which is the exact confusion that had a level 3 Wizard
    // throwing Fire Bolt for 2d10: a levelled spell scales with its slot.
    found.push({
      field: `${path}.cantripUpgradesAt`,
      code: 'cantrip_scaling_on_spell',
      reason: 'the Cantrip Upgrade applies to cantrips; a levelled spell scales with its slot',
    });
  }
}

function checkDamageType(
  type: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (!DAMAGE.has(type)) {
    found.push({
      field: path,
      code: 'unknown_damage_type',
      reason: `"${type}" is not one of the SRD's thirteen damage types`,
    });
  }
}

function checkCondition(
  name: string,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (!CONDITION_NAMES.has(name)) {
    found.push({
      field: path,
      code: 'unknown_condition',
      reason: `"${name}" is not one of the SRD's fifteen conditions`,
    });
  }
}

/**
 * A check a spell offers, wherever it sits.
 *
 * Three places carry one — the definition's own `check`, a condition rider's,
 * and the flat `check` on a `save` — and until now **no field of any of them
 * was checked at all**, which the fourth whole-engine audit (2026-09-13, §3.3)
 * named: a check keyed to a skill of the wrong ability compiled and validated.
 *
 * What the existing vocabulary can answer is checked and nothing else. The
 * ability and the skill are closed sets the engine already holds, the pairing
 * between them is `SKILL_ABILITY`, and the outcome is the two values
 * {@link SpellCheck.onSuccess} declares. A printed DC is a whole number worth
 * beating, because `EffectCheck.dc` is compared against a total.
 *
 * **The pairing is the rule worth having.** SRD always prints a check as
 * "Intelligence (Investigation)" — the ability the skill belongs to, in front
 * of the skill — and a pair that disagrees rolls one ability's modifier
 * against the other's proficiency. Nothing downstream would notice:
 * `rollAbilityCheck` reads `ability` for the modifier and `skill` for
 * proficiency and is right to trust both.
 */
function checkSpellCheck(
  check: SpellCheck,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const ability = check.ability as unknown as string;
  if (!ABILITY_NAMES_SET.has(check.ability)) {
    found.push({
      field: `${path}.ability`,
      code: 'bad_ability',
      reason: `"${ability}" is not an ability`,
    });
  }

  if (check.skill !== undefined) {
    if (!SKILL_NAMES.has(check.skill)) {
      found.push({
        field: `${path}.skill`,
        code: 'bad_skill',
        reason: `"${String(check.skill)}" is not a skill`,
      });
    } else if (ABILITY_NAMES_SET.has(check.ability) && SKILL_ABILITY[check.skill] !== check.ability) {
      found.push({
        field: `${path}.skill`,
        code: 'skill_ability_mismatch',
        reason: `SRD writes a check as "Intelligence (Investigation)"; ${String(check.skill)} is a ${SKILL_ABILITY[check.skill]} skill and this names ${ability}`,
      });
    }
  }

  if (check.dc !== undefined && (!Number.isInteger(check.dc) || check.dc < 1)) {
    found.push({
      field: `${path}.dc`,
      code: 'bad_check_dc',
      reason: 'a printed DC is a whole number a creature could roll against',
    });
  }

  if (check.onSuccess !== 'none' && check.onSuccess !== 'end-on-target') {
    found.push({
      field: `${path}.onSuccess`,
      code: 'bad_check_outcome',
      reason: `"${String(check.onSuccess)}" is not something succeeding at a check does; a check changes nothing or ends the effect on its own attempter`,
    });
  }
}

/**
 * A condition rider, wherever an effect carries one.
 *
 * One function for the four kinds that impose a condition, because they carry
 * one {@link ConditionRider} between them — so a rider on an `attack` is held
 * to exactly what a rider on a `save-damage` is, and a field added to the
 * rider is checked in one place rather than three.
 *
 * `rider` is optional and read through `?.` because this also meets untyped
 * input: `checkShape` establishes the effect's `kind` and nothing below it, so
 * a `condition` effect whose rider is missing outright must be *reported*
 * rather than throw.
 *
 * **The caller supplies both whole paths**, rather than this appending `.name`
 * and `.check`, because `save` holds its rider flat: a problem reported
 * against `effects[0].condition.name` on a definition whose field is
 * `effects[0].condition` points at nothing an author can fix, and the same
 * goes for the check, which `save` writes at `effects[0].check` and every
 * other carrier at `effects[0].condition.check`.
 */
function checkConditionRider(
  rider: ConditionRider | undefined,
  namePath: string,
  riderPath: string,
  host: RiderHost,
  found: SpellDefinitionProblem[],
): void {
  checkCondition(String(rider?.name), namePath, found);

  // **The check hangs off the rider's own base, in both layouts**, which is
  // why one path is enough where the docstring above asks for two. A nested
  // rider at `X` writes `X.check`; `save` writes its rider flat, so the base
  // *is* the effect and the check is `effects[0].check`. The name is the one
  // field that does not follow — `save` calls it `condition` — and it stays
  // the caller's to supply for exactly that reason.
  if (rider?.check !== undefined) checkSpellCheck(rider.check, `${riderPath}.check`, found);

  // **A rider that repeats a save needs a host that rolled one.** SRD writes
  // "the target repeats the save" — the one the spell already asked for — so
  // an `attack` host, which rolls an attack, and a `condition` host, which
  // rolls nothing at all, have none to repeat. The type cannot say this: one
  // `ConditionRider` is shared by all four hosts, which is the whole point of
  // it, and the docstring on the `condition` kind had been making the argument
  // in prose since that kind arrived.
  if (rider?.repeats !== undefined && !host.rollsSave) {
    found.push({
      field: `${riderPath}.repeats`,
      code: 'repeats_without_save',
      reason: `a repeat save repeats the one its host rolled, and a "${host.kind}" effect rolls none`,
    });
  }

  // A span of nothing is not a duration, it is the absence of one — the same
  // argument `durationSeconds` already makes on the definition.
  const lasts = rider?.lasts;
  if (
    typeof lasts === 'object' &&
    (!Number.isFinite(lasts.seconds) || lasts.seconds <= 0)
  ) {
    found.push({
      field: `${riderPath}.lasts.seconds`,
      code: 'bad_rider_duration',
      reason: 'a rider that lasts no seconds does not last; omit it to borrow the casting’s own deadline',
    });
  }

  // **A rider with no lifetime is checked once, and not here.** The rule that
  // an effect the casting owns needs something to end it is
  // {@link checkGrantLifetimes}, which reads the definition rather than the
  // host — so it also reaches a `buff`, a `roll-mode` and an `armor-class`,
  // which are grants with the same problem and no rider at all. Two places
  // reporting one defect under two codes is the second place to get one
  // sentence wrong.
}

/**
 * Which host a rider is hanging on, as the one fact a rider rule reads.
 *
 * Not the effect: a rider knows nothing about its host beyond whether there
 * was a saving throw to repeat. Passing the effect would let a rule here start
 * switching on the kind, which is the branching the whole design exists to
 * keep out — and the `kind` that *is* here is for the refusal's wording, never
 * for a decision.
 *
 * It carried a second fact for one commit, `castingLasts`, and the rule that
 * read it turned out to be {@link checkGrantLifetimes} written twice. That one
 * reads the definition, so it needs nothing from the host at all.
 */
interface RiderHost {
  readonly kind: SpellEffect['kind'];
  /** Whether the host rolled a saving throw a rider could repeat. */
  readonly rollsSave: boolean;
}

/**
 * A grant an outcome imposes, held to exactly what the standalone kinds are.
 *
 * `bonus` is `buff` minus its saving throw and `mode` is `roll-mode` minus
 * its selector's own, so the rules are the ones those two branches already
 * apply — shared rather than restated, because a second copy is a second
 * place for a rolled Armour Class to slip through.
 */
function checkModifierRider(
  rider: ModifierRider | undefined,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (rider?.kind === 'bonus') {
    checkBonusGrant(rider.bonus, rider.applies, path, found);
    return;
  }
  if (rider?.kind === 'mode') {
    checkRollModifier(rider.modifier, `${path}.modifier`, found);
    return;
  }
  found.push({
    field: `${path}.kind`,
    code: 'unknown_modifier_rider',
    reason: `"${String((rider as { kind?: unknown } | undefined)?.kind)}" is not a grant a rider carries; a rider adds a bonus or grants a mode`,
  });
}

/** Every rider one host carries, in the order `applyRiders` applies them. */
function checkRiders(
  riders: {
    readonly conditions?: readonly ConditionRider[];
    readonly modifiers?: readonly ModifierRider[];
    readonly delayed?: { readonly damage: DiceScaling; readonly damageType: string };
  },
  level: number,
  path: string,
  host: RiderHost,
  found: SpellDefinitionProblem[],
): void {
  (riders.conditions ?? []).forEach((rider, i) =>
    checkConditionRider(
      rider,
      `${path}.conditions[${i}].name`,
      `${path}.conditions[${i}]`,
      host,
      found,
    ),
  );
  (riders.modifiers ?? []).forEach((rider, i) =>
    checkModifierRider(rider, `${path}.modifiers[${i}]`, found),
  );
  if (riders.delayed !== undefined) {
    checkScaling(riders.delayed.damage, level, `${path}.delayed.damage`, found);
    checkDamageType(riders.delayed.damageType, `${path}.delayed.damageType`, found);
  }
}

/** The `buff` rules, shared with the `bonus` rider that is `buff` minus its save. */
function checkBonusGrant(
  bonus: Bonus,
  applies: readonly BonusApplies[],
  path: string,
  found: SpellDefinitionProblem[],
): void {
  if (bonus.dice !== undefined && !parseNotation(bonus.dice).ok) {
    found.push({
      field: `${path}.bonus.dice`,
      code: 'bad_dice',
      reason: `"${bonus.dice}" is not dice notation`,
    });
  }
  // SRD writes no rolled Armour Class and there is no moment at which a die
  // could be thrown for a standing number, so `armorClassOf` reads only the
  // flat half. A rolled bonus aimed at `ac` is therefore data nothing can
  // apply — silently, which is what makes it worth refusing here.
  if (applies.includes('ac') && bonus.dice !== undefined) {
    found.push({
      field: `${path}.bonus.dice`,
      code: 'rolled_armor_class',
      reason:
        'an Armour Class is a standing number rather than a roll, so only a flat bonus reaches one',
    });
  }
  if (applies.length === 0) {
    found.push({
      field: `${path}.applies`,
      code: 'bonus_applies_to_nothing',
      reason: 'a bonus that applies to no kind of roll is a bonus nothing reads',
    });
  }
}

/** The `roll-mode` rules, shared with the `mode` rider that is that kind minus its save. */
function checkRollModifier(
  modifier: RollModifier,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  // The selector's own coherence — an ability on a roll made with none, a
  // skill on a roll that uses none, a skill and an ability that disagree,
  // or "against the holder" on a roll the engine records no target for.
  // Every one of these compiles and then matches nothing for ever, or
  // matches far more than the spell says, which is what makes them worth
  // a refusal at authoring rather than a surprise at the table.
  const selector = modifier.selector;
  if (!ROLL_FAMILIES.has(selector.roll)) {
    found.push({
      field: `${path}.selector.roll`,
      code: 'bad_roll_family',
      reason: `"${String(selector.roll)}" is not a kind of roll the engine makes`,
    });
  }
  if (selector.relation !== 'roller' && selector.relation !== 'against-holder') {
    found.push({
      field: `${path}.selector.relation`,
      code: 'bad_roll_relation',
      reason: `"${String(selector.relation)}" is not a relation; a mode is the roller's or it is on rolls against the holder`,
    });
  }
  if (modifier.mode !== 'advantage' && modifier.mode !== 'disadvantage') {
    found.push({
      field: `${path}.mode`,
      code: 'bad_roll_mode',
      reason: 'a granted mode is Advantage or Disadvantage; "normal" grants nothing',
    });
  }
  if (selector.ability !== undefined && !ABILITY_NAMES_SET.has(selector.ability)) {
    found.push({
      field: `${path}.selector.ability`,
      code: 'bad_ability',
      reason: `"${String(selector.ability)}" is not an ability`,
    });
  }
  if (selector.skill !== undefined && !SKILL_NAMES.has(selector.skill)) {
    found.push({
      field: `${path}.selector.skill`,
      code: 'bad_skill',
      reason: `"${String(selector.skill)}" is not a skill`,
    });
  }
  // Only once the vocabulary is known good: the combination rules read
  // the values, and reading a value that is not an ability at all would
  // report a second, less useful problem about the first one.
  if (
    ROLL_FAMILIES.has(selector.roll) &&
    (selector.ability === undefined || ABILITY_NAMES_SET.has(selector.ability)) &&
    (selector.skill === undefined || SKILL_NAMES.has(selector.skill))
  ) {
    for (const problem of rollSelectorProblems(selector, (skill: Skill) => SKILL_ABILITY[skill])) {
      found.push({ field: `${path}.selector`, ...problem });
    }
  }
}

/** One effect, wherever it was found: the spell's own list, an activation, a trigger. */
function checkEffect(
  effect: SpellEffect,
  level: number,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  const host = (rollsSave: boolean): RiderHost => ({ kind: effect.kind, rollsSave });

  switch (effect.kind) {
    case 'attack':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      // An attack rolls an attack, so nothing it hangs has a save to repeat.
      checkRiders(effect, level, path, host(false), found);
      return;

    case 'save-damage':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      (effect.plus ?? []).forEach((extra, i) => {
        checkScaling(extra.damage, level, `${path}.plus[${i}].damage`, found);
        checkDamageType(extra.damageType, `${path}.plus[${i}].damageType`, found);
      });
      checkRiders(effect, level, path, host(true), found);
      return;

    case 'attack-damage':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      return;

    // `save` spells its **first** rider flat and `condition` nests its only
    // one; both go through the reader that knows, so the two layouts cannot be
    // validated by two rules — and each names the field its own author wrote,
    // which is the whole reason the *name* path is the caller's to supply. The
    // extra riders a `save` carries are at their own path, because that is
    // where an author would look for them.
    case 'save':
      checkConditionRider(
        conditionRiderOf(effect)[0],
        `${path}.condition`,
        path,
        host(true),
        found,
      );
      checkRiders(effect, level, path, host(true), found);
      return;

    case 'condition':
      checkConditionRider(
        effect.condition,
        `${path}.condition.name`,
        `${path}.condition`,
        // A condition imposed with no saving throw has none to repeat, which
        // this kind's own docstring has said in prose since it arrived.
        host(false),
        found,
      );
      return;

    // A removal names conditions and nothing else — no rider, no lifetime, no
    // roll — so the only thing there is to be wrong about is the list itself.
    // **An empty one is refused**, because a spell that ends no condition is a
    // definition claiming to do something and doing nothing, which is the
    // `resolves_nothing` mistake arriving one level down; and a repeat is
    // refused because a second `condition-removed` for the same name removes an
    // instance that is already gone, exactly as `duplicate_condition` refuses a
    // Paladin naming one twice and being charged for it twice.
    case 'end-condition': {
      if (effect.conditions.length === 0) {
        found.push({
          field: `${path}.conditions`,
          code: 'ends_nothing',
          reason: 'a spell that ends no condition ends nothing; name the conditions the SRD prints',
        });
      }
      const seen = new Set<string>();
      effect.conditions.forEach((condition, i) => {
        checkCondition(condition, `${path}.conditions[${i}]`, found);
        if (seen.has(condition)) {
          found.push({
            field: `${path}.conditions[${i}]`,
            code: 'duplicate_condition',
            reason: `the ${condition} condition is ended twice, and the second removal has nothing left to take`,
          });
        }
        seen.add(condition);
      });
      return;
    }

    case 'heal':
      checkScaling(effect.healing, level, `${path}.healing`, found);
      return;

    case 'temp-hp':
      checkScaling(effect.amount, level, `${path}.amount`, found);
      return;

    case 'buff':
      checkBonusGrant(effect.bonus, effect.applies, path, found);
      return;

    case 'roll-mode':
      checkRollModifier(effect.modifier, `${path}.modifier`, found);
      return;

    case 'armor-class':
      if (!Number.isInteger(effect.base) || effect.base < 1) {
        found.push({
          field: `${path}.base`,
          code: 'bad_armor_class',
          reason: 'a base Armour Class is a whole number of at least 1',
        });
      }
      return;

    // A granted defence names types and says one thing about all of them, so
    // the only things to be wrong about are the list and the answer.
    //
    // **An empty list is refused**, for the reason an empty `end-condition`
    // list is: a definition that resists nothing resists nothing, and it
    // compiles. A repeat is refused too — Resistance is a boolean and
    // "multiple instances ... count as only one", so a second copy of a type
    // is a sentence the SRD has already answered rather than a second grant.
    case 'damage-defense': {
      if (effect.damageTypes.length === 0) {
        found.push({
          field: `${path}.damageTypes`,
          code: 'defends_nothing',
          reason:
            'a granted defence that names no damage type defends against nothing; name the types the SRD prints',
        });
      }
      const seen = new Set<string>();
      effect.damageTypes.forEach((type, i) => {
        checkDamageType(type, `${path}.damageTypes[${i}]`, found);
        if (seen.has(type)) {
          found.push({
            field: `${path}.damageTypes[${i}]`,
            code: 'duplicate_damage_type',
            reason: `${type} is named twice, and Resistance is a boolean rather than a tally`,
          });
        }
        seen.add(type);
      });
      if (!DEFENSE_KINDS.has(effect.defense)) {
        found.push({
          field: `${path}.defense`,
          code: 'unknown_defense',
          reason: `"${String(effect.defense)}" is not Resistance, Immunity or Vulnerability`,
        });
      }
      return;
    }

    case 'dispel':
    case 'interrupt-casting':
      return;
  }
}

/**
 * What a grant needs from the casting it hangs on.
 *
 * Four things a definition can leave standing after it resolves, and every one
 * of them is removed by `releaseCasting` or `releaseOnTarget` when the casting
 * ends: a `buff`, a granted `roll-mode`, an `armor-class`, and a condition
 * whose rider says neither `lasts` nor `outlivesCasting` and therefore "lasts
 * as long as the casting does". An **Instantaneous** casting is over the
 * moment it resolves, so each of those is a grant with no moment that could
 * ever end it — a Bless adding its d4 for ever, or a paralysis with nothing to
 * lift it.
 *
 * The two escapes are the two the SRD writes and the rider already carries.
 * Color Spray is Instantaneous and blinds "until the end of your next turn",
 * which is a deadline of the rider's own; Grease's Prone outlives the Grease,
 * because Prone ends when the creature stands up. So the rule reads the rider
 * rather than the effect kind.
 *
 * **No definition in the catalogue violates it** — all of them were driven
 * through before it was written, as every rule in this file was — which is
 * what makes it a guard against the next one rather than a fix for this lot.
 */
function checkGrantLifetimes(
  definition: SpellDefinition,
  lasts: boolean,
  found: SpellDefinitionProblem[],
): void {
  const persists = lasts || definition.untilDispelled === true || definition.concentration;
  if (persists) return;

  const everywhere: (readonly [string, readonly SpellEffect[]])[] = [
    ['effects', definition.effects],
    ...(definition.areaTrigger === undefined
      ? []
      : ([['areaTrigger.effects', definition.areaTrigger.effects]] as const)),
    ...(definition.activation === undefined
      ? []
      : ([['activation.effects', definition.activation.effects]] as const)),
  ];

  for (const [where, effects] of everywhere) {
    effects.forEach((effect, i) => {
      const carries = grantCarried(effect);
      if (carries === null) return;
      found.push({
        field: `${where}[${i}]`,
        code: 'grant_without_lifetime',
        // A `modifiers` rider can take neither escape the sentence offers, so
        // for that one the first half is the only advice there is — see
        // {@link grantCarried}, which is where the asymmetry is argued.
        reason: `${carries} lasts as long as the casting, and this casting is over the moment it resolves; give the spell a duration, or the rider a deadline of its own`,
      });
    });
  }
}

/**
 * What this effect leaves standing, or null if it leaves nothing.
 *
 * **Every rider, not the first**, because a host carries several: Hideous
 * Laughter's failed save imposes the Prone *and* the Incapacitated, and a
 * definition whose second condition had no deadline would have gone unreported
 * behind a first one that did.
 *
 * A `modifiers` rider is always in the list when there is one. A grant has no
 * `lasts` to give and no `outlivesCasting` — `EffectTarget` ends a condition
 * instance, a casting or a feature, and nothing ends a grant before its casting
 * does — so on a spell with no casting to end it there is no way to write it
 * correctly, and the only honest answer is to refuse it.
 *
 * **Every rider is read through `?.`, because this meets untyped input like
 * every other reader in this file.** `checkShape` establishes an effect's
 * `kind` and nothing below it, so a rider can arrive missing, null, or not an
 * object at all — and `parseSpellDefinition` exists to hand back a *problem*
 * for exactly that. A validator that throws on the input it exists to judge
 * has judged nothing, which is the sentence `checkConditionRider` has carried
 * since it was written; this was the one reader that did not obey it. A rider
 * nobody can read carries no lifetime worth reporting, so it falls through to
 * the reader that will report what is actually wrong with it.
 */
function grantCarried(effect: SpellEffect): string | null {
  switch (effect.kind) {
    case 'buff':
      return 'a bonus';
    case 'roll-mode':
      return 'a granted Advantage or Disadvantage';
    case 'armor-class':
      return 'a base Armour Class';
    case 'damage-defense':
      return 'a granted Resistance, Immunity or Vulnerability';
    default: {
      for (const rider of conditionRiderOf(effect)) {
        // Unreadable first, lifetime second. A rider that is missing, null or
        // not an object at all has no lifetime to be wrong about, and is
        // `checkConditionRider`'s to report.
        if (typeof rider !== 'object' || rider === null) continue;
        if (rider.lasts !== undefined || rider.outlivesCasting === true) continue;
        return `the ${String(rider.name)} condition`;
      }
      // `?.` on the discriminant, so absent, null and a kind this engine does
      // not know take the same branch — and it is the branch that reports
      // nothing, because `checkModifierRider` is what says what is wrong.
      switch (modifierRidersOf(effect)[0]?.kind) {
        case 'bonus':
          return 'a bonus';
        case 'mode':
          return 'a granted Advantage or Disadvantage';
        default:
          return null;
      }
    }
  }
}

/**
 * Everything wrong with a definition, rather than the first thing.
 *
 * The shape `checkCharacter` already uses, for the same reason: somebody
 * filling in a definition does not want to be told about one mistake at a
 * time. {@link parseSpellDefinition} is the `Result` half, for a caller that
 * wants a definition or a refusal.
 */
export function checkSpellDefinition(
  definition: SpellDefinition,
): readonly SpellDefinitionProblem[] {
  const found: SpellDefinitionProblem[] = [];

  if (!/^[a-z0-9-]+$/.test(definition.id)) {
    found.push({
      field: 'id',
      code: 'bad_id',
      reason: 'an id is lower-case letters, digits and hyphens; it is the join to the parsed SRD',
    });
  }

  if (definition.name.length === 0) {
    found.push({ field: 'name', code: 'bad_name', reason: 'a spell needs a name' });
  }

  // `castingSource` encodes the link as `Hold Person#cast:3` and `castingIdOf`
  // reads it back, so a `#` in a name forges a casting link — which is why
  // `castSpell` already refuses one. Catching it here catches it at authoring,
  // before a definition carrying it is ever cast.
  if (definition.name.includes('#')) {
    found.push({
      field: 'name',
      code: 'forged_casting_link',
      reason: 'a "#" in a spell name would forge the casting link effects are tied to',
    });
  }

  if (!Number.isInteger(definition.level) || definition.level < 0 || definition.level > 9) {
    found.push({
      field: 'level',
      code: 'bad_level',
      reason: 'a spell level is a whole number from 0 (cantrip) to 9',
    });
  }

  if (!SCHOOLS.has(definition.school)) {
    found.push({
      field: 'school',
      code: 'unknown_school',
      reason: `"${definition.school}" is not one of the eight schools of magic`,
    });
  }

  if (!CASTING_TIMES.has(definition.castingTime)) {
    found.push({
      field: 'castingTime',
      code: 'unknown_casting_time',
      reason: `"${definition.castingTime}" is not a casting time the engine has`,
    });
  }

  if (definition.range.kind === 'ranged' && definition.range.feet <= 0) {
    found.push({
      field: 'range.feet',
      code: 'bad_range',
      reason: 'a ranged spell reaches more than nothing',
    });
  }

  // — targeting ————————————————————————————————————————————————————————————

  if (definition.targets.unlimited === true && definition.targets.count !== 0) {
    found.push({
      field: 'targets.count',
      code: 'unlimited_with_count',
      reason:
        'SRD "each creature of your choice" names no number, so `count` must be 0 alongside `unlimited`',
    });
  }

  if (definition.targets.count < 0) {
    found.push({
      field: 'targets.count',
      code: 'bad_target_count',
      reason: 'a target count is not negative',
    });
  }

  // — geometry —————————————————————————————————————————————————————————————

  // One says the geometry chooses who is caught; the other says it bounds a
  // choice the caller makes. A definition that claimed both would have no
  // answer to "did the caster pick these targets".
  if (definition.area !== undefined && definition.targetsWithin !== undefined) {
    found.push({
      field: 'targetsWithin',
      code: 'area_and_targets_within',
      reason: 'a spell either fills an area or bounds a chosen list, never both',
    });
  }

  for (const [key, area] of [
    ['area', definition.area],
    ['targetsWithin', definition.targetsWithin],
  ] as const) {
    if (area === undefined) continue;
    if (!AREA_KINDS.has(area.kind)) {
      found.push({
        field: `${key}.kind`,
        code: 'unknown_area',
        reason: `"${area.kind}" is not one of the SRD's six areas of effect`,
      });
    }
  }

  if (definition.areaTrigger !== undefined) {
    if (definition.area === undefined) {
      found.push({
        field: 'areaTrigger',
        code: 'trigger_without_area',
        reason: 'a persistent area trigger needs an area to be persistent in',
      });
    }
    if (definition.areaTrigger.effects.length === 0) {
      found.push({
        field: 'areaTrigger.effects',
        code: 'trigger_does_nothing',
        reason: 'a trigger that resolves nothing is a save the engine would roll for no reason',
      });
    }
    definition.areaTrigger.effects.forEach((effect, i) =>
      checkEffect(effect, definition.level, `areaTrigger.effects[${i}]`, found),
    );
  }

  // The geometry pass's one bit of information, declared in data.
  if (definition.anchoring !== undefined) {
    const template = definition.area ?? definition.targetsWithin;
    if (template === undefined) {
      found.push({
        field: 'anchoring',
        code: 'anchoring_without_area',
        reason: 'anchoring says how a template footprint is read; a spell with no template has none',
      });
    } else if (selfOrigin(template)) {
      // The same refusal `placeArea` makes on the request, for the same reason:
      // a `self` origin is a creature's own space, and a creature does not
      // stand on a grid intersection.
      found.push({
        field: 'anchoring',
        code: 'anchoring_on_self_area',
        reason: 'an area that starts at the caster is anchored on their space and cannot be read otherwise',
      });
    }
  }

  if (definition.designatesUnaffected === true && definition.area === undefined) {
    found.push({
      field: 'designatesUnaffected',
      code: 'unaffected_without_area',
      reason: 'SRD writes "designate creatures to be unaffected" only for an area',
    });
  }

  // — the damage type the SRD decides on a fact the engine does not hold ——

  if (definition.damageTypeStated !== undefined) {
    if (definition.damageTypeStated.length < 2) {
      found.push({
        field: 'damageTypeStated',
        code: 'stated_damage_type_needs_choice',
        reason: 'this records a spell printing two damage types; one entry is not a choice',
      });
    }
    definition.damageTypeStated.forEach((type, i) =>
      checkDamageType(type, `damageTypeStated[${i}]`, found),
    );
  }

  // — duration —————————————————————————————————————————————————————————————

  if (definition.durationSeconds !== undefined && definition.durationUntil !== undefined) {
    found.push({
      field: 'durationUntil',
      code: 'two_durations',
      reason: 'a span of seconds and a moment in the turn order are different things; a spell has one',
    });
  }

  // "Until dispelled" is the absence of a deadline. A definition that carries
  // one as well is claiming both that the spell ends at a moment and that it
  // never does, and `persists` would answer on whichever field it read first.
  if (
    definition.untilDispelled === true &&
    (definition.durationSeconds !== undefined || definition.durationUntil !== undefined)
  ) {
    found.push({
      field: 'untilDispelled',
      code: 'two_durations',
      reason: '"Until dispelled" is the absence of a deadline, so a spell cannot also print one',
    });
  }

  if (definition.durationSeconds !== undefined && definition.durationSeconds <= 0) {
    found.push({
      field: 'durationSeconds',
      code: 'bad_duration',
      reason: 'a duration of nothing is Instantaneous, which is the absence of one',
    });
  }

  const lasts =
    definition.durationSeconds !== undefined || definition.durationUntil !== undefined;

  if (definition.concentration && !lasts) {
    found.push({
      field: 'concentration',
      code: 'concentration_without_duration',
      reason: 'Concentration is sustained attention on something that lasts',
    });
  }

  // SRD hangs the check on the casting's own timer, so a spell with no
  // duration leaves nothing standing there to be examined.
  if (definition.check !== undefined) {
    if (!lasts) {
      found.push({
        field: 'check',
        code: 'check_without_duration',
        reason: 'a check against the casting rides on its timer; an instantaneous spell has none',
      });
    }
    checkSpellCheck(definition.check, 'check', found);
  }

  // — the Reaction clause ——————————————————————————————————————————————————

  if (definition.trigger !== undefined && definition.castingTime !== 'reaction') {
    found.push({
      field: 'trigger',
      code: 'trigger_without_reaction',
      reason: 'a trigger is the clause in a Reaction casting time; nothing else has one',
    });
  }

  if (definition.castingTime === 'reaction' && definition.trigger === undefined) {
    found.push({
      field: 'trigger',
      code: 'reaction_without_trigger',
      reason:
        'SRD writes a Reaction as "Reaction, which you take when ..."; a moment nobody named is one the engine cannot check',
    });
  }

  // — what the spell does ——————————————————————————————————————————————————

  definition.effects.forEach((effect, i) =>
    checkEffect(effect, definition.level, `effects[${i}]`, found),
  );

  const activation = definition.activation;
  if (activation !== undefined) {
    // Stated in CLAUDE.md and pinned here: a later action reaches from the
    // caster **or** from the point the casting keeps. Two fields saying five
    // feet are two places to get one sentence wrong.
    if (activation.range !== undefined && definition.origin !== undefined) {
      found.push({
        field: 'activation.range',
        code: 'activation_range_and_origin',
        reason:
          'a later action measures from the caster or from the point the casting holds, never both',
      });
    }
    if (activation.range === undefined && definition.origin === undefined && activation.movesArea === undefined) {
      found.push({
        field: 'activation.range',
        code: 'activation_reaches_nothing',
        reason: 'an activation that targets a creature needs a range, from the caster or from a point',
      });
    }
    if (activation.movesArea !== undefined) {
      if (definition.area === undefined) {
        found.push({
          field: 'activation.movesArea',
          code: 'moves_area_without_area',
          reason: 'an action that moves the spell’s area needs the spell to have one',
        });
      }
      if (activation.movesArea <= 0) {
        found.push({
          field: 'activation.movesArea',
          code: 'bad_movement_allowance',
          reason: 'an allowance of nothing is an action spent moving nothing',
        });
      }
    }
    // SRD Moonbeam's later Magic action *is* the move; every other activation
    // does something. One that does neither spends an action on nothing.
    if (activation.effects.length === 0 && activation.movesArea === undefined) {
      found.push({
        field: 'activation.effects',
        code: 'activation_does_nothing',
        reason: 'an activation with no effects must be the one whose whole content is moving the area',
      });
    }
    if (!lasts && !definition.concentration) {
      found.push({
        field: 'activation',
        code: 'activation_without_duration',
        reason: 'a later turn can only act through a casting that is still running',
      });
    }
    activation.effects.forEach((effect, i) =>
      checkEffect(effect, definition.level, `activation.effects[${i}]`, found),
    );
  }

  if (definition.origin !== undefined) {
    if (definition.origin.reach < 0) {
      found.push({
        field: 'origin.reach',
        code: 'bad_reach',
        reason: 'a reach is not negative',
      });
    }
    if (definition.area !== undefined) {
      found.push({
        field: 'origin',
        code: 'origin_and_area',
        reason: 'a point the casting measures from is not a template it fills',
      });
    }
  }

  // — a grant with nothing to hang on ——————————————————————————————————————
  //
  // Last of the structural rules, so an effect's own problems are reported at
  // its own path first and this cross-check reads as the cross-check it is.
  checkGrantLifetimes(definition, lasts, found);

  /**
   * The tracked rule, and the reason it belongs here rather than in a test.
   *
   * A definition with no effects is **tracked**: the engine spends the action,
   * the slot, the Concentration and the clock, and `unmodelled` says what the
   * table adjudicates. That is honest. A definition with no effects and
   * nothing to declare resolves to a casting and silence, which is worse than
   * the refusal it replaced — and it is the single easiest mistake to make in
   * this format, because it compiles.
   */
  if (
    definition.effects.length === 0 &&
    definition.activation === undefined &&
    definition.areaTrigger === undefined &&
    (definition.unmodelled ?? []).length === 0
  ) {
    found.push({
      field: 'unmodelled',
      code: 'silent_gap',
      reason: 'a spell the engine resolves nothing of must say what the DM adjudicates',
    });
  }

  (definition.unmodelled ?? []).forEach((note, i) => {
    if (note.trim().length === 0) {
      found.push({
        field: `unmodelled[${i}]`,
        code: 'empty_note',
        reason: 'an empty note declares nothing',
      });
    }
  });

  return found;
}

/**
 * A definition, or the first thing wrong with it.
 *
 * Takes `unknown` deliberately: the point of a validator is that a definition
 * does not have to have come through the compiler. The shape is checked first
 * and the semantics second, so a caller handing over a JSON blob gets the same
 * answers as a caller handing over a compiled constant.
 *
 * **This says nothing about whether the spell is in the SRD.** A DM's invented
 * spell passes here and fails the oracle, and that is the correct pair of
 * answers rather than a contradiction.
 */
export function parseSpellDefinition(value: unknown): Result<SpellDefinition> {
  const shape = checkShape(value);
  if (shape.length > 0) {
    const first = shape[0]!;
    return err(first.code, `${first.field}: ${first.reason}`);
  }

  const problems = checkSpellDefinition(value as SpellDefinition);
  if (problems.length > 0) {
    const first = problems[0]!;
    return err(first.code, `${first.field}: ${first.reason}`);
  }

  return ok(value as SpellDefinition);
}

/** Every problem, shape and semantics alike, over untyped input. */
export function checkSpellDefinitionValue(
  value: unknown,
): readonly SpellDefinitionProblem[] {
  const shape = checkShape(value);
  if (shape.length > 0) return shape;
  return checkSpellDefinition(value as SpellDefinition);
}

/**
 * Enough of the shape that the semantic rules can read it without throwing.
 *
 * Not a second copy of the type: the compiler owns the shape for anything
 * written in this repository, and this exists for the input that was not. So
 * it checks the fields the rules above dereference, and stops — an unknown
 * extra field is not an error, because a definition written against a later
 * engine is data this one does not understand rather than data that is wrong.
 */
function checkShape(value: unknown): readonly SpellDefinitionProblem[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ field: '', code: 'not_a_definition', reason: 'a spell definition is an object' }];
  }

  const found: SpellDefinitionProblem[] = [];
  const d = value as Record<string, unknown>;

  const requireType = (field: string, type: 'string' | 'number' | 'boolean'): boolean => {
    if (typeof d[field] !== type) {
      found.push({
        field,
        code: 'missing_field',
        reason: `every definition carries a ${type} ${field}`,
      });
      return false;
    }
    return true;
  };

  requireType('id', 'string');
  requireType('name', 'string');
  requireType('level', 'number');
  requireType('school', 'string');
  requireType('castingTime', 'string');
  requireType('concentration', 'boolean');

  const range = d['range'];
  if (typeof range !== 'object' || range === null || typeof (range as { kind?: unknown }).kind !== 'string') {
    found.push({ field: 'range', code: 'missing_field', reason: 'every definition carries a range' });
  }

  const targets = d['targets'];
  if (
    typeof targets !== 'object' ||
    targets === null ||
    typeof (targets as { count?: unknown }).count !== 'number'
  ) {
    found.push({
      field: 'targets',
      code: 'missing_field',
      reason: 'every definition carries a target rule with a count',
    });
  }

  const effects = d['effects'];
  if (!Array.isArray(effects)) {
    found.push({
      field: 'effects',
      code: 'missing_field',
      reason: 'every definition carries an effect list, empty for a tracked spell',
    });
  } else {
    effects.forEach((effect, i) => {
      if (typeof effect !== 'object' || effect === null) {
        found.push({
          field: `effects[${i}]`,
          code: 'not_an_effect',
          reason: 'an effect is an object naming its kind',
        });
        return;
      }
      const kind = (effect as { kind?: unknown }).kind;
      if (typeof kind !== 'string' || !EFFECT_KINDS.has(kind)) {
        found.push({
          field: `effects[${i}].kind`,
          code: 'unknown_effect',
          reason: `"${String(kind)}" is not an effect the engine resolves`,
        });
      }
      checkNoNestedEffect(effect, `effects[${i}]`, found);
    });
  }

  return found;
}

/**
 * The invariant the whole rider design rests on: **a rider is a leaf.**
 *
 * A consequence that rolls a d20 is not a consequence, it is a second
 * resolution — and the moment one is allowed the definition format stops being
 * data and becomes a small untyped program, with a saving throw nested inside
 * a saving throw. `onFail: SpellEffect[]` was rejected for exactly that, and
 * this is where the rejection is enforced against input the compiler never
 * saw.
 *
 * **A denylist rather than an allowlist**, which is the same reading
 * `checkShape` already takes everywhere else: a field the engine does not know
 * is data written against a later version rather than data that is wrong. What
 * is refused is the handful of fields that *would* make a nested object a
 * parent — an effect list, a target list, an area, or a `kind` this engine
 * dispatches effects on. A `ModifierRider`'s `bonus` and `mode` are not among
 * them, which one assertion in `spell-schema.test.ts` pins rather than trusts.
 *
 * Depth is bounded, and not for safety: a rider is one object deep by
 * construction and the deepest legal nesting in the whole format is an
 * effect's rider's selector. A definition that goes deeper has stopped being
 * the thing this validates, and reporting that is more useful than recursing
 * into it.
 */
function checkNoNestedEffect(
  value: unknown,
  path: string,
  found: SpellDefinitionProblem[],
  depth = 0,
): void {
  if (typeof value !== 'object' || value === null) return;

  if (depth > RIDER_DEPTH_LIMIT) {
    found.push({
      field: path,
      code: 'effect_too_deep',
      reason: `an effect and its riders are at most ${RIDER_DEPTH_LIMIT} objects deep; anything below that is a nested program rather than data`,
    });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, i) => checkNoNestedEffect(entry, `${path}[${i}]`, found, depth + 1));
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (depth > 0 && FORBIDDEN_BELOW_AN_EFFECT.has(key)) {
      found.push({
        field: `${path}.${key}`,
        code: 'nested_effect',
        reason: `a rider is a leaf: it rolls no d20, names no target and has no area, so "${key}" cannot appear below an effect`,
      });
      continue;
    }
    if (depth > 0 && key === 'kind' && typeof entry === 'string' && EFFECT_KINDS.has(entry)) {
      found.push({
        field: `${path}.kind`,
        code: 'nested_effect',
        reason: `a rider is a leaf, so "${entry}" — an effect the engine resolves — cannot appear below an effect`,
      });
      continue;
    }
    checkNoNestedEffect(entry, `${path}.${key}`, found, depth + 1);
  }
}

/**
 * What makes a nested object a parent rather than a leaf.
 *
 * Each names a thing only a resolution has: its own consequences, its own
 * targets, its own geometry. Nothing legal inside an effect carries one —
 * `area` and `targets` are the *definition's*, and `effects` belongs to a
 * definition, an activation or an area trigger.
 */
const FORBIDDEN_BELOW_AN_EFFECT: ReadonlySet<string> = new Set([
  'effects',
  'targets',
  'targetsWithin',
  'area',
]);

/** An effect, its rider, and the rider's own selector: three, and a little air. */
const RIDER_DEPTH_LIMIT = 6;

/**
 * The kinds a rider may be, as a set.
 *
 * The sibling of {@link EFFECT_KINDS}, and the reason it is written down is
 * that the two must never intersect: a value that is both a rider kind and an
 * effect kind is the recursion this design exists to refuse, arriving through
 * a name collision rather than through a type. `spell-schema.test.ts` asserts
 * the intersection is empty.
 */
export const RIDER_KINDS: ReadonlySet<string> = new Set(['bonus', 'mode']);

/**
 * The effect kinds, as a set.
 *
 * The one place a runtime value restates the union, and it is here rather than
 * anywhere the rules live: the rules switch on `effect.kind` and the compiler
 * makes that exhaustive, while untyped input needs the vocabulary as data. A
 * member added to the union without being added here is caught by
 * `spell-schema.test.ts`, which drives every kind the catalogue uses through
 * this function.
 */
export const EFFECT_KINDS: ReadonlySet<string> = new Set([
  'attack',
  'save-damage',
  'temp-hp',
  'buff',
  'heal',
  'attack-damage',
  'save',
  'condition',
  'end-condition',
  'dispel',
  'interrupt-casting',
  'armor-class',
  'roll-mode',
  'damage-defense',
]);
