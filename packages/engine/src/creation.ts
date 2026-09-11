import {
  ABILITIES,
  SKILLS,
  err,
  ok,
  type Ability,
  type CharacterId,
  type Result,
  type Skill,
} from '@ie/shared';
import { abilityModifier, proficiencyBonusForLevel, type CharacterSheet } from './character.js';
import type { GameEvent, GameState } from './events.js';
import {
  BACKGROUNDS,
  POINT_BUY_BUDGET,
  POINT_COSTS,
  SPECIES,
  STANDARD_ARRAY,
  backgroundById,
  speciesById,
  type BackgroundDefinition,
  type SpeciesDefinition,
} from './origins.js';
import {
  MAX_LEVEL,
  cumulativeFeatures,
  rowAt,
  slotsAt,
  type ClassDefinition,
  type EquipmentEntry,
  type FeatureDefinition,
  type SubclassDefinition,
} from './progression.js';
import { spellSlotKey } from './resources.js';
import { hitDieKey } from './rest.js';
import { WIZARD, WIZARD_SUBCLASSES } from './wizard.js';

/**
 * Character creation: choices in, a validated character out.
 *
 * The three jobs `progression.ts` describes stay apart here. Progression says
 * what a level grants; this file turns choices into a character and refuses
 * the ones that are not legal; execution of a feature happens elsewhere or,
 * where it happens nowhere yet, the feature says so.
 *
 * **The choices are the character.** They are stored on the creature, so the
 * sheet can be rebuilt from them exactly, and so advancing a level is a matter
 * of adding to a record rather than rebuilding a creature and losing every
 * wound, condition and spent slot it had.
 *
 * Validation returns *every* problem, not the first. A caller filling in a
 * character does not want to be told about one mistake at a time.
 */

const CLASSES: readonly ClassDefinition[] = [WIZARD];
const SUBCLASSES: readonly SubclassDefinition[] = [...WIZARD_SUBCLASSES];

export const classById = (id: string): ClassDefinition | null =>
  CLASSES.find((c) => c.id === id) ?? null;

export const subclassById = (id: string): SubclassDefinition | null =>
  SUBCLASSES.find((s) => s.id === id) ?? null;

export type AbilityMethod = 'standard-array' | 'point-buy' | 'manual';

export interface AbilityChoice {
  readonly method: AbilityMethod;
  /** Scores as generated, before the background's increases. */
  readonly assignment: Readonly<Record<Ability, number>>;
}

export type HitPointChoice =
  /** SRD Fixed Hit Points by Class: the average, rounded up. */
  | { readonly method: 'fixed' }
  /** One roll per level after the first; level 1 is always the maximum die. */
  | { readonly method: 'rolled'; readonly rolls: readonly number[] };

export interface CharacterChoices {
  readonly name: string;
  readonly classId: string;
  readonly level: number;
  readonly speciesId: string;
  readonly backgroundId: string;
  readonly abilities: AbilityChoice;
  /** SRD: one ability by 2 and another by 1, or all three by 1. */
  readonly abilityIncreases: Readonly<Partial<Record<Ability, number>>>;
  readonly classSkills: readonly Skill[];
  readonly subclassId?: string | undefined;
  readonly cantrips: readonly string[];
  readonly spellbook: readonly string[];
  readonly preparedSpells: readonly string[];
  /** Which starting-equipment package, by the SRD's own label. */
  readonly classEquipment: string;
  readonly backgroundEquipment: string;
  readonly hitPoints: HitPointChoice;
  /** Choices a feature asks for, keyed by feature id. */
  readonly featureChoices: Readonly<Record<string, readonly string[]>>;
}

export interface CreationProblem {
  readonly code: string;
  readonly reason: string;
  /** The choice at fault, for a caller pointing at a form field. */
  readonly field: string;
}

export interface CharacterPlan {
  readonly sheet: CharacterSheet;
  readonly proficiencyBonus: number;
  readonly hitPointMaximum: number;
  readonly hitDie: number;
  readonly spellSlots: Readonly<Record<number, number>>;
  readonly cantrips: readonly string[];
  readonly spellbook: readonly string[];
  readonly preparedSpells: readonly string[];
  readonly equipment: readonly EquipmentEntry[];
  readonly goldPieces: number;
  readonly toolProficiencies: readonly string[];
  /** Every feature the character has, each saying whether the engine runs it. */
  readonly features: readonly FeatureDefinition[];
  /** Feat names, recorded rather than executed. */
  readonly feats: readonly string[];
}

/** What is stored on the creature so the character can be rebuilt. */
export interface CharacterRecord {
  readonly classId: string;
  readonly subclassId: string | null;
  readonly speciesId: string;
  readonly backgroundId: string;
  readonly level: number;
  readonly choices: CharacterChoices;
}

const problem = (code: string, field: string, reason: string): CreationProblem => ({
  code,
  field,
  reason,
});

// — the pieces, each checked on its own ————————————————————————————————————

interface Parts {
  readonly definition: ClassDefinition;
  readonly species: SpeciesDefinition;
  readonly background: BackgroundDefinition;
  readonly subclass: SubclassDefinition | null;
}

function resolveParts(choices: CharacterChoices): { parts: Parts | null; problems: CreationProblem[] } {
  const problems: CreationProblem[] = [];

  const definition = classById(choices.classId);
  if (definition === null) {
    problems.push(
      problem('unknown_class', 'classId', `no class called ${choices.classId}; have ${CLASSES.map((c) => c.id).join(', ')}`),
    );
  }
  const species = speciesById(choices.speciesId);
  if (species === null) {
    problems.push(
      problem('unknown_species', 'speciesId', `no species called ${choices.speciesId}; have ${SPECIES.map((s) => s.id).join(', ')}`),
    );
  }
  const background = backgroundById(choices.backgroundId);
  if (background === null) {
    problems.push(
      problem('unknown_background', 'backgroundId', `no background called ${choices.backgroundId}; have ${BACKGROUNDS.map((b) => b.id).join(', ')}`),
    );
  }

  if (!Number.isInteger(choices.level) || choices.level < 1 || choices.level > MAX_LEVEL) {
    problems.push(
      problem('bad_level', 'level', `a level runs from 1 to ${MAX_LEVEL}, got ${choices.level}`),
    );
  }

  let subclass: SubclassDefinition | null = null;
  if (definition !== null && choices.level >= 1 && choices.level <= MAX_LEVEL) {
    const due = choices.level >= definition.subclassLevel;
    if (choices.subclassId === undefined) {
      if (due) {
        problems.push(
          problem('subclass_required', 'subclassId', `a ${definition.name} chooses a subclass at level ${definition.subclassLevel}`),
        );
      }
    } else if (!due) {
      problems.push(
        problem('subclass_too_early', 'subclassId', `a ${definition.name} has no subclass until level ${definition.subclassLevel}`),
      );
    } else {
      subclass = subclassById(choices.subclassId);
      if (subclass === null || subclass.classId !== definition.id) {
        problems.push(
          problem('unknown_subclass', 'subclassId', `no ${definition.name} subclass called ${choices.subclassId}`),
        );
        subclass = null;
      }
    }
  }

  if (definition === null || species === null || background === null) {
    return { parts: null, problems };
  }
  return { parts: { definition, species, background, subclass }, problems };
}

/** SRD: increase one by 2 and another by 1, or all three by 1. */
function checkAbilities(
  choices: CharacterChoices,
  background: BackgroundDefinition,
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const scores = choices.abilities.assignment;

  for (const ability of ABILITIES) {
    const score = scores[ability];
    if (!Number.isInteger(score) || score < 1 || score > 30) {
      problems.push(problem('bad_score', 'abilities', `${ability} must be a score from 1 to 30, got ${score}`));
    }
  }

  if (choices.abilities.method === 'standard-array') {
    const given = ABILITIES.map((a) => scores[a]).sort((a, b) => b - a);
    const expected = [...STANDARD_ARRAY].sort((a, b) => b - a);
    if (JSON.stringify(given) !== JSON.stringify(expected)) {
      problems.push(
        problem('not_standard_array', 'abilities', `the standard array is ${STANDARD_ARRAY.join(', ')}`),
      );
    }
  }

  if (choices.abilities.method === 'point-buy') {
    let spent = 0;
    for (const ability of ABILITIES) {
      const cost = POINT_COSTS[scores[ability]];
      if (cost === undefined) {
        problems.push(
          problem('score_out_of_range', 'abilities', `point buy runs from 8 to 15, got ${ability} ${scores[ability]}`),
        );
      } else {
        spent += cost;
      }
    }
    if (spent > POINT_BUY_BUDGET) {
      problems.push(
        problem('over_point_budget', 'abilities', `that spread costs ${spent} of ${POINT_BUY_BUDGET} points`),
      );
    }
  }

  const increases = Object.entries(choices.abilityIncreases).filter(([, n]) => n !== undefined);
  const amounts = increases.map(([, n]) => n ?? 0).sort((a, b) => b - a);
  const shape = JSON.stringify(amounts);
  if (shape !== JSON.stringify([2, 1]) && shape !== JSON.stringify([1, 1, 1])) {
    problems.push(
      problem('bad_ability_increase', 'abilityIncreases', 'a background raises one ability by 2 and another by 1, or all three by 1'),
    );
  }

  for (const [ability, amount] of increases) {
    if (!background.abilities.includes(ability as Ability)) {
      problems.push(
        problem('ability_not_offered', 'abilityIncreases', `${background.name} offers ${background.abilities.join(', ')}, not ${ability}`),
      );
      continue;
    }
    const total = (scores[ability as Ability] ?? 0) + (amount ?? 0);
    if (total > 20) {
      problems.push(
        problem('score_above_twenty', 'abilityIncreases', `raising ${ability} to ${total} passes the limit of 20`),
      );
    }
  }

  return problems;
}

const finalScores = (choices: CharacterChoices): Record<Ability, number> => {
  const scores = { ...choices.abilities.assignment } as Record<Ability, number>;
  for (const ability of ABILITIES) {
    scores[ability] = (scores[ability] ?? 10) + (choices.abilityIncreases[ability] ?? 0);
  }
  return scores;
};

function checkSkills(choices: CharacterChoices, definition: ClassDefinition): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const { choose, from } = definition.skillChoices;

  if (choices.classSkills.length !== choose) {
    problems.push(
      problem('wrong_skill_count', 'classSkills', `a ${definition.name} chooses ${choose} skills, got ${choices.classSkills.length}`),
    );
  }
  if (new Set(choices.classSkills).size !== choices.classSkills.length) {
    problems.push(problem('duplicate_skill', 'classSkills', 'the same skill was chosen twice'));
  }
  for (const skill of choices.classSkills) {
    if (!from.includes(skill)) {
      problems.push(
        problem('skill_not_offered', 'classSkills', `a ${definition.name} may choose ${from.join(', ')}, not ${skill}`),
      );
    }
  }
  return problems;
}

/** Every feature the character has, from all four sources. */
function grantedFeatures(choices: CharacterChoices, parts: Parts): readonly FeatureDefinition[] {
  return [
    ...cumulativeFeatures(parts.definition, choices.level),
    ...(parts.subclass === null ? [] : cumulativeFeatures(parts.subclass, choices.level)),
    ...cumulativeFeatures(parts.species, choices.level),
    ...cumulativeFeatures(parts.background, choices.level),
  ];
}

function checkFeatureChoices(
  choices: CharacterChoices,
  features: readonly FeatureDefinition[],
  proficient: ReadonlySet<Skill>,
): CreationProblem[] {
  const problems: CreationProblem[] = [];

  for (const feature of features) {
    const asked = feature.choice;
    if (asked === undefined || asked.kind === 'subclass') continue;

    const made = choices.featureChoices[feature.id];
    if (made === undefined || made.length !== asked.choose) {
      problems.push(
        problem('missing_feature_choice', 'featureChoices', `${feature.id} (${feature.name}) needs ${asked.choose} choice(s)`),
      );
      continue;
    }

    if (asked.kind === 'skill') {
      for (const picked of made) {
        if (!(SKILLS as readonly string[]).includes(picked)) {
          problems.push(
            problem('unknown_skill', 'featureChoices', `${picked} is not a skill`),
          );
          continue;
        }
        if (asked.from !== undefined && !asked.from.includes(picked as Skill)) {
          problems.push(
            problem('skill_not_offered', 'featureChoices', `${feature.name} offers ${asked.from.join(', ')}, not ${picked}`),
          );
        }
        // SRD Scholar: "Choose one of the following skills **in which you have
        // proficiency**." Expertise without proficiency is not a thing.
        if (feature.id === 'wizard:scholar' && !proficient.has(picked as Skill)) {
          problems.push(
            problem('expertise_without_proficiency', 'featureChoices', `${feature.name} needs proficiency in ${picked} first`),
          );
        }
      }
    }
  }

  return problems;
}

function checkSpells(
  choices: CharacterChoices,
  definition: ClassDefinition,
  extraBookSpells: readonly string[],
): CreationProblem[] {
  const problems: CreationProblem[] = [];
  const row = rowAt(definition, choices.level);
  if (!row.ok) return problems;

  const cantrips = row.value.cantripsKnown ?? 0;
  if (choices.cantrips.length !== cantrips) {
    problems.push(
      problem('wrong_cantrip_count', 'cantrips', `a level ${choices.level} ${definition.name} knows ${cantrips} cantrips, got ${choices.cantrips.length}`),
    );
  }

  // SRD: the spellbook "starts with six level 1 Wizard spells of your choice",
  // and gains two more per level after the first.
  const expectedBook = 6 + Math.max(0, choices.level - 1) * 2;
  if (choices.spellbook.length !== expectedBook) {
    problems.push(
      problem('wrong_spellbook_count', 'spellbook', `a level ${choices.level} ${definition.name} writes ${expectedBook} spells, got ${choices.spellbook.length}`),
    );
  }

  const prepared = row.value.preparedSpells ?? 0;
  if (choices.preparedSpells.length !== prepared) {
    problems.push(
      problem('wrong_prepared_count', 'preparedSpells', `a level ${choices.level} ${definition.name} prepares ${prepared} spells, got ${choices.preparedSpells.length}`),
    );
  }

  const book = new Set([...choices.spellbook, ...extraBookSpells]);
  for (const spell of choices.preparedSpells) {
    if (!book.has(spell)) {
      problems.push(
        problem('spell_not_in_spellbook', 'preparedSpells', `${spell} is not in the spellbook`),
      );
    }
  }

  return problems;
}

function equipmentFrom(
  packages: readonly { option: string; items: readonly EquipmentEntry[]; goldPieces: number }[],
  option: string,
  field: string,
): Result<{ items: readonly EquipmentEntry[]; goldPieces: number }> {
  const chosen = packages.find((p) => p.option === option);
  if (chosen === undefined) {
    return err(
      'unknown_equipment_option',
      `${field}: no package ${option}; have ${packages.map((p) => p.option).join(' or ')}`,
    );
  }
  return ok({ items: chosen.items, goldPieces: chosen.goldPieces });
}

/**
 * SRD: level 1 grants the maximum die; later levels the fixed value or a roll,
 * plus the Constitution modifier, "minimum of 1" per level.
 */
export function hitPointsFor(
  definition: ClassDefinition,
  level: number,
  constitution: number,
  hitPoints: HitPointChoice,
): number {
  const fixed = Math.floor(definition.hitDie / 2) + 1;
  let total = definition.hitDie + constitution;

  for (let gained = 2; gained <= level; gained += 1) {
    const die =
      hitPoints.method === 'rolled' ? (hitPoints.rolls[gained - 2] ?? fixed) : fixed;
    total += Math.max(1, die + constitution);
  }

  return Math.max(1, total);
}

/** Every problem with a set of choices, so a caller can show them all at once. */
export function checkCharacter(choices: CharacterChoices): readonly CreationProblem[] {
  const { parts, problems } = resolveParts(choices);
  if (parts === null) return problems;

  const all = [...problems, ...checkAbilities(choices, parts.background), ...checkSkills(choices, parts.definition)];

  const proficient = new Set<Skill>([
    ...choices.classSkills,
    ...parts.background.skillProficiencies,
    ...((choices.featureChoices['human:skillful'] ?? []) as readonly Skill[]),
  ]);

  const features = grantedFeatures(choices, parts);
  all.push(...checkFeatureChoices(choices, features, proficient));

  const savant = choices.featureChoices['evoker:evocation-savant'] ?? [];
  all.push(...checkSpells(choices, parts.definition, savant));

  for (const [packages, option, field] of [
    [parts.definition.startingEquipment, choices.classEquipment, 'classEquipment'],
    [parts.background.startingEquipment, choices.backgroundEquipment, 'backgroundEquipment'],
  ] as const) {
    const resolved = equipmentFrom(packages, option, field);
    if (!resolved.ok) all.push(problem(resolved.code, field, resolved.reason));
  }

  if (choices.name.trim() === '') {
    all.push(problem('no_name', 'name', 'a character needs a name'));
  }

  return all;
}

/**
 * Turn choices into everything derived from them, or refuse.
 *
 * The first problem is returned as the error, because `Result` carries one —
 * `checkCharacter` is there for a caller that wants the whole list.
 */
export function planCharacter(choices: CharacterChoices): Result<CharacterPlan> {
  const problems = checkCharacter(choices);
  const first = problems[0];
  if (first !== undefined) return err(first.code, `${first.field}: ${first.reason}`);

  const { parts } = resolveParts(choices);
  if (parts === null) return err('unknown_class', 'the character has no class');
  const { definition, species, background } = parts;

  const scores = finalScores(choices);
  const features = grantedFeatures(choices, parts);

  const expertise = new Set(choices.featureChoices['wizard:scholar'] ?? []);
  const skills: Partial<Record<Skill, 'proficient' | 'expertise'>> = {};
  for (const skill of [
    ...choices.classSkills,
    ...background.skillProficiencies,
    ...((choices.featureChoices['human:skillful'] ?? []) as readonly Skill[]),
  ]) {
    skills[skill] = expertise.has(skill) ? 'expertise' : 'proficient';
  }

  const sheet: CharacterSheet = {
    level: choices.level,
    abilities: scores,
    skills,
    saveProficiencies: definition.saveProficiencies,
    armor: null,
    shield: null,
    armorTraining: definition.armorTraining,
    baseSpeed: species.speed,
    spellcastingAbility: definition.primaryAbility,
  };

  const classKit = equipmentFrom(definition.startingEquipment, choices.classEquipment, 'classEquipment');
  const backgroundKit = equipmentFrom(background.startingEquipment, choices.backgroundEquipment, 'backgroundEquipment');
  if (!classKit.ok) return classKit;
  if (!backgroundKit.ok) return backgroundKit;

  const savant = choices.featureChoices['evoker:evocation-savant'] ?? [];

  return ok({
    sheet,
    proficiencyBonus: proficiencyBonusForLevel(choices.level),
    hitPointMaximum: hitPointsFor(definition, choices.level, abilityModifier(scores.con), choices.hitPoints),
    hitDie: definition.hitDie,
    spellSlots: slotsAt(definition, choices.level),
    cantrips: choices.cantrips,
    // The Evoker's free Evocation spells are written into the book itself.
    spellbook: [...choices.spellbook, ...savant],
    preparedSpells: choices.preparedSpells,
    equipment: [...classKit.value.items, ...backgroundKit.value.items],
    goldPieces: classKit.value.goldPieces + backgroundKit.value.goldPieces,
    toolProficiencies: [background.toolProficiency],
    features,
    feats: [
      background.feat,
      ...(choices.featureChoices['human:versatile'] ?? []),
      ...(choices.featureChoices['wizard:epic-boon'] ?? []),
    ],
  });
}

/** The pools a character of this class and level has. */
function poolEvents(
  id: CharacterId,
  definition: ClassDefinition,
  plan: CharacterPlan,
  level: number,
  features: readonly FeatureDefinition[],
): GameEvent[] {
  const events: GameEvent[] = [
    {
      type: 'resource-pool-declared',
      id,
      pool: {
        key: hitDieKey(definition.hitDie),
        label: `Hit Die (d${definition.hitDie})`,
        max: level,
        recovers: 'long-rest',
      },
    },
  ];

  for (const [slotLevel, count] of Object.entries(plan.spellSlots)) {
    events.push({
      type: 'resource-pool-declared',
      id,
      pool: {
        key: spellSlotKey(Number(slotLevel)),
        label: `level ${slotLevel} spell slot`,
        max: count,
        recovers: 'long-rest',
      },
    });
  }

  // A feature that is its own limited resource declares its pool. Arcane
  // Recovery is the only one at this level; the list is data, not a special case.
  if (features.some((f) => f.id === 'wizard:arcane-recovery')) {
    events.push({
      type: 'resource-pool-declared',
      id,
      pool: {
        key: 'wizard:arcane-recovery',
        label: 'Arcane Recovery',
        max: 1,
        recovers: 'long-rest',
      },
    });
  }

  return events;
}

/** Create a character: the creature, its pools, and the choices that made it. */
export function createCharacter(
  choices: CharacterChoices,
  id: CharacterId,
): Result<GameEvent[]> {
  const plan = planCharacter(choices);
  if (!plan.ok) return plan;

  const definition = classById(choices.classId);
  if (definition === null) return err('unknown_class', `no class called ${choices.classId}`);

  return ok([
    {
      type: 'creature-added',
      id,
      name: choices.name,
      sheet: plan.value.sheet,
      maxHp: plan.value.hitPointMaximum,
    },
    {
      type: 'character-created',
      id,
      record: {
        classId: choices.classId,
        subclassId: choices.subclassId ?? null,
        speciesId: choices.speciesId,
        backgroundId: choices.backgroundId,
        level: choices.level,
        choices,
      },
    },
    ...poolEvents(id, definition, plan.value, choices.level, plan.value.features),
  ]);
}

/** What a level-up asks for, on top of what the character already chose. */
export interface AdvanceChoices {
  readonly subclassId?: string;
  readonly cantrips?: readonly string[];
  readonly spellbook?: readonly string[];
  readonly preparedSpells?: readonly string[];
  readonly hitPointRoll?: number;
  readonly featureChoices?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Gain a level, keeping everything the character currently is.
 *
 * Emphatically *not* a rebuild. A wizard who levels up mid-dungeon keeps their
 * wounds, their conditions and the slots they have already spent — so this
 * emits the differences: the new hit points, the pools that grew, the choices
 * that changed. Re-creating the creature would silently heal them and refill
 * everything, which is the kind of bug nobody notices until a boss fight.
 */
export function advanceCharacter(
  state: GameState,
  id: CharacterId,
  advance: AdvanceChoices,
): Result<GameEvent[]> {
  const creature = state.creatures[id];
  if (creature === undefined) return err('unknown_creature', `${id} is not in this game`);

  const record = creature.character;
  if (record === null || record === undefined) {
    return err('not_a_character', `${id} was not created from character choices`);
  }

  const level = record.level + 1;
  if (level > MAX_LEVEL) {
    return err('bad_level', `${id} is already level ${MAX_LEVEL}`);
  }

  const choices: CharacterChoices = {
    ...record.choices,
    level,
    ...(advance.subclassId === undefined ? {} : { subclassId: advance.subclassId }),
    ...(advance.cantrips === undefined ? {} : { cantrips: advance.cantrips }),
    ...(advance.spellbook === undefined
      ? { spellbook: grownSpellbook(record.choices.spellbook, level) }
      : { spellbook: advance.spellbook }),
    ...(advance.preparedSpells === undefined ? {} : { preparedSpells: advance.preparedSpells }),
    ...(advance.hitPointRoll === undefined
      ? {}
      : { hitPoints: rollsFor(record.choices.hitPoints, level, advance.hitPointRoll) }),
    featureChoices: { ...record.choices.featureChoices, ...(advance.featureChoices ?? {}) },
  };

  const plan = planCharacter(choices);
  if (!plan.ok) return plan;

  const definition = classById(choices.classId);
  if (definition === null) return err('unknown_class', `no class called ${choices.classId}`);

  const events: GameEvent[] = [];

  const gained = plan.value.hitPointMaximum - creature.vitals.hpMax;
  if (gained > 0) events.push({ type: 'hit-point-maximum-raised', id, amount: gained });

  // Pools that already exist grow; pools that did not exist are declared. Both
  // leave what has been spent alone.
  const hitDice = hitDieKey(definition.hitDie);
  events.push({ type: 'resource-pool-resized', id, key: hitDice, max: level });

  for (const [slotLevel, count] of Object.entries(plan.value.spellSlots)) {
    const key = spellSlotKey(Number(slotLevel));
    events.push(
      creature.resources.pools[key] === undefined
        ? {
            type: 'resource-pool-declared',
            id,
            pool: { key, label: `level ${slotLevel} spell slot`, max: count, recovers: 'long-rest' },
          }
        : { type: 'resource-pool-resized', id, key, max: count },
    );
  }

  events.push({
    type: 'character-advanced',
    id,
    record: {
      classId: choices.classId,
      subclassId: choices.subclassId ?? null,
      speciesId: choices.speciesId,
      backgroundId: choices.backgroundId,
      level,
      choices,
    },
    sheet: plan.value.sheet,
  });

  return ok(events);
}

/** SRD: "Whenever you gain a Wizard level after 1, add two Wizard spells." */
const grownSpellbook = (book: readonly string[], level: number): readonly string[] => {
  const wanted = 6 + Math.max(0, level - 1) * 2;
  const grown = [...book];
  let n = 1;
  while (grown.length < wanted) {
    grown.push(`Unnamed research ${n}`);
    n += 1;
  }
  return grown;
};

const rollsFor = (current: HitPointChoice, level: number, roll: number): HitPointChoice => {
  const rolls = current.method === 'rolled' ? [...current.rolls] : [];
  rolls[level - 2] = roll;
  return { method: 'rolled', rolls };
};
