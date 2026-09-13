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
import type {
  DiceScaling,
  SpellArea,
  SpellDefinition,
  SpellEffect,
} from './spell-definitions.js';

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

/** One effect, wherever it was found: the spell's own list, an activation, a trigger. */
function checkEffect(
  effect: SpellEffect,
  level: number,
  path: string,
  found: SpellDefinitionProblem[],
): void {
  switch (effect.kind) {
    case 'attack':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      if (effect.condition !== undefined) {
        checkCondition(effect.condition.name, `${path}.condition.name`, found);
      }
      if (effect.delayed !== undefined) {
        checkScaling(effect.delayed.damage, level, `${path}.delayed.damage`, found);
        checkDamageType(effect.delayed.damageType, `${path}.delayed.damageType`, found);
      }
      return;

    case 'save-damage':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      (effect.plus ?? []).forEach((extra, i) => {
        checkScaling(extra.damage, level, `${path}.plus[${i}].damage`, found);
        checkDamageType(extra.damageType, `${path}.plus[${i}].damageType`, found);
      });
      if (effect.condition !== undefined) {
        checkCondition(effect.condition.name, `${path}.condition.name`, found);
      }
      if (effect.delayed !== undefined) {
        checkScaling(effect.delayed.damage, level, `${path}.delayed.damage`, found);
        checkDamageType(effect.delayed.damageType, `${path}.delayed.damageType`, found);
      }
      return;

    case 'attack-damage':
      checkScaling(effect.damage, level, `${path}.damage`, found);
      checkDamageType(effect.damageType, `${path}.damageType`, found);
      return;

    case 'save':
      checkCondition(effect.condition, `${path}.condition`, found);
      return;

    case 'heal':
      checkScaling(effect.healing, level, `${path}.healing`, found);
      return;

    case 'temp-hp':
      checkScaling(effect.amount, level, `${path}.amount`, found);
      return;

    case 'buff':
      if (effect.bonus.dice !== undefined && !parseNotation(effect.bonus.dice).ok) {
        found.push({
          field: `${path}.bonus.dice`,
          code: 'bad_dice',
          reason: `"${effect.bonus.dice}" is not dice notation`,
        });
      }
      // SRD writes no rolled Armour Class and there is no moment at which a die
      // could be thrown for a standing number, so `armorClassOf` reads only the
      // flat half. A rolled bonus aimed at `ac` is therefore data nothing can
      // apply — silently, which is what makes it worth refusing here.
      if (effect.applies.includes('ac') && effect.bonus.dice !== undefined) {
        found.push({
          field: `${path}.bonus.dice`,
          code: 'rolled_armor_class',
          reason:
            'an Armour Class is a standing number rather than a roll, so only a flat bonus reaches one',
        });
      }
      if (effect.applies.length === 0) {
        found.push({
          field: `${path}.applies`,
          code: 'bonus_applies_to_nothing',
          reason: 'a bonus that applies to no kind of roll is a bonus nothing reads',
        });
      }
      return;

    case 'roll-mode': {
      // The selector's own coherence — an ability on a roll made with none, a
      // skill on a roll that uses none, a skill and an ability that disagree,
      // or "against the holder" on a roll the engine records no target for.
      // Every one of these compiles and then matches nothing for ever, or
      // matches far more than the spell says, which is what makes them worth
      // a refusal at authoring rather than a surprise at the table.
      const selector = effect.modifier.selector;
      if (!ROLL_FAMILIES.has(selector.roll)) {
        found.push({
          field: `${path}.modifier.selector.roll`,
          code: 'bad_roll_family',
          reason: `"${String(selector.roll)}" is not a kind of roll the engine makes`,
        });
      }
      if (selector.relation !== 'roller' && selector.relation !== 'against-holder') {
        found.push({
          field: `${path}.modifier.selector.relation`,
          code: 'bad_roll_relation',
          reason: `"${String(selector.relation)}" is not a relation; a mode is the roller's or it is on rolls against the holder`,
        });
      }
      if (effect.modifier.mode !== 'advantage' && effect.modifier.mode !== 'disadvantage') {
        found.push({
          field: `${path}.modifier.mode`,
          code: 'bad_roll_mode',
          reason: 'a granted mode is Advantage or Disadvantage; "normal" grants nothing',
        });
      }
      if (selector.ability !== undefined && !ABILITY_NAMES_SET.has(selector.ability)) {
        found.push({
          field: `${path}.modifier.selector.ability`,
          code: 'bad_ability',
          reason: `"${String(selector.ability)}" is not an ability`,
        });
      }
      if (selector.skill !== undefined && !SKILL_NAMES.has(selector.skill)) {
        found.push({
          field: `${path}.modifier.selector.skill`,
          code: 'bad_skill',
          reason: `"${String(selector.skill)}" is not a skill`,
        });
      }
      if (effect.save !== undefined && !ABILITY_NAMES_SET.has(effect.save)) {
        found.push({
          field: `${path}.save`,
          code: 'bad_ability',
          reason: `"${String(effect.save)}" is not an ability`,
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
        for (const problem of rollSelectorProblems(
          selector,
          (skill: Skill) => SKILL_ABILITY[skill],
        )) {
          found.push({ field: `${path}.modifier.selector`, ...problem });
        }
      }
      return;
    }

    case 'armor-class':
      if (!Number.isInteger(effect.base) || effect.base < 1) {
        found.push({
          field: `${path}.base`,
          code: 'bad_armor_class',
          reason: 'a base Armour Class is a whole number of at least 1',
        });
      }
      return;

    case 'dispel':
    case 'interrupt-casting':
      return;
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
  if (definition.check !== undefined && !lasts) {
    found.push({
      field: 'check',
      code: 'check_without_duration',
      reason: 'a check against the casting rides on its timer; an instantaneous spell has none',
    });
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
    });
  }

  return found;
}

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
const EFFECT_KINDS: ReadonlySet<string> = new Set([
  'attack',
  'save-damage',
  'temp-hp',
  'buff',
  'heal',
  'attack-damage',
  'save',
  'dispel',
  'interrupt-casting',
  'armor-class',
  'roll-mode',
]);
