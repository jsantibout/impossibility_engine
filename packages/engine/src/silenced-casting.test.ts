import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { featureGrants, type FeatureDefinition } from './progression.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { declaredCasting } from './spellcasting.js';
import type { CharacterSheet } from './character.js';
import type { Point } from './positioning.js';
import { remaining } from './resources.js';
import { resolveSpell } from './commands.js';

/**
 * SRD Silence: "Casting a spell that includes a Verbal component is impossible
 * there."
 *
 * **The half of that sentence a definition cannot answer.** `area-standing.test.ts`
 * drives the refusal against the spell's own marker — a Thunderwave refused
 * inside the Sphere, a Minor Illusion cast there because the book prints it no
 * V. What that file cannot reach is the other way a casting comes to include
 * no Verbal component: SRD Subtle Spell casts a spell "without any Verbal,
 * Somatic, or Material components", which is a fact about the **casting**
 * rather than about the spell, and reaching it needs a real Sorcerer with the
 * option on their sheet and the Sorcery Points to pay for it.
 *
 * So one fact arrives at the refusal — `CastCommand.noVerbalComponent`, set
 * from the definition's marker *or* from the option the casting bought — and
 * the refusal never learns that a metamagic exists.
 */

const id = (s: string) => asCharacterId(s);
const SORCERER = id('sorcerer');
const PRIEST = id('priest');
const TARGET = id('target');

const SKILLS = [
  'acrobatics',
  'animal-handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight-of-hand',
  'stealth',
  'survival',
];

const subclassFor = (classId: string): string =>
  SRD_CONTENT.subclasses.find((one) => one.classId === classId)!.id;

const onList = (classId: string, level: number): readonly string[] =>
  SRD_CONTENT.spells
    .filter(
      (spell) =>
        spell.level === level &&
        (SRD_CONTENT.spellEntry(spell.id)?.classes ?? []).includes(classId),
    )
    .map((spell) => spell.id);

const row = (classId: string, level: number) => SRD_CONTENT.classById(classId)!.table[level - 1]!;

const filled = (
  want: number,
  needs: readonly string[],
  pool: readonly string[],
): readonly string[] => {
  const out = [...needs.filter((spellId) => pool.includes(spellId))];
  for (const spellId of pool) {
    if (out.length >= want) break;
    if (!out.includes(spellId)) out.push(spellId);
  }
  return out.slice(0, want);
};

const cantripsFor = (classId: string, level: number, needs: readonly string[]): readonly string[] =>
  filled(row(classId, level).cantripsKnown ?? 0, needs, onList(classId, 0));

const levelled = (classId: string): readonly string[] => {
  const out: string[] = [];
  for (let spellLevel = 1; spellLevel <= 9; spellLevel += 1) out.push(...onList(classId, spellLevel));
  return out;
};

const preparedFor = (classId: string, level: number, needs: readonly string[]): readonly string[] =>
  filled(row(classId, level).preparedSpells ?? 0, needs, levelled(classId));

const featuresUpTo = (classId: string, level: number): readonly FeatureDefinition[] =>
  [
    ...(SRD_CONTENT.classById(classId)?.features ?? []),
    ...(SRD_CONTENT.subclassById(subclassFor(classId))?.features ?? []),
    ...(SRD_CONTENT.speciesById('human')?.features ?? []),
    ...(SRD_CONTENT.backgroundById('sage')?.features ?? []),
  ].filter((feature) => (feature.level ?? 1) <= level);

/** The first legal answer to every choice the plan asks, whatever they are. */
const autoChoices = (
  classId: string,
  level: number,
  taken: readonly string[],
): Record<string, readonly string[]> => {
  const out: Record<string, readonly string[]> = {};
  const used = new Set<string>(taken);
  for (const feature of featuresUpTo(classId, level)) {
    const choice = feature.choice;
    if (choice === undefined) continue;
    if (choice.kind === 'skill') {
      const expertise = featureGrants(feature).some((grant) => grant.kind === 'expertise');
      const from = expertise
        ? [...used]
        : (choice.from ?? SKILLS).filter((skill) => !used.has(skill));
      const picked = from.slice(0, choice.choose);
      if (!expertise) for (const skill of picked) used.add(skill);
      out[feature.id] = picked;
    } else if (choice.kind === 'option') {
      out[feature.id] = choice.from.slice(0, choice.choose);
    }
  }
  return out;
};

const improvementSlots = (classId: string, level: number): readonly string[] =>
  (SRD_CONTENT.classById(classId)?.features ?? [])
    .filter(
      (feature) =>
        feature.id.startsWith(`${classId}:ability-score-improvement`) && feature.level <= level,
    )
    .map((feature) => feature.id);

/** A level 3 Sorcerer who took Subtle Spell, and Fire Bolt among their cantrips. */
const sorcerer = (): CharacterChoices => {
  const classSkills = ['arcana', 'insight'];
  return {
    name: 'Vashti',
    classId: 'sorcerer',
    level: 3,
    subclassId: subclassFor('sorcerer'),
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: classSkills as never,
    languages: ['Draconic', 'Elvish'],
    alignment: 'Neutral',
    cantrips: cantripsFor('sorcerer', 3, ['fire-bolt']) as never,
    spellbook: [],
    preparedSpells: preparedFor('sorcerer', 3, ['thunderwave']),
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      ...autoChoices('sorcerer', 3, classSkills),
      'sorcerer:metamagic': ['Careful Spell', 'Subtle Spell'],
    } as never,
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'ray-of-frost'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      ...Object.fromEntries(
        improvementSlots('sorcerer', 3).map((slot) => [
          slot,
          { featId: 'ability-score-improvement', abilities: ['cha', 'cha'] },
        ]),
      ),
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  };
};

const priestSheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const dummy = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: true, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 },
  },
});

/**
 * The lane, measured against the engine's own ruler.
 *
 * A 20-foot-radius Sphere on the space at x = 500 covers a Medium creature out
 * to twenty feet; the Sorcerer stands at its centre and the priest who cast it
 * stands thirty feet out, which is outside.
 */
const CENTRE: Point = { x: 500, y: 500, z: 0 };
const SORCERER_AT: Point = { x: 500, y: 500, z: 0 };
const PRIEST_AT: Point = { x: 530, y: 500, z: 0 };
const TARGET_AT: Point = { x: 515, y: 500, z: 0 };

const SETUP: readonly GameEvent[] = [
  ...unwrap(createCharacter(SRD_CONTENT, sorcerer(), SORCERER), 'create'),
  {
    type: 'creature-added',
    id: PRIEST,
    name: PRIEST,
    sheet: priestSheet(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  {
    type: 'spellcasting-declared',
    id: PRIEST,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['silence'] }),
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: PRIEST,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  dummy(TARGET),
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 60 } },
  { type: 'creature-placed', id: SORCERER, placement: { from: { point: SORCERER_AT }, feet: 0 } },
  { type: 'creature-placed', id: PRIEST, placement: { from: { point: PRIEST_AT }, feet: 0 } },
  { type: 'creature-placed', id: TARGET, placement: { from: { point: TARGET_AT }, feet: 0 } },
  { type: 'sight-declared', from: SORCERER, to: TARGET, seen: true },
  { type: 'sight-declared', from: PRIEST, to: TARGET, seen: true },
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('seed') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

/** The Sphere, up and centred on the space the Sorcerer is standing in. */
const silenced = (): readonly GameEvent[] => {
  const state = fold('seed', SETUP);
  const cast = unwrap(
    resolveSpell(state, PRIEST, { spellId: 'silence', targets: [], at: CENTRE }, supply(state)),
    'the Sphere',
  );
  return [...SETUP, ...cast.events];
};

/** How many Sorcery Points are left, which is what the option is priced in. */
const points = (state: GameState): number =>
  remaining(state.creatures[SORCERER]!.resources, 'sorcery-points');

describe('a Verbal casting inside a Silence, and the option that has none', () => {
  it('refuses an ordinary Fire Bolt, which the book prints a V on', () => {
    const log = silenced();
    const state = fold('seed', log);
    const refused = resolveSpell(
      state,
      SORCERER,
      { spellId: 'fire-bolt', targets: [TARGET] },
      supply(state),
    );

    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('silenced');
  });

  it('lets the same Fire Bolt through when the casting bought Subtle Spell', () => {
    const log = silenced();
    const state = fold('seed', log);
    const subtle = resolveSpell(
      state,
      SORCERER,
      { spellId: 'fire-bolt', targets: [TARGET], usingOptions: ['subtle-spell'] },
      supply(state),
    );

    // SRD Subtle Spell: cast "without any Verbal, Somatic, or Material
    // components", so there is no Verbal component for the Sphere to make
    // impossible. One fact reaches the refusal and it never learns the option
    // exists.
    expect(isErr(subtle)).toBe(false);
    const out = unwrap(subtle, 'the Subtle Fire Bolt');
    // And the option really was bought, which is what makes the pass above the
    // metamagic rather than an accident: the point came out of the pool, in
    // the same batch as the casting.
    const after = fold('seed', [...log, ...out.events]);
    expect(points(state) - points(after)).toBe(1);
  });
});
