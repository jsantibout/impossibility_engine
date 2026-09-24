import { describe, expect, it } from 'vitest';
import { featureGrants } from './progression.js';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, restoreRng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { reactionOpportunities, resolveDeclaredCast, resolveSpell } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { remaining } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import type { FeatureDefinition } from './progression.js';

/**
 * The six Metamagic options that do not rewrite one of the casting's four
 * numbers, driven end to end.
 *
 * `casting-options.test.ts` is this file's sibling and owns the other four —
 * Distant, Extended, Quickened and Twinned, each of which changes a number
 * `resolveSpell` works out before it spends anything. These six reach further
 * in, and the table is what this file asserts:
 *
 * | SRD option | Where it lands | The fact asserted here |
 * |---|---|---|
 * | Careful Spell | the casting's catch | three goblins roll no save and take no damage, and a fourth is refused |
 * | Heightened Spell | the save roll's modes | one target's save carries Disadvantage from a named source and nobody else's does |
 * | Empowered Spell | the damage dice | the three lowest are thrown again and both faces are in the log |
 * | Seeking Spell | the spell attack | a miss is thrown again, and the point goes only then |
 * | Subtle Spell | the Counterspell window | a nearby holder is offered nothing |
 * | Transmuted Spell | the damage type | a Fireball deals Cold, and Radiant is refused |
 *
 * Every one of them is priced, and the price is asserted as the Sorcery Points
 * left in the pool — which is the whole of what separates an elected option
 * from an elected feature: a casting that cannot use the option it named is
 * refused, because the SRD writes each of these as a condition on the
 * spending.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const SECOND = id('second');
const THIRD = id('third');
const FOURTH = id('fourth');
const ARMOURED = id('armoured');
const EXPOSED = id('exposed');
const WIZARD = id('wizard');

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

const cantripsFor = (classId: string, level: number): readonly string[] =>
  filled(row(classId, level).cantripsKnown ?? 0, [], onList(classId, 0));

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
 * A Sorcerer 5 who took the two named Metamagic options.
 *
 * The standard array's 15 in Charisma plus the level 4 Improvement's two is
 * 17, so the Charisma modifier every "up to your Charisma modifier (minimum
 * of one)" here counts off is **+3**. That number is the subject of two of
 * the six, so it is stated rather than left to be read off a sheet.
 */
const sorcerer = (
  metamagic: readonly string[],
  /**
   * Spells this test needs prepared beside the four every test here uses.
   *
   * The four are what the six options are demonstrated on; a test about an
   * option reaching a *different* effect kind needs its own spell prepared,
   * and asking for it by name is cheaper than a second character.
   */
  extra: readonly string[] = [],
): CharacterChoices => {
  const classSkills = ['arcana', 'insight'];
  const needs = ['fireball', 'charm-person', 'chromatic-orb', 'magic-missile', ...extra];
  return {
    name: 'Vashti',
    classId: 'sorcerer',
    level: 5,
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
    cantrips: cantripsFor('sorcerer', 5) as never,
    spellbook: [],
    preparedSpells: preparedFor('sorcerer', 5, needs),
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      ...autoChoices('sorcerer', 5, classSkills),
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
        improvementSlots('sorcerer', 5).map((slot) => [
          slot,
          { featId: 'ability-score-improvement', abilities: ['cha', 'cha'] },
        ]),
      ),
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  };
};

/** A Humanoid with nothing of its own, standing where the test puts it. */
const dummy = (
  who: CharacterId,
  from: CharacterId,
  bearing: number,
  feet: number,
  armorClass = 12,
): readonly GameEvent[] => [
  {
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
      stated: { armorClass, proficiencyBonus: 2, initiative: 0 },
    },
  },
  { type: 'creature-placed', id: who, placement: { from: { creature: from }, feet, bearing } },
  { type: 'sight-declared', from: CASTER, to: who, seen: true },
];

/**
 * Where the Fireball goes: the space the first of the four is standing in,
 * sixty feet from the caster on a bearing of 0.
 */
const BLAST = { x: 100, y: 160, z: 0 } as const;

/**
 * The caster, four Humanoids bunched sixty feet away, and a scene.
 *
 * The four stand within five feet of each other so that one 20-foot-radius
 * Sphere catches all of them, which is what makes "three spared and one not"
 * an assertion about the option rather than about the geometry.
 */
const table = (choices: CharacterChoices, extra: readonly GameEvent[] = []): GameEvent[] => [
  ...unwrap(createCharacter(SRD_CONTENT, choices, CASTER), 'create'),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  ...dummy(TARGET, CASTER, 0, 60),
  ...dummy(SECOND, TARGET, 90, 5),
  ...dummy(THIRD, TARGET, 180, 5),
  ...dummy(FOURTH, TARGET, 270, 5),
  // A fifth, sixty feet the other way and behind an Armour Class no spell
  // attack in this file can reach: the miss branch Seeking Spell is entirely
  // about is then reached by the rules rather than by a seed that happened to
  // roll low, and the Sphere above never touches it.
  ...dummy(ARMOURED, CASTER, 180, 60, 30),
  // And its opposite, for the other half of the same sentence: an Armour Class
  // a spell attack cannot fail to reach, so the hit branch is reached by the
  // rules too. Sixty feet to the side, well clear of the Sphere.
  ...dummy(EXPOSED, CASTER, 90, 60, 2),
  ...extra,
];

const supply = (state: GameState, seed = 'seed') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng(seed) : restoreRng(state.rng),
  content: SRD_CONTENT,
});

type Request = Parameters<typeof resolveSpell>[2];

const attempt = (log: readonly GameEvent[], request: Request, seed = 'seed') => {
  const state = fold('seed', log);
  return resolveSpell(state, CASTER, request, supply(state, seed));
};

const cast = (log: readonly GameEvent[], request: Request, seed = 'seed') => {
  const result = unwrap(attempt(log, request, seed), 'cast');
  const after = [...log, ...result.events];
  return { log: after, state: fold('seed', after), outcome: result, events: result.events };
};

/** How many Sorcery Points are left, which is the price every test asserts. */
const points = (state: GameState): number =>
  remaining(state.creatures[CASTER]!.resources, 'sorcery-points');

/** A Fireball at the bunched four, with whatever the test is naming on it. */
const fireball = (over: Record<string, unknown> = {}): Request =>
  ({ spellId: 'fireball', targets: [], at: BLAST, slotLevel: 3, ...over }) as Request;

// — Careful Spell: creatures that automatically succeed ————————————————

describe('Careful Spell spares creatures the casting would have caught', () => {
  const who = () => sorcerer(['Careful Spell', 'Subtle Spell']);

  it('catches all four without the option', () => {
    const { outcome } = cast(table(who()), fireball());
    expect(outcome.outcomes.map((one) => one.target).sort()).toEqual(
      [TARGET, SECOND, THIRD, FOURTH].sort(),
    );
  });

  /**
   * SRD: "A chosen creature automatically succeeds on its saving throw against
   * the spell, and it takes no damage if it would normally take half damage on
   * a successful save." Fireball is exactly that spell, so a spared creature
   * rolls nothing and takes nothing.
   */
  it('spares three of them, rolling no save and dealing no damage', () => {
    const { outcome, events, state } = cast(
      table(who()),
      fireball({ usingOptions: ['careful-spell'], unaffected: [TARGET, SECOND, THIRD] }),
    );
    expect(outcome.outcomes.map((one) => one.target)).toEqual([FOURTH]);
    const saves = events.filter(
      (event) => event.type === 'roll-recorded' && event.label.includes('save'),
    );
    expect(saves.map((event) => (event.type === 'roll-recorded' ? event.who : ''))).toEqual([
      FOURTH,
    ]);
    expect(events.some((event) => event.type === 'damage-taken' && event.id !== FOURTH)).toBe(false);
    expect(points(state)).toBe(4);
  });

  /** "up to your Charisma modifier (minimum of one)", which is three here. */
  it('refuses a fourth creature, which is one past the Charisma modifier', () => {
    const refused = attempt(
      table(who()),
      fireball({ usingOptions: ['careful-spell'], unaffected: [TARGET, SECOND, THIRD, FOURTH] }),
    );
    expect(isErr(refused) && refused.code).toBe('too_many_spared');
  });

  /** SRD: "a spell that forces other creatures to make a saving throw." */
  it('refuses a spell that forces no save at all', () => {
    const refused = attempt(table(who()), {
      spellId: 'magic-missile',
      targets: [TARGET],
      slotLevel: 1,
      usingOptions: ['careful-spell'],
      unaffected: [TARGET],
    } as Request);
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });

  /** A designation on a spell that prints none, with no option paying for it. */
  it('refuses the designation with no option behind it', () => {
    const refused = attempt(table(who()), fireball({ unaffected: [TARGET] }));
    expect(isErr(refused) && refused.code).toBe('no_designation');
  });
});

// — Heightened Spell: a mode on one target's save ——————————————————————

describe('Heightened Spell puts Disadvantage on one target’s save', () => {
  const who = () => sorcerer(['Heightened Spell', 'Subtle Spell']);

  /** The modes the engine recorded for each save it rolled. */
  const savesIn = (events: readonly GameEvent[]) =>
    events.flatMap((event) =>
      event.type === 'roll-recorded' && event.label.includes('save')
        ? [{ who: event.who, modes: event.modes ?? [] }]
        : [],
    );

  it('rolls four unmodified saves without the option', () => {
    const { events } = cast(table(who()), fireball());
    expect(savesIn(events).length).toBe(4);
    expect(savesIn(events).every((save) => save.modes.length === 0)).toBe(true);
  });

  /**
   * The mode is on the roll's own record **with its source**, which is what
   * makes it auditable: the log says the save was rolled at Disadvantage and
   * says which option bought it.
   */
  it('rolls the named target’s save at Disadvantage and nobody else’s', () => {
    const { events, state } = cast(
      table(who()),
      fireball({ usingOptions: ['heightened-spell'], saveModes: { [TARGET]: 'disadvantage' } }),
    );
    const rolled = savesIn(events);
    expect(rolled.length).toBe(4);
    expect(rolled.find((save) => save.who === TARGET)!.modes).toEqual([
      { source: 'Heightened Spell', mode: 'disadvantage' },
    ]);
    for (const other of rolled.filter((save) => save.who !== TARGET)) {
      expect(other.modes).toEqual([]);
    }
    expect(points(state)).toBe(3);
  });

  /** A mode stated with no option paying for it is a caller's mistake. */
  it('refuses a stated mode with no option behind it', () => {
    const refused = attempt(table(who()), fireball({ saveModes: { [TARGET]: 'disadvantage' } }));
    expect(isErr(refused) && refused.code).toBe('save_mode_not_offered');
  });

  /** SRD: "give **one** target of the spell Disadvantage on saves." */
  it('refuses two targets for an option that buys one', () => {
    const refused = attempt(
      table(who()),
      fireball({
        usingOptions: ['heightened-spell'],
        saveModes: { [TARGET]: 'disadvantage', [SECOND]: 'disadvantage' },
      }),
    );
    expect(isErr(refused) && refused.code).toBe('too_many_save_modes');
  });

  /** SRD: "a spell that forces a creature to make a saving throw." */
  it('refuses a spell that forces no save', () => {
    const refused = attempt(table(who()), {
      spellId: 'magic-missile',
      targets: [TARGET],
      slotLevel: 1,
      usingOptions: ['heightened-spell'],
      saveModes: { [TARGET]: 'disadvantage' },
    } as Request);
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });
});

// — the two options over a save whose whole outcome is a movement ————————
//
// SRD Levitate and SRD Gust of Wind gate a movement on a saving throw and
// deal no damage at all, which is a shape neither option had ever been asked
// about. **That they reach it is the argument for making the lift a rider**:
// a movement resolver with a saving throw inside it would have been a second
// place a save is rolled, and neither Heightened's mode nor Careful's sparing
// would have found it there.

describe('the two save options reach a failure whose whole content is a movement', () => {
  /** SRD Levitate: "An unwilling creature that succeeds ... is unaffected." */
  it('rolls a Heightened Levitate’s Constitution save at Disadvantage', () => {
    const { events } = cast(table(sorcerer(['Heightened Spell', 'Subtle Spell'], ['levitate'])), {
      spellId: 'levitate',
      targets: [TARGET],
      slotLevel: 2,
      usingOptions: ['heightened-spell'],
      saveModes: { [TARGET]: 'disadvantage' },
    } as Request);

    const saves = events.flatMap((event) =>
      event.type === 'roll-recorded' && event.label.includes('save')
        ? [{ who: event.who, modes: event.modes ?? [] }]
        : [],
    );
    expect(saves).toHaveLength(1);
    expect(saves[0]!.who).toBe(TARGET);
    expect(saves[0]!.modes).toEqual([{ source: 'Heightened Spell', mode: 'disadvantage' }]);
  });

  /**
   * SRD Gust of Wind: "Each creature in the Line must succeed on a Strength
   * saving throw or be pushed 15 feet away from you."
   *
   * Careful Spell spares a chosen creature the save itself, so the wind blows
   * past an ally and throws whoever else was standing in it.
   */
  it('spares a named ally the Strength save a Careful Gust of Wind forces', () => {
    const log = table(sorcerer(['Careful Spell', 'Subtle Spell'], ['gust-of-wind']));
    const blown = (over: Record<string, unknown> = {}) =>
      cast(log, {
        spellId: 'gust-of-wind',
        targets: [],
        towards: BLAST,
        slotLevel: 2,
        ...over,
      } as Request);

    const caught = blown().outcome.outcomes.map((one) => one.target);
    expect(caught.length).toBeGreaterThan(1);
    expect(caught).toContain(TARGET);

    const spared = blown({ usingOptions: ['careful-spell'], unaffected: [TARGET] });
    expect(spared.outcome.outcomes.map((one) => one.target)).not.toContain(TARGET);
    const asked = spared.events.flatMap((event) =>
      event.type === 'roll-recorded' && event.label.includes('save') ? [event.who] : [],
    );
    expect(asked).not.toContain(TARGET);
    expect(asked.length).toBeGreaterThan(0);
    // And nobody the wind spared was moved by it.
    expect(
      spared.events.some((event) => event.type === 'creature-moved' && event.id === TARGET),
    ).toBe(false);
  });
});

// — Empowered Spell: the damage dice thrown again ——————————————————————

describe('Empowered Spell throws the lowest damage dice again', () => {
  const who = () => sorcerer(['Empowered Spell', 'Subtle Spell']);

  /** The first damage roll the casting recorded, whole. */
  const firstRoll = (events: readonly GameEvent[]) => {
    const rolled = events.find((event) => event.type === 'damage-dice-recorded');
    if (rolled === undefined || rolled.type !== 'damage-dice-recorded') {
      throw new Error('the casting recorded no damage dice');
    }
    return rolled;
  };

  /** Every face of that roll. */
  const firstDamage = (events: readonly GameEvent[]) =>
    firstRoll(events).components.flatMap((part) => part.dice);

  /**
   * What the faces come to: every counted die of a component plus its flat.
   *
   * The arithmetic the reroll actually turns on, asserted rather than inferred
   * from the dispositions. A reroll that marked the right dice and then added
   * the difference the wrong way round would leave every assertion about
   * `disposition` and `origin` standing and deal the old damage.
   */
  const addsUp = (events: readonly GameEvent[]): void => {
    const rolled = firstRoll(events);
    for (const part of rolled.components) {
      const counted = part.dice
        .filter((die) => die.disposition === 'counted')
        .reduce((sum, die) => sum + die.value, 0);
      expect(part.total).toBe(counted + part.flat);
    }
    expect(rolled.rolled).toBe(rolled.components.reduce((sum, part) => sum + part.total, 0));
  };

  it('throws eight dice and rerolls none without the option', () => {
    const { events } = cast(table(who()), fireball());
    const dice = firstDamage(events);
    expect(dice.filter((die) => die.disposition === 'rerolled').length).toBe(0);
    addsUp(events);
  });

  /**
   * "reroll a number of the damage dice up to your Charisma modifier (minimum
   * of one), and you must use the new rolls" — three here, and **the lowest
   * three**, which is the only choice a player who wants more damage makes.
   */
  it('rerolls exactly three dice, and they are the three lowest', () => {
    const { events, state } = cast(table(who()), fireball({ usingOptions: ['empowered-spell'] }));
    const dice = firstDamage(events);
    const given = dice.filter((die) => die.disposition === 'rerolled');
    const kept = dice.filter((die) => die.origin === 'initial' && die.disposition !== 'rerolled');
    expect(given.length).toBe(3);
    // Both sets of faces are in the log, which is what makes this auditable.
    expect(dice.filter((die) => die.origin === 'reroll').length).toBe(3);
    const worst = Math.max(...given.map((die) => die.value));
    expect(Math.min(...kept.map((die) => die.value))).toBeGreaterThanOrEqual(worst);
    // **And the damage is the faces that are left.** A reroll that swapped the
    // dice and moved the total the wrong way would satisfy everything above.
    addsUp(events);
    expect(points(state)).toBe(4);
  });

  /** SRD: "When you roll damage for a spell." Charm Person rolls none. */
  it('refuses a spell that rolls no damage', () => {
    const refused = attempt(table(who()), {
      spellId: 'charm-person',
      targets: [TARGET],
      slotLevel: 1,
      fought: [],
      usingOptions: ['empowered-spell'],
    } as Request);
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });
});

// — Seeking Spell: a missed spell attack thrown again ——————————————————

describe('Seeking Spell throws a missed spell attack again', () => {
  const who = () => sorcerer(['Seeking Spell', 'Subtle Spell']);

  const orb = (at: CharacterId, over: Record<string, unknown> = {}): Request =>
    ({
      spellId: 'chromatic-orb',
      targets: [at],
      slotLevel: 1,
      damageType: 'fire',
      ...over,
    }) as Request;

  /** Every attack roll the casting recorded, in order. */
  const attacksIn = (events: readonly GameEvent[]) =>
    events.flatMap((event) =>
      event.type === 'roll-recorded' && event.label.includes('attack')
        ? [
            {
              natural: event.natural,
              total: event.total,
              outcome: event.outcome,
              supersedes: event.supersedes,
            },
          ]
        : [],
    );

  it('records one attack roll and spends nothing without the option', () => {
    const { events, state } = cast(table(who()), orb(ARMOURED));
    expect(attacksIn(events).length).toBe(1);
    expect(attacksIn(events)[0]!.outcome).toBe('miss');
    expect(points(state)).toBe(5);
  });

  /**
   * Both throws are in the log and the second names the first, which is what
   * "you must use the new roll" needs a reader to be able to check.
   */
  it('throws the missed d20 again and spends the point only then', () => {
    const { events, state } = cast(
      table(who()),
      orb(ARMOURED, { usingOptions: ['seeking-spell'] }),
    );
    const thrown = attacksIn(events);
    expect(thrown.length).toBe(2);
    expect(thrown[0]!.outcome).toBe('miss');
    expect(thrown[1]!.supersedes).toEqual({
      natural: thrown[0]!.natural,
      total: thrown[0]!.total,
    });
    expect(points(state)).toBe(4);
  });

  it('spends nothing at all when the first attack hits', () => {
    const { events, state } = cast(table(who()), orb(EXPOSED, { usingOptions: ['seeking-spell'] }));
    const thrown = attacksIn(events);
    expect(thrown.length).toBe(1);
    expect(thrown[0]!.outcome).toBe('hit');
    expect(points(state)).toBe(5);
  });

  /** SRD: "If you make an attack roll for a spell." Fireball makes none. */
  it('refuses a spell that makes no attack roll', () => {
    const refused = attempt(table(who()), fireball({ usingOptions: ['seeking-spell'] }));
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });
});

// — Subtle Spell: a casting nobody can answer ——————————————————————————

describe('Subtle Spell closes the Counterspell window', () => {
  const who = () => sorcerer(['Subtle Spell', 'Careful Spell']);

  /** A wizard standing beside the Sorcerer with Counterspell prepared. */
  const holder: readonly GameEvent[] = [
    {
      type: 'creature-added',
      id: WIZARD,
      name: WIZARD,
      maxHp: 40,
      diesAtZero: false,
      creatureType: 'Humanoid',
      sheet: {
        level: 5,
        abilities: { str: 10, dex: 12, con: 12, int: 16, wis: 10, cha: 10 },
        skills: {},
        saveProficiencies: [],
        armor: null,
        shield: null,
        armorTraining: { light: true, medium: true, heavy: true, shields: true },
        baseSpeed: 30,
        spellcastingAbility: 'int',
      },
    },
    {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({
        ability: 'int',
        classId: 'wizard',
        cantrips: [],
        prepared: ['counterspell'],
      }),
    },
    {
      type: 'creature-placed',
      id: WIZARD,
      placement: { from: { creature: CASTER }, feet: 10, bearing: 180 },
    },
    { type: 'sight-declared', from: WIZARD, to: CASTER, seen: true },
  ];

  const openings = (state: GameState) =>
    reactionOpportunities(state, SRD_CONTENT).filter(
      (chance) => chance.window === 'casting-a-spell' && chance.reactor === WIZARD,
    );

  it('offers the holder a window for an ordinary held casting', () => {
    const { state } = cast(table(who(), holder), fireball({ hold: true }));
    expect(openings(state).map((chance) => chance.id)).toEqual(['counterspell']);
  });

  it('offers nothing at all when the casting is Subtle', () => {
    const { state } = cast(
      table(who(), holder),
      fireball({ hold: true, usingOptions: ['subtle-spell'] }),
    );
    expect(openings(state)).toEqual([]);
    expect(points(state)).toBe(4);
  });

  /** And the Counterspell itself finds nothing to answer. */
  it('refuses a Counterspell aimed at a Subtle casting', () => {
    const { log, state } = cast(
      table(who(), holder),
      fireball({ hold: true, usingOptions: ['subtle-spell'] }),
    );
    const answered = resolveSpell(
      state,
      WIZARD,
      { spellId: 'counterspell', targets: [CASTER], slotLevel: 3 } as Request,
      supply(fold('seed', log)),
    );
    expect(isErr(answered) && answered.code).toBe('no_trigger');
  });
});

// — Transmuted Spell: a damage type restated ————————————————————————————

describe('Transmuted Spell restates the damage type', () => {
  const who = () => sorcerer(['Transmuted Spell', 'Subtle Spell']);

  const typesIn = (events: readonly GameEvent[]) => [
    ...new Set(
      events.flatMap((event) =>
        event.type === 'damage-dice-recorded' ? event.components.map((part) => part.type) : [],
      ),
    ),
  ];

  it('deals the printed Fire without the option', () => {
    const { events } = cast(table(who()), fireball());
    expect(typesIn(events)).toEqual(['fire']);
  });

  it('deals Cold with it, and spends one Sorcery Point', () => {
    const { events, state } = cast(
      table(who()),
      fireball({ usingOptions: ['transmuted-spell'], damageType: 'cold' }),
    );
    expect(typesIn(events)).toEqual(['cold']);
    expect(points(state)).toBe(4);
  });

  /** SRD lists six types and Radiant is not one of them. */
  it('refuses a type off the printed list', () => {
    const refused = attempt(
      table(who()),
      fireball({ usingOptions: ['transmuted-spell'], damageType: 'radiant' }),
    );
    expect(isErr(refused) && refused.code).toBe('unknown_damage_type');
  });

  /** A type restated with no option paying for it is still refused. */
  it('refuses a restated type with no option behind it', () => {
    const refused = attempt(table(who()), fireball({ damageType: 'cold' }));
    expect(isErr(refused) && refused.code).toBe('damage_type_fixed');
  });

  /** SRD: "a spell that deals a type of damage from the following list." */
  it('refuses a spell that deals none of the six', () => {
    const refused = attempt(table(who()), {
      spellId: 'magic-missile',
      targets: [TARGET],
      slotLevel: 1,
      usingOptions: ['transmuted-spell'],
      damageType: 'cold',
    } as Request);
    expect(isErr(refused) && refused.code).toBe('option_does_not_reach');
  });
});

// — the rules that hold for all six ————————————————————————————————————

describe('what an election of these six may not do', () => {
  it('refuses two options on one casting', () => {
    const refused = attempt(
      table(sorcerer(['Empowered Spell', 'Transmuted Spell'])),
      fireball({ usingOptions: ['empowered-spell', 'transmuted-spell'], damageType: 'cold' }),
    );
    expect(isErr(refused) && refused.code).toBe('too_many_casting_options');
  });

  /**
   * Every one of the six is refused before anything is rolled when the pool is
   * empty — Seeking included, whose point is spent on the reroll and whose
   * price is still checked at the casting.
   */
  const drained: GameEvent = {
    type: 'resource-spent',
    id: CASTER,
    key: 'sorcery-points',
    amount: 5,
  };

  it.each([
    ['careful-spell', 'Careful Spell', { unaffected: [TARGET] }],
    ['heightened-spell', 'Heightened Spell', { saveModes: { [TARGET]: 'disadvantage' } }],
    ['empowered-spell', 'Empowered Spell', {}],
    ['subtle-spell', 'Subtle Spell', { hold: true }],
    ['transmuted-spell', 'Transmuted Spell', { damageType: 'cold' }],
  ])('refuses %s with the pool empty', (option, name, over) => {
    const log = table(sorcerer([name, 'Distant Spell']), [drained]);
    const refused = attempt(log, fireball({ usingOptions: [option], ...over }));
    expect(isErr(refused) && refused.code).toBe('no_points');
    expect(fold('seed', log).creatures[CASTER]!.vitals.hp).toBeGreaterThan(0);
  });

  /**
   * A declaration pins what a settlement will read, and an **election** is the
   * one thing it cannot pin — which is what `election_on_a_declaration`
   * already says of an elected feature. Four of the six survive because what
   * they need is pinned: the sparing is the targets, the type is `damageType`,
   * the mode is `saveModes`, and Subtle Spell's mark is the whole point of a
   * declaration. The two rerolls are read at a roll the settlement makes, off
   * a bag it rebuilds from the sheet, and are refused instead.
   */
  it.each([
    ['empowered-spell', 'Empowered Spell'],
    ['seeking-spell', 'Seeking Spell'],
  ])('refuses %s on a casting held open for a Counterspell', (option, name) => {
    // Chromatic Orb, because it is the one spell here that both rolls damage
    // and makes an attack: a refusal that reached `option_does_not_reach`
    // first would be this test passing for the wrong sentence.
    const refused = attempt(table(sorcerer([name, 'Distant Spell'])), {
      spellId: 'chromatic-orb',
      targets: [TARGET],
      slotLevel: 1,
      damageType: 'fire',
      hold: true,
      usingOptions: [option],
    } as Request);
    expect(isErr(refused) && refused.code).toBe('election_on_a_declaration');
  });

  /**
   * And the other half of that sentence, asserted rather than assumed: the
   * mode SRD Heightened Spell bought is pinned on the declaration and is still
   * on the save when the casting settles a moment later.
   */
  it('carries a Heightened mode through a declaration to its settlement', () => {
    const { log, state } = cast(
      table(sorcerer(['Heightened Spell', 'Distant Spell'])),
      fireball({ hold: true, usingOptions: ['heightened-spell'], saveModes: { [TARGET]: 'disadvantage' } }),
    );
    const open = Object.keys(state.pendingCastings)[0]!;
    const settled = unwrap(resolveDeclaredCast(state, open, supply(state)), 'settle');
    const hers = settled.events.find(
      (event) =>
        event.type === 'roll-recorded' && event.who === TARGET && event.label.includes('save'),
    );
    expect(
      hers !== undefined && hers.type === 'roll-recorded' ? (hers.modes ?? []) : [],
    ).toEqual([{ source: 'Heightened Spell', mode: 'disadvantage' }]);
    // And nobody else's, which is what makes it the pinned map rather than a
    // mode the settlement hung on every save it rolled.
    const others = settled.events.filter(
      (event) =>
        event.type === 'roll-recorded' && event.who !== TARGET && event.label.includes('save'),
    );
    expect(others.length).toBe(3);
    for (const other of others) {
      expect(other.type === 'roll-recorded' ? (other.modes ?? []) : ['x']).toEqual([]);
    }
    expect(log.length).toBeGreaterThan(0);
  });

  it('refuses Seeking Spell with the pool empty, before the attack is rolled', () => {
    const log = table(sorcerer(['Seeking Spell', 'Distant Spell']), [drained]);
    const refused = attempt(log, {
      spellId: 'chromatic-orb',
      targets: [ARMOURED],
      slotLevel: 1,
      damageType: 'fire',
      usingOptions: ['seeking-spell'],
    } as Request);
    expect(isErr(refused) && refused.code).toBe('no_points');
  });
});
