import { describe, expect, it } from 'vitest';
import { featureGrants } from './progression.js';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { castSpell, resolveDeclaredCast, resolveSpell } from './commands.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { remaining, spellSlotKey } from './resources.js';
import type { FeatureDefinition } from './progression.js';

/**
 * A feature that changes what a casting costs, driven end to end.
 *
 * SRD Metamagic is the shape: a menu of named options, each priced in a pool
 * some other feature declares, each rewriting **one** thing the casting
 * command works out before it spends anything — how far the spell reaches, how
 * long it lasts, which part of the turn it takes, and what level it counts as.
 *
 * | SRD option | What it alters | The number this file asserts |
 * |---|---|---|
 * | Distant Spell | the range | 30 feet becomes 60 |
 * | Extended Spell | the duration | 3,600 seconds becomes 7,200 |
 * | Quickened Spell | the casting time | an Action becomes a Bonus Action |
 * | Twinned Spell | the effective level | a level 1 slot casts it at level 2 |
 *
 * **One spell carries all four**, and that is deliberate rather than
 * convenient: SRD Charm Person is the spell the Twinned Spell entry names, it
 * has a range in feet, a duration of an hour, a casting time of an Action and
 * one more target per slot level — so every assertion below is the same
 * casting with one thing different, and a control without the option is beside
 * each of them.
 *
 * Every cost is asserted as a **number**: the Sorcery Points left in the pool,
 * the level of the slot that was spent, the feet the range reached, the
 * seconds the deadline was filed at.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const SECOND = id('second');

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

/**
 * A Sorcerer of the given level who took the named Metamagic options.
 *
 * The options are the one choice every test here writes by hand, because they
 * are the subject: `autoChoices` would take the first two on the alphabetical
 * menu and nothing below would be about the option it names.
 */
const sorcerer = (level: number, metamagic: readonly string[]): CharacterChoices => {
  const classSkills = ['arcana', 'insight'];
  // Every spell this file casts, so the prepared list the class table sizes
  // holds all of them: the four options are driven over Charm Person and the
  // refusals need a Self range, an Instantaneous spell, a Bonus Action spell
  // and one whose targets do not scale.
  const needs = ['charm-person', 'burning-hands', 'chromatic-orb', 'misty-step'];
  return {
    name: 'Vashti',
    classId: 'sorcerer',
    level,
    ...(level >= 3 ? { subclassId: subclassFor('sorcerer') } : {}),
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
    },
    // SRD Sage offers Constitution, Intelligence and Wisdom, and nothing here
    // reads a Charisma modifier: the options' costs are printed numbers.
    abilityIncreases: { con: 2, int: 1 },
    classSkills: classSkills as never,
    languages: ['Draconic', 'Elvish'],
    alignment: 'Neutral',
    cantrips: cantripsFor('sorcerer', level, []) as never,
    spellbook: [],
    preparedSpells: preparedFor('sorcerer', level, needs),
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      ...autoChoices('sorcerer', level, classSkills),
      'sorcerer:metamagic': metamagic,
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
        improvementSlots('sorcerer', level).map((slot) => [
          slot,
          { featId: 'ability-score-improvement', abilities: ['cha', 'cha'] },
        ]),
      ),
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  };
};

const sheetOf = (choices: CharacterChoices): CharacterSheet =>
  unwrap(planCharacter(SRD_CONTENT, choices), choices.classId).sheet;

/** A Humanoid with nothing of its own, so Charm Person may be aimed at it. */
const dummy = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  maxHp: 400,
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

/** The caster, two Humanoids at a stated distance, and a scene. */
const table = (
  choices: CharacterChoices,
  extra: readonly GameEvent[] = [],
  feet = 25,
): GameEvent[] => [
  ...unwrap(createCharacter(SRD_CONTENT, choices, CASTER), 'create'),
  dummy(TARGET),
  dummy(SECOND),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: CASTER }, feet, bearing: 0 },
  },
  {
    type: 'creature-placed',
    id: SECOND,
    placement: { from: { creature: CASTER }, feet, bearing: 90 },
  },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  { type: 'sight-declared', from: CASTER, to: SECOND, seen: true },
  ...extra,
];

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  content: SRD_CONTENT,
});

/** The whole request Charm Person needs, with the options under test. */
const charm = (
  options: readonly string[] | undefined,
  over: Record<string, unknown> = {},
): Parameters<typeof resolveSpell>[2] =>
  ({
    spellId: 'charm-person',
    targets: [TARGET],
    slotLevel: 1,
    // SRD Charm Person gives the save Advantage "if you or your allies are
    // fighting it", so the casting has to answer; nobody is.
    fought: [],
    ...(options === undefined ? {} : { usingOptions: options }),
    ...over,
  }) as Parameters<typeof resolveSpell>[2];

const attempt = (log: readonly GameEvent[], request: Parameters<typeof resolveSpell>[2]) => {
  const state = fold('seed', log);
  return resolveSpell(state, CASTER, request, supply(state));
};

const cast = (log: readonly GameEvent[], request: Parameters<typeof resolveSpell>[2]) => {
  const result = unwrap(attempt(log, request), 'cast');
  const after = [...log, ...result.events];
  return { log: after, state: fold('seed', after), outcome: result, events: result.events };
};

/** How many Sorcery Points are left, which is the cost every test asserts. */
const points = (state: GameState): number =>
  remaining(state.creatures[CASTER]!.resources, 'sorcery-points');

// — what the sheet carries ————————————————————————————————————————————

describe('Metamagic compiles the options the player chose onto the sheet', () => {
  it('carries the two chosen options and neither of the eight others', () => {
    const sheet = sheetOf(sorcerer(5, ['Distant Spell', 'Twinned Spell']));
    expect((sheet.castingOptions ?? []).map((option) => option.option)).toEqual([
      'distant-spell',
      'twinned-spell',
    ]);
    expect(sheet.castingOptions?.[0]).toMatchObject({
      feature: 'sorcerer:metamagic',
      featureName: 'Metamagic',
      name: 'Distant Spell',
      pool: 'sorcery-points',
      cost: 1,
      perCasting: 1,
      alters: { kind: 'range', multiplier: 2, touchBecomesFeet: 30 },
    });
  });

  /**
   * An option the player did not take is not on the sheet at all, which is the
   * whole of how a menu of ten becomes a menu of two.
   */
  it('leaves off an option whose name the player did not pick', () => {
    const sheet = sheetOf(sorcerer(5, ['Careful Spell', 'Subtle Spell']));
    expect(sheet.castingOptions ?? []).toEqual([]);
  });

  /** A Sorcerer 1 has no Metamagic, so there is nothing to elect. */
  it('gives a Sorcerer below level 2 nothing', () => {
    const sheet = sheetOf(sorcerer(1, []));
    expect(sheet.castingOptions).toBeUndefined();
  });

  /** The pool the options are priced in is the one Font of Magic declares. */
  it('starts a Sorcerer 5 with the five Sorcery Points the table prints', () => {
    const state = fold('seed', table(sorcerer(5, ['Distant Spell', 'Twinned Spell'])));
    expect(points(state)).toBe(5);
  });
});

// — Distant Spell: the range ——————————————————————————————————————————

describe('Distant Spell doubles the range', () => {
  const who = () => sorcerer(5, ['Distant Spell', 'Twinned Spell']);

  /** SRD Charm Person reaches 30 feet, and the target is standing at 50. */
  it('refuses the casting at 50 feet without the option', () => {
    const refused = attempt(table(who(), [], 50), charm(undefined));
    expect(isErr(refused)).toBe(true);
  });

  it('reaches 50 feet with it, and spends exactly one Sorcery Point', () => {
    const { state } = cast(table(who(), [], 50), charm(['distant-spell']));
    expect(points(state)).toBe(4);
  });

  /** 30 doubled is 60, so 65 feet is still out of range and still refused. */
  it('does not reach 65 feet, which is past twice the printed range', () => {
    const refused = attempt(table(who(), [], 65), charm(['distant-spell']));
    expect(isErr(refused)).toBe(true);
  });

  /** A refusal costs nothing: the point is spent inside the casting's batch. */
  it('spends no point on a casting it refuses', () => {
    const log = table(who(), [], 65);
    expect(isErr(attempt(log, charm(['distant-spell'])))).toBe(true);
    expect(points(fold('seed', log))).toBe(5);
  });

  /**
   * SRD: "when you cast a spell that has a range of at least 5 feet". A Range:
   * Self spell has no distance to double, so the option is refused rather than
   * costing a point for nothing — which is where an elected *option* parts
   * company with an elected feature, whose narrowing costs nothing to miss.
   */
  it('refuses a spell whose range is Self', () => {
    const refused = attempt(table(who()), {
      spellId: 'burning-hands',
      targets: [],
      at: { x: 100, y: 100, z: 0 },
      slotLevel: 1,
      usingOptions: ['distant-spell'],
    } as Parameters<typeof resolveSpell>[2]);
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });
});

// — Extended Spell: the duration ————————————————————————————————————————

describe('Extended Spell doubles the duration', () => {
  const who = () => sorcerer(5, ['Extended Spell', 'Twinned Spell']);

  /** The deadline the casting files is the number this rule is about. */
  const deadlineOf = (events: readonly GameEvent[]): number => {
    const filed = events.find(
      (event) => event.type === 'effect-scheduled' && event.target.kind === 'casting',
    );
    return filed !== undefined && filed.type === 'effect-scheduled' && filed.deadline.kind === 'elapsed'
      ? filed.deadline.at
      : -1;
  };

  it('files the printed hour without the option', () => {
    const { events } = cast(table(who()), charm(undefined));
    expect(deadlineOf(events)).toBe(3600);
  });

  it('files two hours with it, and spends exactly one Sorcery Point', () => {
    const { events, state } = cast(table(who()), charm(['extended-spell']));
    expect(deadlineOf(events)).toBe(7200);
    expect(points(state)).toBe(4);
  });

  /**
   * SRD: "a spell that has a duration of 1 minute or longer". An
   * Instantaneous spell has no span to double.
   */
  it('refuses a spell with no duration at all', () => {
    const refused = attempt(table(who()), {
      spellId: 'burning-hands',
      targets: [],
      at: { x: 100, y: 100, z: 0 },
      slotLevel: 1,
      usingOptions: ['extended-spell'],
    } as Parameters<typeof resolveSpell>[2]);
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });
});

// — Quickened Spell: the casting time ——————————————————————————————————

describe('Quickened Spell makes an Action a Bonus Action', () => {
  const who = () => sorcerer(5, ['Quickened Spell', 'Twinned Spell']);
  const fight: GameEvent = {
    type: 'combat-started',
    combatants: [
      { id: CASTER, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 10, speed: 30 },
    ],
  };

  it('spends the Action without the option', () => {
    const { events } = cast(table(who(), [fight]), charm(undefined));
    expect(events.map((event) => event.type)).toContain('action-spent');
    expect(events.map((event) => event.type)).not.toContain('bonus-action-spent');
  });

  it('spends the Bonus Action with it, and two Sorcery Points', () => {
    const { events, state } = cast(table(who(), [fight]), charm(['quickened-spell']));
    expect(events.map((event) => event.type)).toContain('bonus-action-spent');
    expect(events.map((event) => event.type)).not.toContain('action-spent');
    expect(points(state)).toBe(3);
  });

  /** SRD: "a spell that has a casting time of an action", and no other. */
  it('refuses a spell that is already a Bonus Action', () => {
    const refused = attempt(table(who(), [fight]), {
      spellId: 'misty-step',
      targets: [CASTER],
      slotLevel: 2,
      teleportTo: { from: { creature: CASTER }, feet: 15, bearing: 180 },
      usingOptions: ['quickened-spell'],
    } as Parameters<typeof resolveSpell>[2]);
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });
});

// — Twinned Spell: the effective level ————————————————————————————————

describe('Twinned Spell raises the level without raising the slot', () => {
  const who = () => sorcerer(5, ['Twinned Spell', 'Distant Spell']);

  /** SRD Charm Person takes "one additional Humanoid for each slot level above 1". */
  it('refuses a second target off a level 1 slot without the option', () => {
    const refused = attempt(table(who()), charm(undefined, { targets: [TARGET, SECOND] }));
    expect(isErr(refused)).toBe(true);
  });

  it('catches two off a level 1 slot with it', () => {
    const { outcome, state } = cast(table(who()), charm(['twinned-spell'], {
      targets: [TARGET, SECOND],
    }));
    expect(outcome.outcomes.map((one) => one.target).sort()).toEqual([SECOND, TARGET].sort());
    expect(points(state)).toBe(4);
  });

  /**
   * **The slot is the one that was paid for and the level is the one it counts
   * as**, which is the whole of the 2024 sentence: "increase the spell's
   * effective level by 1". Both numbers are pinned on the event, so a replay
   * reads them without knowing Metamagic exists.
   */
  it('spends a level 1 slot and records the casting at level 2', () => {
    const { events, state } = cast(table(who()), charm(['twinned-spell'], {
      targets: [TARGET, SECOND],
    }));
    const cast1 = events.find((event) => event.type === 'spell-cast');
    expect(cast1 && cast1.type === 'spell-cast' && cast1.level).toBe(2);
    expect(cast1 && cast1.type === 'spell-cast' && cast1.slot?.level).toBe(1);
    // And the slot that went is the level 1 one: a Sorcerer 5 has four of
    // those and three of the next, and the level 2 pool is untouched.
    expect(remaining(state.creatures[CASTER]!.resources, spellSlotKey(1))).toBe(3);
    expect(remaining(state.creatures[CASTER]!.resources, spellSlotKey(2))).toBe(3);
  });

  /**
   * SRD: "a spell, such as Charm Person, that **can be cast with a
   * higher-level spell slot to target an additional creature**." A spell whose
   * target count does not move with the slot is not one of them.
   */
  it('refuses a spell whose targets do not scale with the slot', () => {
    const refused = attempt(table(who()), {
      spellId: 'chromatic-orb',
      targets: [TARGET],
      slotLevel: 1,
      damageType: 'fire',
      usingOptions: ['twinned-spell'],
    } as Parameters<typeof resolveSpell>[2]);
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });
});

// — what an election may not do ————————————————————————————————————————

describe('an election is refused rather than quietly dropped', () => {
  const who = () => sorcerer(5, ['Distant Spell', 'Twinned Spell']);

  /** A caller who names an option this Sorcerer did not take has made a mistake. */
  it('refuses an option the caster does not hold', () => {
    const refused = attempt(table(who(), [], 50), charm(['subtle-spell']));
    expect(isErr(refused) && refused.code).toBe('no_such_casting_option');
  });

  /** SRD: "You can use only one Metamagic option on a spell when you cast it." */
  it('refuses two options from the one feature', () => {
    const refused = attempt(table(who(), [], 50), charm(['distant-spell', 'twinned-spell']));
    expect(isErr(refused) && refused.code).toBe('too_many_casting_options');
  });

  /** The same option twice is one option named twice, and is refused as two. */
  it('refuses the same option named twice', () => {
    const refused = attempt(table(who(), [], 50), charm(['distant-spell', 'distant-spell']));
    expect(isErr(refused) && refused.code).toBe('too_many_casting_options');
  });

  it('refuses a casting whose points the caster has already spent', () => {
    const drained: GameEvent = {
      type: 'resource-spent',
      id: CASTER,
      key: 'sorcery-points',
      amount: 5,
    };
    const refused = attempt(table(who(), [drained], 50), charm(['distant-spell']));
    expect(isErr(refused) && refused.code).toBe('no_points');
  });

  /**
   * The low-level half takes its caller's word about the economy and not about
   * arithmetic — the rule `castingSeconds` already keeps. An effective level
   * below the slot that paid for it, or above the 9 a slot stops at, is a
   * number no option could have produced.
   */
  it('refuses an effective level that is not above the slot and below 10', () => {
    const state = fold('seed', table(who()));
    const command = { spell: 'Charm Person', level: 1, slotLevel: 2 } as const;
    expect(isErr(castSpell(state, CASTER, { ...command, effectiveLevel: 1 }))).toBe(true);
    const low = castSpell(state, CASTER, { ...command, effectiveLevel: 1 });
    expect(isErr(low) && low.code).toBe('bad_effective_level');
    const high = castSpell(state, CASTER, { ...command, effectiveLevel: 10 });
    expect(isErr(high) && high.code).toBe('bad_effective_level');
    // And the level the slot itself reaches is not a refusal: it is what every
    // casting nothing altered already says.
    expect(isErr(castSpell(state, CASTER, { ...command, effectiveLevel: 2 }))).toBe(false);
  });
});

// — a casting held open for a Counterspell —————————————————————————————

describe('an option reaches a casting that is declared now and settled later', () => {
  const who = () => sorcerer(5, ['Extended Spell', 'Twinned Spell']);

  /**
   * **Where this parts company with an elected *feature*.** `usingFeatures` is
   * refused on a declaration because nothing on the declaration records it and
   * the settlement would silently forget. Every one of these four is recorded:
   * the range was spent settling the targets, and the level, the casting time
   * and the deadline are all pinned on `spell-declared`. So the election is
   * allowed, the points go with the declaration, and the settlement reads the
   * altered numbers off the record exactly as it reads everything else.
   */
  it('pins the doubled duration on the declaration and settles with it', () => {
    const log = table(who());
    const declared = cast(log, charm(['extended-spell'], { hold: true }));
    expect(points(declared.state)).toBe(4);

    const held = declared.state.pendingCastings[declared.outcome.castingId!];
    expect(held?.deadline).toEqual({ kind: 'elapsed', at: 7200 });

    const settled = unwrap(
      resolveDeclaredCast(declared.state, declared.outcome.castingId!, supply(declared.state)),
      'settle',
    );
    const filed = settled.events.find(
      (event) => event.type === 'effect-scheduled' && event.target.kind === 'casting',
    );
    expect(filed && filed.type === 'effect-scheduled' && filed.deadline).toEqual({
      kind: 'elapsed',
      at: 7200,
    });
  });

  /** And the level a declaration was raised to is the level it settles at. */
  it('settles a held casting at the level the option raised it to', () => {
    const log = table(who());
    const declared = cast(log, charm(['twinned-spell'], { hold: true, targets: [TARGET, SECOND] }));
    const held = declared.state.pendingCastings[declared.outcome.castingId!];
    expect(held?.level).toBe(2);
    expect(held?.slot?.level).toBe(1);
    expect(held?.targets).toEqual([TARGET, SECOND]);
  });
});
