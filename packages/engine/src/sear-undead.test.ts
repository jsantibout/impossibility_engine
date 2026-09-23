import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  READABLE_FEATURE_FIELDS,
  READABLE_GRANT_KINDS,
  checkContent,
  extendContent,
  parseClassDefinition,
  parseSubclassDefinition,
  type Content,
} from './content.js';
import { checkFeatureDefinition } from './feature-schema.js';
import type { FeatureDefinition } from './progression.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { usePoolOption } from './commands.js';

/**
 * A later feature that rewrites an earlier one's use.
 *
 * SRD Sear Undead: "Whenever you use Turn Undead, you can roll a number of d8s
 * equal to your Wisdom modifier (minimum of 1d8) and add the rolls together.
 * Each Undead that fails its saving throw against that use of Turn Undead takes
 * Radiant damage equal to the roll's total. This damage doesn't end the turn
 * effect."
 *
 * Nothing joins the menu. One form already on it does more — and what it does
 * more of hangs on the outcome that form already settles, so it is the same
 * save, the same DC and the same set of creatures who failed it. The Frightened
 * and the Incapacitated are riders on that failure too, which is why the last
 * sentence of the SRD paragraph needs no field: damage beside a condition takes
 * nothing away.
 */

const id = (s: string) => asCharacterId(s);
const ANSEL = id('ansel');
const WIGHT = id('wight');
const GHOUL = id('ghoul');
const SKELETON = id('skeleton');

const CHANNEL = 'cleric:channel-divinity';

/** The die is the engine's; which side of the DC it lands on is the test's. */
const CERTAIN = 40;
const DOOMED = -40;

const supply = (state: GameState, flat = 0, content: Content = SRD_CONTENT, seed = 'mixed-3') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content,
  ...(flat === 0 ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

/** SRD Cleric Features table, Prepared Spells column, as far as level 7. */
const PREPARED = [4, 5, 6, 7, 9, 10, 11];

const cleric = (level: number, wisdom = 15): CharacterChoices => ({
  name: 'Ansel',
  classId: 'cleric',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment:
      wisdom >= 15
        ? { str: 14, dex: 10, con: 13, int: 8, wis: 15, cha: 12 }
        : { str: 14, dex: 10, con: 13, int: 15, wis: 8, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['insight', 'religion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  ...(level >= 3 ? { subclassId: 'life-domain' } : {}),
  cantrips: ['sacred-flame', 'guidance', 'light', 'mending'].slice(0, level >= 4 ? 4 : 3),
  preparedSpells: [
    'bless',
    'cure-wounds',
    'healing-word',
    'guiding-bolt',
    'inflict-wounds',
    'hold-person',
    'blindness-deafness',
    'aid',
    'lesser-restoration',
    'silence',
    'revivify',
  ].slice(0, PREPARED[level - 1] ?? 0),
  spellbook: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'cleric:divine-order': ['Protector'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    ...(level >= 4
      ? { 'cleric:ability-score-improvement': { featId: 'savage-attacker' } }
      : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const undead = (who: CharacterId, maxHp = 40): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: {
    level: 3,
    abilities: { str: 12, dex: 10, con: 12, int: 8, wis: 10, cha: 8 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    baseSpeed: 30,
    spellcastingAbility: null,
  },
  maxHp,
  diesAtZero: true,
  creatureType: 'Undead',
});

/** The Cleric and three Undead, all inside the thirty feet Turn Undead fills. */
const table = (level = 5, wisdom = 15): readonly GameEvent[] => {
  const made = createCharacter(SRD_CONTENT, cleric(level, wisdom), ANSEL);
  if (!made.ok) throw new Error(`cleric ${level}: ${made.code} — ${made.reason}`);
  return [
    ...made.value,
    undead(WIGHT),
    undead(GHOUL),
    undead(SKELETON),
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the crypt', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: ANSEL, placement: { from: { landmark: 'the crypt' }, feet: 0 } },
    { type: 'creature-placed', id: WIGHT, placement: { from: { creature: ANSEL }, feet: 10, bearing: 0 } },
    { type: 'creature-placed', id: GHOUL, placement: { from: { creature: ANSEL }, feet: 10, bearing: 90 } },
    { type: 'creature-placed', id: SKELETON, placement: { from: { creature: ANSEL }, feet: 10, bearing: 180 } },
  ];
};

const turn = (log: readonly GameEvent[], flat = 0) => {
  const state = fold('seed', log);
  return unwrap(
    usePoolOption(
      state,
      ANSEL,
      { feature: CHANNEL, option: 'turn-undead' },
      supply(state, flat),
    ),
    'turn undead',
  );
};

const hpAfter = (log: readonly GameEvent[], events: readonly GameEvent[], who: CharacterId) =>
  fold('seed', [...log, ...events]).creatures[who]!.vitals.hp;

const conditionsAfter = (
  log: readonly GameEvent[],
  events: readonly GameEvent[],
  who: CharacterId,
) => (fold('seed', [...log, ...events]).creatures[who]?.conditions.conditions ?? []).slice().sort();

const turnOption = (level: number, wisdom = 15) => {
  const sheet = unwrap(planCharacter(SRD_CONTENT, cleric(level, wisdom)), `cleric ${level}`).sheet;
  const option = (sheet.poolOptions ?? []).find((one) => one.option === 'turn-undead');
  if (option === undefined) throw new Error('no Turn Undead');
  return option;
};

/**
 * A homebrew class with a pool, one form on its menu, and a later feature that
 * changes what that form does.
 *
 * Its own class rather than a Cleric domain, because the Cleric's menu is
 * already amended: `cleric:sear-undead` names Turn Undead, and a second
 * amendment of one form is a thing `checkContent` refuses.
 */
const singerWith = (option: string, die = '1d8') => ({
    id: 'singer',
    name: 'Singer',
    primaryAbility: 'cha',
    hitDie: 8,
    saveProficiencies: ['cha', 'dex'],
    skillChoices: { choose: 2, from: ['performance', 'insight'] },
    weaponProficiencies: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    subclassLevel: 20,
    table: Array.from({ length: 20 }, (_, i) => ({
      level: i + 1,
      proficiencyBonus: 2 + Math.floor(i / 4),
    })),
    startingEquipment: [{ option: 'A', items: [{ id: 'dagger', quantity: 1 }], goldPieces: 5 }],
    multiclass: { weapons: ['simple'], armorTraining: { light: true, medium: false, heavy: false, shields: false }, tools: [] },
    features: [
      {
        id: 'singer:refrain',
        name: 'Refrain',
        level: 1,
        automation: 'engine',
        note: 'A pool with one form on its menu.',
        grants: {
          kind: 'pool',
          key: 'refrain',
          label: 'Refrain',
          usesByLevel: Array.from({ length: 20 }, () => 2),
          recovers: 'long-rest',
          options: [
            {
              id: 'lullaby',
              name: 'Lullaby',
              action: 'action',
              area: { kind: 'emanation', distance: 30, origin: 'self' },
              effects: [{ kind: 'save', ability: 'wis', condition: 'frightened' }],
              durationSeconds: 60,
            },
            {
              id: 'dirge',
              name: 'Dirge',
              action: 'action',
              area: { kind: 'emanation', distance: 30, origin: 'self' },
              effects: [{ kind: 'save', ability: 'cha', condition: 'frightened' }],
              durationSeconds: 60,
            },
          ],
        },
      },
      {
        id: 'singer:descant',
        name: 'Descant',
        level: 5,
        automation: 'engine',
        note: 'A later feature that changes what the Refrain does.',
        grants: {
          kind: 'pool-options',
          feature: 'singer:refrain',
          amends: [
            {
              option,
              damagesFailures: {
                die,
                count: { fromAbilityModifier: 'cha', minimum: 1 },
                damageType: 'thunder',
              },
            },
          ],
        },
      },
    ],
});

describe('Sear Undead amends Turn Undead rather than joining its menu', () => {
  /** SRD: "a number of d8s equal to your Wisdom modifier (minimum of 1d8)". */
  it('counts the d8s off the Cleric’s Wisdom modifier', () => {
    // Wisdom 15 + 1 from the increase = 16, a modifier of 3.
    expect(turnOption(5).damagesFailures).toEqual({ dice: '3d8', damageType: 'radiant' });
  });

  /** "(minimum of 1d8)" — the floor the SRD prints, at a modifier of 0 or less. */
  it('rolls one die where the modifier would give none', () => {
    // Wisdom 8 + 1 = 9, a modifier of −1.
    expect(turnOption(5, 8).damagesFailures).toEqual({ dice: '1d8', damageType: 'radiant' });
  });

  /**
   * A Cleric who has not reached level 5 has Turn Undead and no burning — and
   * the option's own effect is the saving throw it always was, untouched.
   */
  it('leaves Turn Undead alone below level 5', () => {
    expect(turnOption(3).damagesFailures).toBeUndefined();
    expect(turnOption(3).effects[0]).toMatchObject({ kind: 'save', ability: 'wis' });
    expect(turnOption(5).effects[0]).toMatchObject({ kind: 'save', ability: 'wis' });
  });

  it('deals no damage at all for a Cleric who does not hold it', () => {
    const log = table(3);
    const used = turn(log, DOOMED);
    for (const who of [WIGHT, GHOUL, SKELETON]) {
      expect(hpAfter(log, used.events, who)).toBe(40);
      expect(conditionsAfter(log, used.events, who)).toEqual(['frightened', 'incapacitated']);
    }
  });

  /**
   * SRD: "Each Undead that fails its saving throw ... takes Radiant damage
   * equal to **the roll's total**." One total, dealt to every one of them.
   */
  it('burns every Undead that failed, for the same total, and turns them too', () => {
    const log = table();
    const used = turn(log, DOOMED);
    const left = [WIGHT, GHOUL, SKELETON].map((who) => hpAfter(log, used.events, who));
    expect(new Set(left).size).toBe(1);
    expect(left[0]).toBeLessThan(40);
    for (const who of [WIGHT, GHOUL, SKELETON]) {
      expect(conditionsAfter(log, used.events, who)).toEqual(['frightened', 'incapacitated']);
    }
  });

  /** "This damage doesn't end the turn effect" — and a success buys nothing. */
  it('leaves an Undead that made its save unburned and unturned', () => {
    const log = table();
    const used = turn(log, CERTAIN);
    for (const who of [WIGHT, GHOUL, SKELETON]) {
      expect(hpAfter(log, used.events, who)).toBe(40);
      expect(conditionsAfter(log, used.events, who)).toEqual([]);
    }
  });

  /**
   * The mixed case, which is the one the sentence is about: the creatures that
   * took damage are exactly the creatures that failed, and each took the same.
   */
  it('burns exactly the ones that failed, and by the same amount', () => {
    const log = table();
    const used = turn(log);
    const failed = used.outcomes.filter((one) => one.save?.success === false).map((one) => one.target);
    const saved = used.outcomes.filter((one) => one.save?.success === true).map((one) => one.target);
    // Not vacuous: this seed really does split them.
    expect(failed.length).toBeGreaterThan(0);
    expect(saved.length).toBeGreaterThan(0);

    const burned = failed.map((who) => 40 - hpAfter(log, used.events, who));
    expect(new Set(burned).size).toBe(1);
    expect(burned[0]).toBeGreaterThan(0);
    for (const who of saved) expect(hpAfter(log, used.events, who)).toBe(40);
  });

  /** Every die the use threw is in the log, under one `rolls-issued`. */
  it('files every die it threw under one rolls-issued', () => {
    const used = turn(table(), DOOMED);
    const issued = used.events.filter((event) => event.type === 'rolls-issued');
    expect(issued).toHaveLength(1);
  });
});

describe('an amendment is held to the menu it names', () => {
  /**
   * A homebrew class carrying the failure the rule exists to catch: a feature
   * that amends a form its host does not print.
   */
  const withAmendment = (option: string) => {
    const parsed = parseClassDefinition(singerWith(option));
    return parsed.ok
      ? checkContent({ classes: [parsed.value] })
      : [{ field: 'class', code: parsed.code, reason: parsed.reason }];
  };

  it('accepts an amendment on a form the host prints', () => {
    expect(withAmendment('lullaby')).toEqual([]);
  });

  it('refuses one on a form nobody wrote, with a path', () => {
    const problems = withAmendment('elegy');
    expect(problems.map((one) => one.code)).toContain('unknown_amended_option');
    expect(problems[0]?.field).toContain('amends[0].option');
  });

  /**
   * And refuses a second feature changing the same form: a compiled option
   * reads one amendment, so the other would be a printed sentence the sheet
   * silently dropped. Driven across the class/subclass boundary, which is the
   * scope a subclass's own validation sees.
   */
  it('refuses a second feature changing the form a first one already changed', () => {
    const singer = parseClassDefinition(singerWith('lullaby'));
    expect(singer.ok).toBe(true);
    if (!singer.ok) return;
    const choir = parseSubclassDefinition({
      id: 'choir',
      name: 'Choir',
      classId: 'singer',
      features: [
        {
          id: 'choir:harmony',
          name: 'Harmony',
          level: 3,
          automation: 'engine',
          note: 'A subclass that changes the same form its parent class already changed, so the validator has the collision to judge.',
          grants: {
            kind: 'pool-options',
            feature: 'singer:refrain',
            amends: [
              {
                option: 'lullaby',
                damagesFailures: {
                  die: '1d6',
                  count: { minimum: 1 },
                  damageType: 'thunder',
                },
              },
            ],
          },
        },
      ],
    });
    expect(choir.ok).toBe(true);
    if (!choir.ok) return;
    const problems = checkContent({ classes: [singer.value], subclasses: [choir.value] });
    // Once, from the subclass — which is the only source that can see both,
    // because a class's scope does not hold its subclasses.
    expect(problems.map((one) => one.code)).toEqual(['duplicate_amended_option']);
    expect(problems[0]?.field).toContain('subclasses[choir]');
  });

  /**
   * And the same collision between two features of one class, which **is**
   * seen twice — once from each side — and must be reported once. The rule
   * this file states for itself: "a problem reported twice is a problem an
   * author fixes once and sees again."
   */
  it('reports a collision between two features of one class exactly once', () => {
    const problems = checkContent({ classes: [asClass(twiceAmending('lullaby', 'lullaby'))] });
    expect(problems.map((one) => one.code)).toEqual(['duplicate_amended_option']);
    // On the later of the two, as a joining option is reported on the joiner.
    expect(problems[0]?.field).toContain('features[2]');
  });

  /** A feature naming two *different* forms is not a collision at all. */
  it('leaves one feature amending two different forms alone', () => {
    expect(checkContent({ classes: [asClass(twiceAmending('lullaby', 'dirge'))] })).toEqual([]);
  });

  /** And one feature naming the same form twice drops one of them just as quietly. */
  it('refuses one feature that names the same form twice', () => {
    const singer = singerWith('lullaby') as unknown as {
      features: { id: string; grants: { amends: unknown[] } }[];
    };
    const doubled = {
      ...singer,
      features: singer.features.map((one, at) =>
        at === 1
          ? { ...one, grants: { ...one.grants, amends: [...one.grants.amends, ...one.grants.amends] } }
          : one,
      ),
    };
    const problems = checkContent({ classes: [asClass(doubled)] });
    expect(problems.map((one) => one.code)).toEqual(['duplicate_amended_option']);
    expect(problems[0]?.field).toContain('amends[1].option');
  });
});

/**
 * And what the amendment *carries* is judged too.
 *
 * `featureOptionsProblems` judges the forms a `pool-options` grant **adds**,
 * and an amendment goes nowhere near it because it declares no form at all —
 * so a die nobody parsed, a damage type no defence will ever match and a count
 * `poolSizeOf` reads would each have compiled onto the sheet and reached
 * `dealSpellDamage` as data the engine cannot argue with.
 */
/**
 * The die a compiled amendment actually deals, read off a real sheet.
 *
 * The notation on the option is what the command rolls, so "which die does
 * this amendment name" is asked of the character rather than of the validator.
 */
const asClass = (definition: unknown) => {
  const parsed = parseClassDefinition(definition);
  if (!parsed.ok) throw new Error(`${parsed.code}: ${parsed.reason}`);
  return parsed.value;
};

/** The Singer with a second, later feature amending a second form. */
const twiceAmending = (first: string, second: string) => {
  const base = singerWith(first) as unknown as { features: readonly unknown[] };
  return {
    ...base,
    features: [
      ...base.features,
      {
        id: 'singer:coda',
        name: 'Coda',
        level: 7,
        automation: 'engine',
        note: 'A second later feature that changes a form of the Refrain, so a collision between two features of one class has something to be reported on.',
        grants: {
          kind: 'pool-options',
          feature: 'singer:refrain',
          amends: [
            {
              option: second,
              damagesFailures: { die: '1d6', count: { minimum: 1 }, damageType: 'thunder' },
            },
          ],
        },
      },
    ],
  };
};

const diceOfAmendment = (die: string): string | undefined => {
  const world = unwrap(
    extendContent(SRD_CONTENT, { classes: [singerWith('lullaby', die)] } as never),
    'homebrew class',
  );
  const sheet = unwrap(
    planCharacter(world, {
      name: 'Rhys',
      classId: 'singer',
      level: 5,
      speciesId: 'human',
      backgroundId: 'sage',
      abilities: {
        method: 'standard-array',
        assignment: { str: 10, dex: 14, con: 13, int: 12, wis: 8, cha: 15 },
      },
      abilityIncreases: { con: 2, int: 1 },
      classSkills: ['performance', 'insight'],
      languages: ['Dwarvish', 'Orc'],
      alignment: 'Neutral',
      cantrips: [],
      spellbook: [],
      preparedSpells: [],
      classEquipment: 'A',
      backgroundEquipment: 'A',
      equipped: [],
      hitPoints: { method: 'fixed' },
      featureChoices: { 'human:skillful': ['perception'] },
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int' as const,
          cantrips: ['mage-hand', 'light'],
          levelOneSpell: 'find-familiar',
        },
        'human:versatile': { featId: 'alert' },
      },
      dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    } as CharacterChoices),
    'singer',
  ).sheet;
  return (sheet.poolOptions ?? []).find((one) => one.option === 'lullaby')?.damagesFailures?.dice;
};

describe('what an amendment burns the failures with', () => {
  const codes = (damagesFailures: unknown): string[] =>
    checkFeatureDefinition(
      {
        id: 'cleric:a-homebrew-searing',
        name: 'A Homebrew Searing',
        level: 5,
        automation: 'engine',
        note: 'A later feature that changes what an earlier one’s use does, written by somebody other than the SRD, so the validator has something to judge.',
        grants: { kind: 'pool-options', feature: 'cleric:channel-divinity', amends: [
          { option: 'turn-undead', ...(damagesFailures === undefined ? {} : { damagesFailures }) },
        ] },
      } as unknown as FeatureDefinition,
      {
        levels: 20,
        readableGrants: READABLE_GRANT_KINDS,
        readableFields: READABLE_FEATURE_FIELDS,
        spellExists: () => true,
      },
    ).map((problem) => problem.code);

  it('accepts the SRD’s own sentence', () => {
    expect(
      codes({ die: '1d8', count: { fromAbilityModifier: 'wis', minimum: 1 }, damageType: 'radiant' }),
    ).toEqual([]);
  });

  it('refuses a die nothing can roll', () => {
    expect(codes({ die: 'a handful', count: { minimum: 1 }, damageType: 'radiant' })).toContain(
      'bad_dice',
    );
  });

  /**
   * And a die that says more than a die. How many is the sizing beside it, so
   * a printed count, a flat addend or a keep rule is a sentence
   * `withDiceCountOf` reads nothing of and drops in silence.
   */
  it('refuses a notation carrying its own count, an addend or a keep rule', () => {
    for (const die of ['2d6', '1d6+1', '4d6kh3']) {
      expect(codes({ die, count: { minimum: 1 }, damageType: 'radiant' }), die).toContain(
        'bad_dice',
      );
    }
  });

  it('refuses a damage type no creature could ever resist', () => {
    expect(codes({ die: '1d8', count: { minimum: 1 }, damageType: 'radiantt' })).toContain(
      'unknown_damage_type',
    );
  });

  it('holds the dice count to the sizings the engine reads', () => {
    expect(
      codes({ die: '1d8', count: { fromAbilityModifier: 'luck' }, damageType: 'radiant' }),
    ).toContain('bad_pool_sizing');
  });

  /**
   * The shape before the rules. A count that is not a sizing at all falls
   * through every branch of `poolSizeOf` to its floor, so the feature would
   * have dealt one die for ever and nothing would have said so.
   */
  it('refuses a dice count that is not a sizing at all', () => {
    for (const count of [3, 'wis', null]) {
      expect(codes({ die: '1d8', count, damageType: 'radiant' })).toContain('bad_pool_sizing');
    }
  });

  it('refuses an amendment that says nothing about what changes', () => {
    // Both spellings of nothing, because `typeof null` is "object" and the
    // second of them used to be dereferenced rather than refused.
    expect(codes(undefined)).toContain('amends_nothing');
    expect(codes(null)).toContain('amends_nothing');
  });

  /**
   * The die is read by the parser rather than off the string.
   *
   * `parseNotation` lowercases before it matches, so `D12` is dice the
   * validator accepts — and a `split('d')` would have turned it into a d8 with
   * nothing to say so.
   */
  it('rolls the die the notation names, in either case', () => {
    expect(codes({ die: '1D12', count: { minimum: 1 }, damageType: 'radiant' })).toEqual([]);
    // A Charisma of 15 is a modifier of 2, so the count is the sizing's and
    // the sides are the notation's — in either case it was written in.
    expect(diceOfAmendment('1D12')).toBe('2d12');
    expect(diceOfAmendment('1d8')).toBe('2d8');
  });
});
