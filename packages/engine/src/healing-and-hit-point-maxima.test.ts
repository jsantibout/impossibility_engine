import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  expect as unwrap,
  isErr,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { parseSpellDefinition } from './spell-schema.js';
import { healCreature, resolveSpell, resolveTurn, useSelfHeal } from './commands.js';
import {
  advanceCharacter,
  createCharacter,
  planCharacter,
  type CharacterChoices,
} from './creation.js';

/**
 * Two sentences the engine could not read, and the level-up that had to
 * survive one of them.
 *
 * > SRD Beacon of Hope: each target "regains the maximum number of Hit Points
 * > possible from any healing."
 * > SRD Chill Touch: on a hit "it can't regain Hit Points until the end of
 * > your next turn."
 * > SRD Aid: "Each target's Hit Point maximum and current Hit Points increase
 * > by 5 for the duration."
 *
 * The first two are a rule standing in front of healing — one pushing each
 * way — and the third moves the one number in `GameState` that is **folded
 * rather than derived**. That last fact is why the first test here is about
 * advancement rather than about a spell: `advanceCharacter` reads the stored
 * maximum, subtracts it from what the class table says the new level is worth,
 * and emits the difference. A spell holding the maximum five points up makes
 * that difference five points short — and when the spell ends, five points
 * that the level had bought go with it.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CLERIC = id('cleric');
const ALLY = id('ally');
const BRAM = id('bram');

/** A wounded Fighter, for the one self-heal the SRD prints with a die. */
const FIGHTER: CharacterChoices = {
  name: 'Bram',
  classId: 'fighter',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'intimidation'],
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
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
    'fighter:fighting-style': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
};

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 20, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const PREPARED = ['cure-wounds', 'beacon-of-hope', 'aid'];

const PLACED: readonly GameEvent[] = [
  added(CLERIC),
  // An Armour Class a spell attack cannot miss, so Chill Touch's fixture is
  // about the rule it hangs rather than about which way a die fell.
  added(ALLY, { stated: { armorClass: 1, proficiencyBonus: 2, initiative: 0 } }),
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CLERIC,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'cleric',
      cantrips: ['chill-touch'],
      prepared: PREPARED,
    }),
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { creature: CLERIC }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
  { type: 'sight-declared', from: ALLY, to: CLERIC, seen: true },
  { type: 'damage-taken', id: ALLY, amount: 40 },
];

/** The caster acts first, so "the end of your next turn" is a turn away. */
const SETUP: readonly GameEvent[] = [
  ...PLACED,
  {
    type: 'combat-started',
    combatants: [
      { id: CLERIC, initiative: 20, speed: 30 },
      { id: ALLY, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'cast') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'healing');

const cast = (
  log: readonly GameEvent[],
  spellId: string,
  targets: readonly CharacterId[],
  slotLevel?: number,
  seed = 'cast',
) =>
  must(
    resolveSpell(
      fold('seed', log),
      CLERIC,
      { spellId, targets: [...targets], ...(slotLevel === undefined ? {} : { slotLevel }) },
      supply(seed),
    ),
  );

/** The casting a resolution opened, which is what a dispel has to name. */
const castingOf = (events: readonly GameEvent[]): string => {
  const cast = events.find((e) => e.type === 'spell-cast');
  if (cast === undefined || cast.type !== 'spell-cast') throw new Error('nothing was cast');
  return cast.castingId;
};

/** Advance to whoever is next, settling anything the boundary owes. */
const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...must(resolveTurn(fold('seed', log), supply('turn'))).events,
];

const hp = (state: GameState, who: CharacterId) => state.creatures[who]?.vitals.hp ?? -1;
const hpMax = (state: GameState, who: CharacterId) => state.creatures[who]?.vitals.hpMax ?? -1;

describe('healing modified by an effect', () => {
  /**
   * SRD Beacon of Hope: "regains the maximum number of Hit Points possible
   * from any healing." Cure Wounds at a level 1 slot is "2d8 plus your
   * spellcasting ability modifier" — sixteen and the modifier, whatever the
   * dice showed.
   */
  it('restores the maximum a healing spell could roll while Beacon of Hope runs', () => {
    const beacon = cast(PLACED, 'beacon-of-hope', [ALLY], 3);
    const under = [...PLACED, ...beacon.events];

    const healed = cast(under, 'cure-wounds', [ALLY], 1);
    // Wisdom 20 is +5; 2d8 maximised is 16.
    expect(healed.outcomes.find((one) => one.target === ALLY)?.healed).toBe(21);
  });

  /** And without it, the dice are the dice: less than the maximum. */
  it('rolls its dice when nothing is standing beside the healing', () => {
    const healed = cast(PLACED, 'cure-wounds', [ALLY], 1);
    expect(healed.outcomes.find((one) => one.target === ALLY)?.healed).toBeLessThan(21);
  });

  /**
   * **"From any healing", and the other two doors dice go through.**
   *
   * A `heal` effect is not the only healing that throws dice: a turn
   * boundary's payout does, and a feature's own self-heal does. Both are the
   * phrase's plain meaning — a Regenerate paying out on a target of this
   * spell, a Second Wind spent standing in one — so both read the rule the
   * creature is carrying.
   *
   * The grant is written by hand rather than cast, because what is under test
   * is the *reader* rather than the door: the casting half is the Beacon of
   * Hope fixture above.
   */
  const maximised = (who: CharacterId): GameEvent => ({
    type: 'healing-rule-granted',
    id: who,
    rule: { source: 'Beacon of Hope#cast:9', rule: 'maximised' },
  });

  it('maximises a payout of healing at a turn boundary', () => {
    const owed: GameEvent = {
      type: 'turn-payout-granted',
      id: ALLY,
      payout: {
        source: 'Regenerate#cast:9',
        at: 'start-of-turn',
        payout: 'healing',
        dice: '4d8',
        flat: 0,
      },
    };

    const paid = (log: readonly GameEvent[]): number => {
      const before = hp(fold('seed', log), ALLY);
      const after = nextTurn(log);
      return hp(fold('seed', after), ALLY) - before;
    };

    // The caster holds the turn, so one advance reaches the ally's start.
    const plain: readonly GameEvent[] = [...SETUP, owed];
    expect(paid([...plain, maximised(ALLY)])).toBe(32);
    expect(paid(plain)).toBeLessThan(32);
  });

  it('maximises a feature’s own self-heal', () => {
    const wounded: readonly GameEvent[] = [
      ...must(createCharacter(SRD_CONTENT, FIGHTER, BRAM)),
      { type: 'damage-taken', id: BRAM, amount: 20 },
    ];
    const healed = (log: readonly GameEvent[]): number => {
      const done = must(
        useSelfHeal(fold('seed', log), BRAM, { feature: 'fighter:second-wind' }, supply('wind')),
      );
      const before = hp(fold('seed', log), BRAM);
      return hp(fold('seed', [...log, ...done]), BRAM) - before;
    };

    // SRD Second Wind: "1d10 plus your Fighter level", so a level 3 Fighter
    // maximises to thirteen and cannot reach it on the dice.
    expect(healed([...wounded, maximised(BRAM)])).toBe(13);
    expect(healed(wounded)).toBeLessThan(13);
  });

  /**
   * SRD Chill Touch: "it can't regain Hit Points until the end of your next
   * turn." The casting is a cantrip and Instantaneous, so the rule is a rider
   * with a deadline of its own — the shape Ray of Frost's Speed reduction
   * already takes.
   */
  it('refuses the hit points a spell would restore while Chill Touch holds', () => {
    const touched = cast(SETUP, 'chill-touch', [ALLY]);
    expect(touched.events.some((e) => e.type === 'healing-rule-granted')).toBe(true);

    // The caster's turn, the ally's, and back to the caster: "the end of your
    // next turn" has not arrived, so the refusal is still standing.
    const under = nextTurn(nextTurn([...SETUP, ...touched.events]));
    const before = hp(fold('seed', under), ALLY);
    const healed = cast(under, 'cure-wounds', [ALLY], 1);

    expect(healed.outcomes.find((one) => one.target === ALLY)?.healed).toBe(0);
    expect(hp(fold('seed', [...under, ...healed.events]), ALLY)).toBe(before);
  });

  /** The command is the door, so it refuses whoever knocks on it. */
  it('emits no healing at all for a creature that cannot regain hit points', () => {
    const under = fold('seed', [...SETUP, ...cast(SETUP, 'chill-touch', [ALLY]).events]);
    expect(must(healCreature(under, ALLY, 12))).toEqual([]);
  });

  /**
   * **And a use whose healing was refused is still a use that was spent.**
   *
   * A batch's command id is recorded by whichever of its events carries it,
   * and this rule can take the `healed` event away — so a Second Wind spent
   * under a Chill Touch had nothing left to carry the stamp, recorded no id,
   * and could be spent again on a retry. The stamp is on the `resource-spent`
   * now, which is the event that always happens.
   */
  it('is idempotent under its command id even when the healing is refused', () => {
    const under: readonly GameEvent[] = [
      ...must(createCharacter(SRD_CONTENT, FIGHTER, BRAM)),
      { type: 'damage-taken', id: BRAM, amount: 20 },
      {
        type: 'healing-rule-granted',
        id: BRAM,
        rule: { source: 'Chill Touch#cast:1', rule: 'prevented' },
      },
    ];
    const use = { feature: 'fighter:second-wind', commandId: 'c1' };

    const first = must(useSelfHeal(fold('seed', under), BRAM, use, supply('wind')));
    expect(first.some((event) => 'command' in event && event.command !== undefined)).toBe(true);
    expect(first.some((event) => event.type === 'healed')).toBe(false);

    const after = fold('seed', [...under, ...first]);
    expect(must(useSelfHeal(after, BRAM, use, supply('wind')))).toEqual([]);
    expect(after.creatures[BRAM]?.resources.pools['second-wind']?.spent).toBe(1);
  });

  /** And the deadline gives the hit points back: two of the caster's turn ends later. */
  it('lets healing land once the deadline has passed', () => {
    let log: readonly GameEvent[] = [...SETUP, ...cast(SETUP, 'chill-touch', [ALLY]).events];
    for (let i = 0; i < 4; i += 1) log = nextTurn(log);
    expect(fold('seed', log).creatures[ALLY]?.healingRules).toEqual([]);

    const healed = cast(log, 'cure-wounds', [ALLY], 1);
    expect(healed.outcomes.find((one) => one.target === ALLY)?.healed).toBeGreaterThan(0);
  });
});

describe('a hit point maximum a spell moves', () => {
  /**
   * SRD Aid: "Each target's Hit Point maximum and current Hit Points increase
   * by 5 for the duration." Both, and the current total rises because the
   * points were never lost.
   */
  it('raises the maximum and the current total together', () => {
    const before = fold('seed', PLACED);
    const aided = cast(PLACED, 'aid', [ALLY], 2);
    const after = fold('seed', [...PLACED, ...aided.events]);

    expect(hpMax(after, ALLY)).toBe(hpMax(before, ALLY) + 5);
    expect(hp(after, ALLY)).toBe(hp(before, ALLY) + 5);
  });

  /** "Each target's Hit Points increase by 5 for each spell slot level above 2." */
  it('grows by five for every slot level above the second', () => {
    const before = fold('seed', PLACED);
    const aided = cast(PLACED, 'aid', [ALLY], 3);
    expect(hpMax(fold('seed', [...PLACED, ...aided.events]), ALLY)).toBe(hpMax(before, ALLY) + 10);
  });

  /**
   * **A creature at 0 hit points keeps them**, which is a reading rather than
   * a printed sentence and is therefore the one thing here a table might
   * settle the other way. Raising the current total would lift the Unconscious
   * that having none caused, and the SRD lifts that "until you regain any Hit
   * Points" — which a maximum does not do. So the maximum rises alone and the
   * dying go on dying.
   */
  it('raises the maximum of a creature at 0 hit points and leaves it there', () => {
    const down: readonly GameEvent[] = [...PLACED, { type: 'damage-taken', id: ALLY, amount: 20 }];
    expect(hp(fold('seed', down), ALLY)).toBe(0);

    const aided = fold('seed', [...down, ...cast(down, 'aid', [ALLY], 2).events]);
    expect(hpMax(aided, ALLY)).toBe(65);
    expect(hp(aided, ALLY)).toBe(0);
  });

  /** And the dead are not raised by five points of ceiling either. */
  it('leaves a dead creature dead', () => {
    const dead: readonly GameEvent[] = [...PLACED, { type: 'creature-died', id: ALLY, cause: 'a mace' }];
    const aided = fold('seed', [...dead, ...cast(dead, 'aid', [ALLY], 2).events]);

    expect(aided.creatures[ALLY]?.vitals.dead).toBe(true);
    expect(hpMax(aided, ALLY)).toBe(65);
    expect(hp(aided, ALLY)).toBe(0);
  });

  /**
   * And it goes back when the casting does. The current total is clamped
   * rather than reduced: a target wounded below the ordinary maximum keeps
   * what it has.
   */
  it('gives the maximum back when the casting ends', () => {
    const before = fold('seed', PLACED);
    const aided = cast(PLACED, 'aid', [ALLY], 2);
    const castingId = castingOf(aided.events);

    const ended = fold('seed', [
      ...PLACED,
      ...aided.events,
      { type: 'spell-ended', castingId, on: null, reason: 'dispelled' },
    ]);

    expect(hpMax(ended, ALLY)).toBe(hpMax(before, ALLY));
    expect(hp(ended, ALLY)).toBe(hp(before, ALLY) + 5);
  });
});

/**
 * The level-up, which is the defect the shape had to be built around.
 *
 * A real SRD Cleric rather than a dummy, because what is under test is
 * `advanceCharacter`'s own arithmetic: it reads the stored maximum and emits
 * the difference between it and what the class table says the new level is
 * worth.
 */
describe('a moved maximum survives a level-up', () => {
  const choices = (level: number): CharacterChoices => ({
    name: 'Ilka',
    classId: 'cleric',
    level,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
    },
    abilityIncreases: { wis: 2, con: 1 },
    classSkills: ['insight', 'religion'],
    languages: ['Dwarvish', 'Giant'],
    alignment: 'Lawful Good',
    subclassId: 'life-domain',
    cantrips: level >= 4 ? ['sacred-flame', 'guidance', 'light', 'mending'] : ['sacred-flame', 'guidance', 'light'],
    spellbook: [],
    preparedSpells: [
      'aid',
      'healing-word',
      'bane',
      'blindness-deafness',
      'hold-person',
      'guiding-bolt',
      ...(level >= 4 ? ['cure-wounds'] : []),
    ],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'], 'cleric:divine-order': ['Protector'] },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'ray-of-frost'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'medicine'] },
      ...(level >= 4 ? { 'cleric:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  });

  /** What a level 4 asks that a level 3 did not: a cantrip, a prepared spell, a feat. */
  const LEVELLING = {
    cantrips: choices(4).cantrips,
    preparedSpells: choices(4).preparedSpells,
    featureChoices: choices(4).featureChoices,
    feats: choices(4).feats,
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'nothing new' },
  };

  const planned = (level: number): number =>
    must(planCharacter(SRD_CONTENT, choices(level))).hitPointMaximum;

  const born: readonly GameEvent[] = [
    ...must(createCharacter(SRD_CONTENT, choices(3), CLERIC)),
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the shrine', at: { x: 50, y: 50, z: 0 } },
    {
      type: 'creature-placed',
      id: CLERIC,
      placement: { from: { landmark: 'the shrine' }, feet: 0 },
    },
  ];

  it('is the plan’s own number before anything moves it', () => {
    expect(hpMax(fold('seed', born), CLERIC)).toBe(planned(3));
  });

  /**
   * The whole of the level's hit points, not the level's hit points minus what
   * Aid was holding up — and Aid's five still there on top when it is done.
   */
  it('grants the whole of the new level while Aid is holding the maximum up', () => {
    const aided = must(
      resolveSpell(fold('seed', born), CLERIC, { spellId: 'aid', targets: [CLERIC], slotLevel: 2 }, supply()),
    );
    const held: readonly GameEvent[] = [...born, ...aided.events];
    expect(hpMax(fold('seed', held), CLERIC)).toBe(planned(3) + 5);

    const up = must(advanceCharacter(fold('seed', held), SRD_CONTENT, CLERIC, LEVELLING));
    const after = fold('seed', [...held, ...up]);

    expect(after.creatures[CLERIC]?.sheet.level).toBe(4);
    expect(hpMax(after, CLERIC)).toBe(planned(4) + 5);
  });

  /** And when the spell ends, the character keeps the level and loses the five. */
  it('leaves the level’s own hit points behind when the casting ends', () => {
    const aided = must(
      resolveSpell(fold('seed', born), CLERIC, { spellId: 'aid', targets: [CLERIC], slotLevel: 2 }, supply()),
    );
    const held: readonly GameEvent[] = [...born, ...aided.events];
    const up = must(advanceCharacter(fold('seed', held), SRD_CONTENT, CLERIC, LEVELLING));
    const ended = fold('seed', [
      ...held,
      ...up,
      { type: 'spell-ended', castingId: castingOf(aided.events), on: null, reason: 'dispelled' },
    ]);

    expect(hpMax(ended, CLERIC)).toBe(planned(4));
  });
});

/**
 * What a definition may not say, at the door homebrew comes through.
 *
 * Each of these is a rule the runtime relies on rather than a taste: a grant
 * nobody could lift, a maximum nothing could give back, a die thrown once and
 * carried for eight hours, and a word the book does not print.
 */
describe('the two kinds are held to what the book writes', () => {
  const instantaneous = (effects: readonly unknown[]): Record<string, unknown> => ({
    id: 'homebrew-mercy',
    name: 'Homebrew Mercy',
    level: 1,
    school: 'abjuration',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 30 },
    targets: { count: 1 },
    effects,
  });

  const codeOf = (value: Record<string, unknown>): string | null => {
    const parsed = parseSpellDefinition(value);
    return isErr(parsed) ? parsed.code : null;
  };

  /**
   * A casting that is over the moment it resolves can never lift what it hung,
   * and both kinds are things it would leave standing: a creature unable to
   * regain hit points for ever, or five points richer for ever.
   */
  it('refuses either kind on a casting with nothing to end it', () => {
    expect(codeOf(instantaneous([{ kind: 'healing-rule', rule: 'maximised' }]))).toBe(
      'grant_without_lifetime',
    );
    expect(codeOf(instantaneous([{ kind: 'hit-point-maximum', amount: { flat: 5 } }]))).toBe(
      'grant_without_lifetime',
    );
  });

  it('accepts both once the casting runs', () => {
    expect(
      codeOf({
        ...instantaneous([
          { kind: 'healing-rule', rule: 'prevented' },
          { kind: 'hit-point-maximum', amount: { flat: 5, flatPerSlotLevelAbove: 5 } },
        ]),
        durationSeconds: 3600,
      }),
    ).toBeNull();
  });

  /** And a rider's own deadline is the other escape, which is Chill Touch's. */
  it('accepts the rider on an instantaneous host once it says how long it lasts', () => {
    const withRider = (lasts?: string): Record<string, unknown> =>
      instantaneous([
        {
          kind: 'attack',
          attack: 'melee',
          damage: { dice: '1d10' },
          damageType: 'necrotic',
          modifiers: [
            { kind: 'healing', rule: 'prevented', ...(lasts === undefined ? {} : { lasts }) },
          ],
        },
      ]);
    expect(codeOf(withRider())).toBe('grant_without_lifetime');
    expect(codeOf(withRider('end-of-casters-next-turn'))).toBeNull();
  });

  /** The two words the book prints, and nothing else. */
  it('refuses a rule the book does not say', () => {
    expect(
      codeOf({
        ...instantaneous([{ kind: 'healing-rule', rule: 'halved' }]),
        durationSeconds: 3600,
      }),
    ).toBe('unknown_healing_rule');
  });

  /**
   * The amount's own two rules: a printed number, and upwards. A rolled
   * maximum is a die thrown once and then carried for hours with nothing in
   * the log to account for it, and this kind carries no reduction.
   */
  it('refuses a rolled maximum and a maximum that is not a raise', () => {
    const amount = (value: Record<string, unknown>): Record<string, unknown> => ({
      ...instantaneous([{ kind: 'hit-point-maximum', amount: value }]),
      durationSeconds: 3600,
    });
    expect(codeOf(amount({ dice: '1d4' }))).toBe('rolled_hit_point_maximum');
    expect(codeOf(amount({ flat: -5 }))).toBe('bad_hit_point_maximum');
    expect(codeOf(amount({ flat: 5, flatPerSlotLevelAbove: 0 }))).toBe('bad_hit_point_maximum');
    expect(codeOf(amount({ flat: 2.5 }))).toBe('bad_hit_point_maximum');
  });
});

/** Nothing above reads a creature that is not there. */
describe('the fixtures are the fight they claim to be', () => {
  it('starts with a wounded ally and a caster holding slots', () => {
    const state = fold('seed', SETUP);
    expect(hp(state, ALLY)).toBe(20);
    expect(hpMax(state, ALLY)).toBe(60);
    expect(applyEvent(state, { type: 'healed', id: ALLY, amount: 1 }).creatures[ALLY]?.vitals.hp).toBe(21);
  });
});
