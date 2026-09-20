import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import { checkContent, extendContent, parseClassDefinition, type Content } from './content.js';
import { conditionInstanceId } from './conditions.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { featureSource, type ClassDefinition } from './progression.js';
import { createRollIssuer } from './rolls.js';
import { remaining } from './resources.js';
import { timerKey } from './timers.js';
import { advanceTime, usePoolOption } from './commands.js';

/**
 * A feature confers an effect list, paid for out of its own pool.
 *
 * Channel Divinity was a pool the engine counted and recovered whose use
 * bought nothing — its own note said so: "What each use buys — Turn Undead,
 * Divine Spark — is not executed." A Cleric could be built and could not be
 * played.
 *
 * The cause is one thing and not two. `runEffects` had a casting origin and an
 * item origin and no feature origin, so "a feature forces a saving throw" and
 * "a feature imposes a condition" were two symptoms of the same absence: the
 * effect vocabulary was reachable from a spell and from a bottle and from
 * nothing a class prints. The third arm of `EffectOrigin` is the whole of it —
 * a source the fold can take a grant off by, a save DC read from the holder's
 * own sheet rather than printed on a bottle, and the pool the SRD prices the
 * use in.
 *
 * **Turn Undead needed no new effect vocabulary**, which is the claim these
 * tests are here to hold: a Wisdom `save`, two conditions on one failure, a
 * creature-type filter over an emanation, and a minute on the clock are all
 * things the engine already did for a spell.
 */

const id = (s: string) => asCharacterId(s);
const ANSEL = id('ansel');
const WIGHT = id('wight');
const THUG = id('thug');
const ALLY = id('ally');

const CHANNEL = 'cleric:channel-divinity';

/**
 * The die is the engine's; which side of the DC it lands on is the test's.
 *
 * A flat bonus large enough to swamp the roll, the way `item-repeat-save.test.ts`
 * settles the same question — so every assertion below is about a rule rather
 * than about a seed.
 */
const CERTAIN = 40;
const DOOMED = -40;

const supply = (
  state: GameState,
  flat = 0,
  content: Content = SRD_CONTENT,
  seed = 'channel',
) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content,
  ...(flat === 0 ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
});

/** SRD Cleric Features table, Prepared Spells column, as far as level 7. */
const PREPARED = [4, 5, 6, 7, 9, 10, 11];

const cleric = (level: number): CharacterChoices => ({
  name: 'Ansel',
  classId: 'cleric',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 10, con: 13, int: 8, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['insight', 'religion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  ...(level >= 3 ? { subclassId: 'life-domain' } : {}),
  cantrips: ['sacred-flame', 'guidance', 'light', 'mending'].slice(0, level >= 10 ? 5 : level >= 4 ? 4 : 3),
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
    ...(level >= 7 ? { 'cleric:blessed-strikes': ['Divine Strike'] } : {}),
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    ...(level >= 4 ? { 'cleric:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const plain = (
  who: CharacterId,
  creatureType: string,
  maxHp = 40,
  /** What it resists, for the test that has to tell two damage types apart. */
  defenses?: Readonly<Record<string, { readonly resistant: true }>>,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  ...(defenses === undefined ? {} : { defenses }),
  sheet: {
    level: 3,
    abilities: { str: 12, dex: 10, con: 12, int: 8, wis: 8, cha: 8 },
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
  creatureType,
});

/**
 * The Cleric, an Undead ten feet away, a living thug beside it, and an ally
 * well outside thirty feet.
 */
const table = (level = 2): readonly GameEvent[] => {
  const made = createCharacter(SRD_CONTENT, cleric(level), ANSEL);
  if (!made.ok) throw new Error(`cleric ${level}: ${made.code} — ${made.reason}`);
  return [
    ...made.value,
    plain(WIGHT, 'Undead', 40, { necrotic: { resistant: true } }),
    plain(THUG, 'Humanoid'),
    plain(ALLY, 'Humanoid'),
    { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
    { type: 'landmark-added', name: 'the crypt', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: ANSEL, placement: { from: { landmark: 'the crypt' }, feet: 0 } },
    { type: 'creature-placed', id: WIGHT, placement: { from: { creature: ANSEL }, feet: 10, bearing: 0 } },
    { type: 'creature-placed', id: THUG, placement: { from: { creature: ANSEL }, feet: 10, bearing: 90 } },
    { type: 'creature-placed', id: ALLY, placement: { from: { creature: ANSEL }, feet: 100, bearing: 180 } },
  ];
};

type Emitted = { readonly events: readonly GameEvent[] };

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
): readonly GameEvent[] => [...log, ...unwrap(command(fold('seed', log)), 'command').events];

const conditionsOf = (log: readonly GameEvent[], who: CharacterId): readonly string[] =>
  fold('seed', log).creatures[who]?.conditions.conditions ?? [];

const left = (log: readonly GameEvent[], who: CharacterId, key: string): number =>
  remaining(fold('seed', log).creatures[who]!.resources, key);

const hp = (log: readonly GameEvent[], who: CharacterId): number =>
  fold('seed', log).creatures[who]!.vitals.hp;

const optionOf = (level: number, option: string) => {
  const sheet = unwrap(planCharacter(SRD_CONTENT, cleric(level)), `cleric ${level}`).sheet;
  const found = (sheet.poolOptions ?? []).find((one) => one.option === option);
  if (found === undefined) throw new Error(`no ${option} at level ${level}`);
  return found;
};

// — Turn Undead ————————————————————————————————————————————————————————————

describe('Turn Undead', () => {
  const turned = (log: readonly GameEvent[], flat: number): readonly GameEvent[] =>
    run(log, (s) =>
      usePoolOption(s, ANSEL, { feature: CHANNEL, option: 'turn-undead' }, supply(s, flat)),
    );

  it('is a use of the Channel Divinity pool and nothing else', () => {
    const log = table();
    expect(left(log, ANSEL, 'channel-divinity')).toBe(2);
    expect(left(turned(log, DOOMED), ANSEL, 'channel-divinity')).toBe(1);
  });

  /**
   * SRD: "Each Undead of your choice within 30 feet of you must make a Wisdom
   * saving throw", and Channel Divinity says what against: "the DC equals the
   * spell save DC from this class's Spellcasting feature". Derived from the
   * sheet, never printed on the feature.
   */
  it('rolls the save against the Cleric’s own spell save DC', () => {
    const start = table();
    const state = fold('seed', start);
    const used = unwrap(
      usePoolOption(state, ANSEL, { feature: CHANNEL, option: 'turn-undead' }, supply(state, DOOMED)),
      'turn',
    );

    // A level 2 Cleric with Wisdom 16: 8 + a Proficiency Bonus of 2 + a
    // modifier of 3. Nothing on the feature prints it.
    expect(used.outcomes).toHaveLength(1);
    expect(used.outcomes[0]?.target).toBe(WIGHT);
    expect(used.outcomes[0]?.save).toMatchObject({ dc: 13, ability: 'wis' });

    const rolled = used.events.filter(
      (event): event is Extract<GameEvent, { type: 'roll-recorded' }> =>
        event.type === 'roll-recorded' && event.label.includes('Turn Undead'),
    );
    expect(rolled).toHaveLength(1);
    expect(rolled[0]?.who).toBe(WIGHT);
    expect(rolled[0]?.label).toBe('Wisdom save vs Turn Undead');
  });

  /** SRD: "it has the Frightened and Incapacitated conditions for 1 minute." */
  it('lands both conditions on an Undead that fails', () => {
    const log = turned(table(), DOOMED);
    expect(conditionsOf(log, WIGHT).slice().sort()).toEqual(['frightened', 'incapacitated']);
  });

  it('leaves an Undead that saves alone', () => {
    expect(conditionsOf(turned(table(), CERTAIN), WIGHT)).toEqual([]);
  });

  /** "Each **Undead**": a living creature ten feet away is not asked to roll. */
  it('passes over a creature that is not Undead, without refusing', () => {
    const log = turned(table(), DOOMED);
    expect(conditionsOf(log, THUG)).toEqual([]);
    expect(log.some((e) => e.type === 'roll-recorded' && e.who === THUG)).toBe(false);
  });

  /** "within 30 feet of you": a hundred feet away is outside the emanation. */
  it('does not reach beyond its own emanation', () => {
    expect(conditionsOf(turned(table(), DOOMED), ALLY)).toEqual([]);
  });

  /** SRD: "for 1 minute". A feature's conferral files its own deadline. */
  it('files a deadline a minute out, and the conditions expire on it', () => {
    const log = turned(table(), DOOMED);
    const key = timerKey({
      kind: 'condition',
      on: WIGHT,
      instance: conditionInstanceId('frightened', featureSource(CHANNEL)),
    });
    expect(fold('seed', log).timers[key]?.deadline).toEqual({ kind: 'elapsed', at: 60 });

    const later = [...log, ...unwrap(advanceTime(fold('seed', log), 60, 'a minute'), 'time')];
    expect(conditionsOf(later, WIGHT)).toEqual([]);
  });
});

// — Divine Spark ———————————————————————————————————————————————————————————

describe('Divine Spark', () => {
  /**
   * SRD: "You roll an additional d8 when you reach Cleric levels 7 (2d8), 13
   * (3d8), and 18 (4d8)." A column of the class table, read at that class's
   * own level, exactly as Sneak Attack's dice are.
   */
  it('scales its dice on the Cleric’s own class level', () => {
    const at2 = optionOf(2, 'divine-spark-restore').effects[0]!;
    const at7 = optionOf(7, 'divine-spark-restore').effects[0]!;
    expect(at2).toMatchObject({ kind: 'heal', healing: { dice: '1d8' } });
    expect(at7).toMatchObject({ kind: 'heal', healing: { dice: '2d8' } });
  });

  it('restores hit points to a creature within thirty feet', () => {
    const log = [
      ...table(),
      { type: 'damage-taken', id: THUG, amount: 20, source: 'a trap' } as GameEvent,
    ];
    const healed = run(log, (s) =>
      usePoolOption(
        s,
        ANSEL,
        { feature: CHANNEL, option: 'divine-spark-restore', target: THUG },
        supply(s),
      ),
    );
    expect(hp(healed, THUG)).toBeGreaterThan(hp(log, THUG));
    expect(left(healed, ANSEL, 'channel-divinity')).toBe(1);
  });

  /**
   * "or force the creature to make a Constitution saving throw."
   *
   * The wight resists Necrotic and not Radiant, which is how the *type* the
   * caller named is observed rather than assumed: the same dice off the same
   * seed deal twice as much one way as the other.
   */
  it('deals its damage on a failed save, of the type the caller names', () => {
    const log = table();
    const dealt = (damageType: string): number => {
      const harmed = run(log, (s) =>
        usePoolOption(
          s,
          ANSEL,
          { feature: CHANNEL, option: 'divine-spark-harm', target: WIGHT, damageType },
          supply(s, DOOMED),
        ),
      );
      return hp(log, WIGHT) - hp(harmed, WIGHT);
    };

    const radiant = dealt('radiant');
    expect(dealt('necrotic')).toBe(Math.floor(radiant / 2));

    // **And the Wisdom modifier is in the number.** SRD: "Roll 1d8 and add
    // your Wisdom modifier ... the creature takes ... damage ... equal to that
    // total." The seed fixes the die, so the sum is pinned and the die it
    // implies is on the face of a d8: a Cleric with Wisdom 16 adds 3, and
    // dropping the addend would leave the bare roll.
    expect(radiant).toBe(4);
    expect(radiant - 3).toBeGreaterThanOrEqual(1);
    expect(radiant - 3).toBeLessThanOrEqual(8);
  });

  /** SRD: "On a successful save, the creature takes half as much damage." */
  it('halves the damage on a success rather than refusing', () => {
    const log = table();
    const saved = run(log, (s) =>
      usePoolOption(
        s,
        ANSEL,
        { feature: CHANNEL, option: 'divine-spark-harm', target: WIGHT, damageType: 'necrotic' },
        supply(s, CERTAIN),
      ),
    );
    expect(hp(saved, WIGHT)).toBeLessThan(hp(log, WIGHT));
  });

  /**
   * The damage type is the caller's choice and the engine will not make it —
   * the rule a spell that prints two types already follows.
   */
  it('refuses to choose the damage type for the caller', () => {
    const log = table();
    const refused = usePoolOption(
      fold('seed', log),
      ANSEL,
      { feature: CHANNEL, option: 'divine-spark-harm', target: WIGHT },
      supply(fold('seed', log)),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('damage_type_required');
  });
});

// — what a use costs ———————————————————————————————————————————————————————

describe('the pool behind the options', () => {
  const useAll = (): readonly GameEvent[] => {
    let log = table();
    for (let i = 0; i < 2; i += 1) {
      log = run(log, (s) =>
        usePoolOption(
          s,
          ANSEL,
          { feature: CHANNEL, option: 'turn-undead', commandId: `turn-${i}` },
          supply(s, DOOMED),
        ),
      );
    }
    return log;
  };

  /**
   * **What a refusal could have spent, and did not.**
   *
   * Folding the same log twice and finding it unchanged proves nothing: a
   * refusal appends no events, so that comparison holds however much the
   * command did before deciding. The `Supply` is the observable that *could*
   * have moved — the issuer counts every roll it stamps and the generator
   * carries its own state forward — and both are mutable objects the command
   * is handed. A use that rolled its d8 and then discovered the empty pool
   * would leave the count raised and the generator advanced, and a replay
   * from this log would then throw different dice than the session did.
   */
  const untouched = (
    state: GameState,
    command: { feature: string; option: string; target?: CharacterId; commandId?: string },
    code: string,
  ): void => {
    const given = supply(state);
    const issued = given.issuer.count;
    const generator = JSON.stringify(given.rng.snapshot());

    const refused = usePoolOption(state, ANSEL, command, given);
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe(code);

    expect(given.issuer.count).toBe(issued);
    expect(JSON.stringify(given.rng.snapshot())).toBe(generator);
  };

  it('is refused when it is empty, and the refusal costs nothing at all', () => {
    const spent = useAll();
    expect(left(spent, ANSEL, 'channel-divinity')).toBe(0);
    untouched(
      fold('seed', spent),
      { feature: CHANNEL, option: 'divine-spark-restore', target: THUG, commandId: 'third' },
      'exhausted',
    );
  });

  /**
   * And the same of a refusal reached *before* the pool is looked at, which is
   * what makes the order load-bearing rather than incidental: the option, the
   * damage type, the target and the reach are all settled first, so a Cleric
   * with two uses left keeps both.
   */
  it('costs no use when the target is out of reach', () => {
    const start = table();
    untouched(
      fold('seed', start),
      { feature: CHANNEL, option: 'divine-spark-restore', target: ALLY },
      'out_of_reach',
    );
    expect(left(start, ANSEL, 'channel-divinity')).toBe(2);
  });

  it('refuses an option the feature does not offer', () => {
    const state = fold('seed', table());
    const refused = usePoolOption(
      state,
      ANSEL,
      { feature: CHANNEL, option: 'command-undead' },
      supply(state),
    );
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_such_option');
  });

  /** A second call under the same command id lands once. */
  it('is idempotent under its command id', () => {
    const once = run(table(), (s) =>
      usePoolOption(
        s,
        ANSEL,
        { feature: CHANNEL, option: 'turn-undead', commandId: 'the-same' },
        supply(s, DOOMED),
      ),
    );
    const twice = run(once, (s) =>
      usePoolOption(
        s,
        ANSEL,
        { feature: CHANNEL, option: 'turn-undead', commandId: 'the-same' },
        supply(s, DOOMED),
      ),
    );
    expect(left(twice, ANSEL, 'channel-divinity')).toBe(1);
  });
});

// — vocabulary rather than a Channel Divinity special case ——————————————————

/**
 * A homebrew class whose feature confers a save out of its own pool, loaded
 * from JSON text through the door homebrew uses and driven through the public
 * API with **no engine change**.
 *
 * This is what proves the grant is vocabulary. `content.test.ts` is the
 * pattern: if the only thing this can express is the feature it was written
 * for, it is a special case wearing a grant's name.
 */
const WARDEN: unknown = {
  id: 'warden',
  name: 'Warden',
  hitDie: 8,
  primaryAbility: 'wis',
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['insight', 'perception', 'survival', 'nature'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
    cantripsKnown: 0,
    preparedSpells: 0,
    spellSlots: [2],
  })),
  startingEquipment: [{ option: 'A', items: [], goldPieces: 50 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  spellcasting: { ability: 'wis', style: 'prepared', progression: 'full', startsAtLevel: 1 },
  features: [
    {
      id: 'warden:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and prepared spells are tracked.',
    },
    {
      id: 'warden:rebuke',
      name: 'Warden’s Rebuke',
      level: 1,
      automation: 'engine',
      note: 'A pool whose use confers a saving throw that leaves its target Prone.',
      grants: {
        kind: 'pool',
        key: 'rebuke',
        label: 'Warden’s Rebuke',
        usesByLevel: Array.from({ length: 20 }, () => 3),
        recovers: 'long-rest',
        options: [
          {
            id: 'rebuke',
            name: 'Warden’s Rebuke',
            action: 'action',
            reach: 30,
            effects: [{ kind: 'save', ability: 'str', condition: 'prone' }],
            // What it hangs needs a span, because no casting ends it — the
            // rule an item's conferral keeps, asked of the other host.
            durationSeconds: 60,
            // And what cuts the span short, which no SRD feature prints and
            // the vocabulary carries because an item's does. A member no
            // content writes is a guess; this is the content that writes it.
            endsEarly: ['target-attacks'],
          },
          {
            id: 'bolt',
            name: 'Warden’s Bolt',
            action: 'action',
            reach: 30,
            // Two damage types under one saving throw, both flat, so the whole
            // outcome is arithmetic and no die is involved at all: the
            // spellcasting modifier rides the **first** component and nothing
            // else, which is SRD's "one damage roll" read on a feature.
            effects: [
              {
                kind: 'save-damage',
                ability: 'dex',
                damage: { flat: 4 },
                damageType: 'fire',
                addSpellcastingModifier: true,
                onSuccess: 'none',
                plus: [{ damage: { flat: 4 }, damageType: 'cold' }],
              },
            ],
          },
        ],
      },
    },
  ],
};

describe('a homebrew feature conferring a save', () => {
  const content = (): Content =>
    unwrap(
      extendContent(SRD_CONTENT, {
        classes: [unwrap(parseClassDefinition(JSON.parse(JSON.stringify(WARDEN))), 'parse')],
      }),
      'extend',
    );

  const warden: CharacterChoices = {
    name: 'Bryn',
    classId: 'warden',
    level: 1,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 10, dex: 12, con: 13, int: 8, wis: 15, cha: 14 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['insight', 'perception'],
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    cantrips: [],
    preparedSpells: [],
    spellbook: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'light'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  };

  it('loads, with no complaint from the validator', () => {
    expect(
      checkContent({ classes: [JSON.parse(JSON.stringify(WARDEN)) as ClassDefinition] }),
    ).toEqual([]);
    expect(content().classById('warden')?.id).toBe('warden');
  });

  it('forces its save and lands its condition, with no engine change', () => {
    const made = createCharacter(content(), warden, id('bryn'));
    if (!made.ok) throw new Error(`${made.code} — ${made.reason}`);
    const log: readonly GameEvent[] = [
      ...made.value,
      plain(THUG, 'Humanoid'),
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      { type: 'landmark-added', name: 'the gate', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: id('bryn'), placement: { from: { landmark: 'the gate' }, feet: 0 } },
      {
        type: 'creature-placed',
        id: THUG,
        placement: { from: { creature: id('bryn') }, feet: 10, bearing: 0 },
      },
    ];

    const rebuked = run(log, (s) =>
      usePoolOption(
        s,
        id('bryn'),
        { feature: 'warden:rebuke', option: 'rebuke', target: THUG },
        supply(s, DOOMED, content()),
      ),
    );

    expect(conditionsOf(rebuked, THUG)).toEqual(['prone']);
    expect(left(rebuked, id('bryn'), 'rebuke')).toBe(2);

    // The span the option printed, on the instance the option filed, with the
    // sentence that cuts it short — all three read back off the timer.
    const key = timerKey({
      kind: 'condition',
      on: THUG,
      instance: conditionInstanceId('prone', featureSource('warden:rebuke')),
    });
    expect(fold('seed', rebuked).timers[key]).toMatchObject({
      deadline: { kind: 'elapsed', at: 60 },
      endsEarly: ['target-attacks'],
    });
  });

  /**
   * SRD adds a spellcasting modifier to "one damage roll", and a feature reads
   * that sentence the way a casting does: the first component takes it and the
   * rest of the list gets nothing. Both components are flat, so the total is
   * arithmetic — 4 + 3 + 4 — and a modifier that rode both would read 14.
   */
  it('adds the holder’s modifier to one damage component and no other', () => {
    const made = createCharacter(content(), warden, id('bryn'));
    if (!made.ok) throw new Error(`${made.code} — ${made.reason}`);
    const log: readonly GameEvent[] = [...made.value, plain(THUG, 'Humanoid')];

    const struck = run(log, (s) =>
      usePoolOption(
        s,
        id('bryn'),
        { feature: 'warden:rebuke', option: 'bolt', target: THUG },
        supply(s, DOOMED, content()),
      ),
    );
    expect(hp(log, THUG) - hp(struck, THUG)).toBe(11);
  });
});
