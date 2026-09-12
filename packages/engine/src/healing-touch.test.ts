import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, isNeedsContext, expect as unwrap } from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import { createCharacter, liftsFor, type CharacterChoices } from './creation.js';
import type { FeatureDefinition } from './progression.js';
import { useHealingTouch } from './commands.js';
import { remaining } from './resources.js';

/**
 * A pool measured in hit points, spent by touching somebody.
 *
 * SRD Lay On Hands: "you can touch a creature (which could be yourself) and
 * draw power from the pool of healing to restore a number of Hit Points to
 * that creature, up to the maximum amount remaining in the pool. You can also
 * expend 5 Hit Points from the pool of healing power to remove the Poisoned
 * condition from the creature; **those points don't also restore Hit Points**."
 *
 * Restoring Touch is the same feature with a longer list — Blinded, Charmed,
 * Deafened, Frightened, Paralyzed, Stunned, at the same 5 apiece — which makes
 * it the "Improved X" case the Champion's critical range already settled: the
 * second feature widens the first rather than being a second mechanism.
 *
 * The pool has been declared, correctly sized at five times the Paladin level,
 * since the batch that found nine features claiming pools they did not have.
 * Nothing spent it.
 */

const id = (s: string) => asCharacterId(s);
const SER = id('ser');
const ALLY = id('ally');

/** SRD Paladin Features table, Prepared Spells column. */
const PREPARED = [2, 3, 4, 5, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 14, 14, 15, 15];

const paladin = (level: number): CharacterChoices => ({
  name: 'Ser',
  classId: 'paladin',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { int: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Lawful Good',
  ...(level >= 3 ? { subclassId: 'oath-of-devotion' } : {}),
  cantrips: [],
  preparedSpells: [
    'cure-wounds',
    'bless',
    'heroism',
    'divine-favor',
    'shield-of-faith',
    'aid',
    'lesser-restoration',
    'magic-weapon',
    'warding-bond',
    'revivify',
    'dispel-magic',
    'daylight',
    'remove-curse',
    'death-ward',
    'banishment',
    'aura-of-life',
  ].slice(0, PREPARED[level - 1] ?? 0),
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
    ...(level >= 2 ? { 'paladin:fighting-style': { featId: 'defense' } } : {}),
    ...(level >= 4 ? { 'paladin:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
    ...(level >= 8 ? { 'paladin:ability-score-improvement-2': { featId: 'alert' } } : {}),
    ...(level >= 12
      ? { 'paladin:ability-score-improvement-3': { featId: 'savage-attacker' } }
      : {}),
    ...(level >= 16
      ? { 'paladin:ability-score-improvement-4': { featId: 'savage-attacker' } }
      : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

class Game {
  private events: GameEvent[];

  constructor(initial: readonly GameEvent[]) {
    this.events = [...initial];
  }

  get state(): GameState {
    return fold('seed', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  creature(who: string) {
    const creature = this.state.creatures[who];
    if (creature === undefined) throw new Error(`${who} is not in the game`);
    return creature;
  }

  hp(who: string): number {
    return this.creature(who).vitals.hp;
  }

  left(who: string, key: string): number {
    return remaining(this.creature(who).resources, key);
  }
}

/** Built, or the refusal — so a broken fixture says which rule it broke. */
const game = (level: number): Game => {
  const out = createCharacter(paladin(level), SER);
  if (!out.ok) throw new Error(`paladin ${level}: ${out.code} — ${out.reason}`);
  return new Game([
    ...out.value,
    {
      type: 'creature-added',
      id: ALLY,
      name: 'ally',
      sheet: {
        level: 3,
        abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
        skills: {},
        saveProficiencies: [],
        armor: null,
        shield: null,
        armorTraining: { light: false, medium: false, heavy: false, shields: false },
        baseSpeed: 30,
        spellcastingAbility: null,
      },
      maxHp: 40,
      diesAtZero: true,
      creatureType: 'Humanoid',
    },
    { type: 'damage-taken', id: ALLY, amount: 25, source: 'a trap' },
    { type: 'damage-taken', id: SER, amount: 5, source: 'a trap' },
  ]);
};

const touch = (
  g: Game,
  command: {
    target?: string;
    hitPoints?: number;
    lift?: readonly string[];
    commandId?: string;
    feature?: string;
  } = {},
) =>
  useHealingTouch(g.state, SER, {
    feature: command.feature ?? 'paladin:lay-on-hands',
    target: id(command.target ?? 'ally'),
    ...(command.hitPoints === undefined ? {} : { hitPoints: command.hitPoints }),
    ...(command.lift === undefined ? {} : { lift: command.lift as never }),
    ...(command.commandId === undefined ? {} : { commandId: command.commandId }),
  });

const poisoned = (who: string): GameEvent => ({
  type: 'condition-applied',
  id: id(who),
  condition: 'poisoned',
  source: 'a spider',
});

describe('Lay On Hands', () => {
  /** SRD: "a total number of Hit Points equal to five times your Paladin level." */
  it('holds five hit points per Paladin level', () => {
    expect(game(1).left('ser', 'lay-on-hands')).toBe(5);
    expect(game(5).left('ser', 'lay-on-hands')).toBe(25);
  });

  it('restores exactly the hit points drawn, and spends exactly that many', () => {
    const g = game(5);
    const before = g.hp('ally');
    g.push(unwrap(touch(g, { hitPoints: 10 }), 'touch'));

    expect(g.hp('ally')).toBe(before + 10);
    expect(g.left('ser', 'lay-on-hands')).toBe(15);
  });

  /** "up to the maximum amount remaining in the pool" — and no further. */
  it('refuses to draw more than the pool holds, and costs nothing', () => {
    const g = game(1);
    const out = touch(g, { hitPoints: 6 });
    expect(isErr(out) && out.code).toBe('exhausted');
    expect(g.left('ser', 'lay-on-hands')).toBe(5);
  });

  /** "which could be yourself". */
  it('can be turned on the Paladin', () => {
    const g = game(5);
    const before = g.hp('ser');
    g.push(unwrap(touch(g, { target: 'ser', hitPoints: 4 }), 'touch'));
    expect(g.hp('ser')).toBe(before + 4);
  });

  /** Healing never overshoots the maximum; `healCreature` owns that rule. */
  it('does not overshoot the hit point maximum', () => {
    const g = game(18);
    const max = g.creature('ally').vitals.hpMax;
    g.push(unwrap(touch(g, { hitPoints: 60 }), 'touch'));
    expect(g.hp('ally')).toBe(max);
  });

  it('refuses a drawing of nothing at all', () => {
    const g = game(5);
    const out = touch(g, { hitPoints: 0 });
    expect(isErr(out) && out.code).toBe('nothing_drawn');
  });

  it('refuses a fractional or negative drawing', () => {
    expect(isErr(touch(game(5), { hitPoints: 2.5 }))).toBe(true);
    expect(isErr(touch(game(5), { hitPoints: -3 }))).toBe(true);
  });

  it('refuses a feature this Paladin does not have', () => {
    const out = touch(game(5), { hitPoints: 1, feature: 'paladin:restoring-touch' });
    expect(isErr(out) && out.code).toBe('no_such_feature');
  });

  /** A retry with the same id is a no-op, not a second helping. */
  it('is idempotent under a repeated command id', () => {
    const g = game(5);
    g.push(unwrap(touch(g, { hitPoints: 6, commandId: 'c1' }), 'first'));
    const hp = g.hp('ally');

    expect(unwrap(touch(g, { hitPoints: 6, commandId: 'c1' }), 'second')).toEqual([]);
    expect(g.hp('ally')).toBe(hp);
    expect(g.left('ser', 'lay-on-hands')).toBe(19);
  });
});

describe('the five points that end the Poisoned condition', () => {
  /**
   * SRD: "You can also expend 5 Hit Points from the pool of healing power to
   * remove the Poisoned condition from the creature; **those points don't also
   * restore Hit Points to the creature.**"
   *
   * The second half is the half that gets dropped, and it is the whole reason
   * the cost and the healing are separate numbers rather than one.
   */
  it('costs five, and those five heal nothing', () => {
    const g = game(5).push([poisoned('ally')]);
    const before = g.hp('ally');

    g.push(unwrap(touch(g, { lift: ['poisoned'] }), 'touch'));

    expect(g.creature('ally').conditions.conditions).not.toContain('poisoned');
    expect(g.hp('ally')).toBe(before);
    expect(g.left('ser', 'lay-on-hands')).toBe(20);
  });

  /** Both halves in one touch: the hit points, and the five on top of them. */
  it('adds to a drawing of hit points rather than replacing it', () => {
    const g = game(5).push([poisoned('ally')]);
    const before = g.hp('ally');

    g.push(unwrap(touch(g, { hitPoints: 3, lift: ['poisoned'] }), 'touch'));

    expect(g.hp('ally')).toBe(before + 3);
    expect(g.left('ser', 'lay-on-hands')).toBe(25 - 3 - 5);
  });

  /** The whole drawing has to fit, and a refusal costs nothing. */
  it('refuses when the pool cannot cover both halves', () => {
    const g = game(1).push([poisoned('ally')]);
    const out = touch(g, { hitPoints: 1, lift: ['poisoned'] });
    expect(isErr(out) && out.code).toBe('exhausted');
    expect(g.left('ser', 'lay-on-hands')).toBe(5);
  });

  /** A level 1 Paladin may not lift Blinded; only Restoring Touch adds it. */
  it('refuses a condition this Paladin cannot lift', () => {
    const g = game(5);
    const out = touch(g, { lift: ['blinded'] });
    expect(isErr(out) && out.code).toBe('cannot_lift');
  });

  /** Every instance goes, because the SRD removes the condition rather than a cause. */
  it('lifts every cause of the condition', () => {
    const g = game(5).push([
      poisoned('ally'),
      { type: 'condition-applied', id: ALLY, condition: 'poisoned', source: 'a bad oyster' },
    ]);
    g.push(unwrap(touch(g, { lift: ['poisoned'] }), 'touch'));
    expect(g.creature('ally').conditions.conditions).not.toContain('poisoned');
  });
});

describe('Restoring Touch', () => {
  /** SRD level 14: six more conditions, at the same five points each. */
  it('adds its six conditions to the list the Paladin can lift', () => {
    const lifts = (level: number) =>
      [...((game(level).creature('ser').sheet.healingTouch ?? [])[0]?.lifts ?? [])].sort();

    expect(lifts(13)).toEqual(['poisoned']);
    expect(lifts(14)).toEqual([
      'blinded',
      'charmed',
      'deafened',
      'frightened',
      'paralyzed',
      'poisoned',
      'stunned',
    ]);
  });

  /** "You must expend 5 Hit Points ... for **each** of these conditions." */
  it('charges five for each condition lifted', () => {
    const g = game(14).push([
      { type: 'condition-applied', id: ALLY, condition: 'blinded', source: 'a flash' },
      { type: 'condition-applied', id: ALLY, condition: 'deafened', source: 'a bell' },
    ]);
    const before = g.hp('ally');

    g.push(unwrap(touch(g, { lift: ['blinded', 'deafened'] }), 'touch'));

    expect(g.creature('ally').conditions.conditions).not.toContain('blinded');
    expect(g.creature('ally').conditions.conditions).not.toContain('deafened');
    expect(g.hp('ally')).toBe(before);
    expect(g.left('ser', 'lay-on-hands')).toBe(70 - 10);
  });

  /** Naming the same condition twice must not charge ten for one lifting. */
  it('refuses a repeated condition rather than charging twice', () => {
    const g = game(14);
    const out = touch(g, { lift: ['blinded', 'blinded'] });
    expect(isErr(out) && out.code).toBe('duplicate_condition');
  });
});

describe('touch, when the table is keeping positions', () => {
  const placed = (g: Game, feet: number): Game =>
    g.push([
      { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
      { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: SER, placement: { from: { landmark: 'here' }, feet: 0 } },
      {
        type: 'creature-placed',
        id: ALLY,
        placement: { from: { creature: SER }, feet, bearing: 0 },
      },
    ]);

  /** SRD: "you can touch a creature" — five feet, the same reach a fist has. */
  it('reaches an adjacent ally', () => {
    const g = placed(game(5), 5);
    expect(touch(g, { hitPoints: 5 }).ok).toBe(true);
  });

  /**
   * Five feet, and the number that proves it is ten.
   *
   * A test at twenty feet cannot tell a touch from a Reach weapon — a mutation
   * widening the reach to ten passed the whole file. One square further out is
   * the only distance that separates them.
   */
  it('refuses one ten feet away, which a Reach weapon would have managed', () => {
    const g = placed(game(5), 10);
    const out = touch(g, { hitPoints: 5 });
    expect(isErr(out) && out.code).toBe('out_of_reach');
    expect(g.left('ser', 'lay-on-hands')).toBe(25);
  });

  it('refuses one well out of reach, and costs nothing', () => {
    const g = placed(game(5), 20);
    const out = touch(g, { hitPoints: 5 });
    expect(isErr(out) && out.code).toBe('out_of_reach');
    expect(g.left('ser', 'lay-on-hands')).toBe(25);
  });

  /**
   * No scene at all is a table not using positioning, not a gap in a record —
   * so the touch lands, exactly as an attack does. A scene with somebody
   * unplaced is the other case, and it is a request rather than a refusal.
   */
  it('asks where an unplaced creature is standing rather than refusing', () => {
    const g = game(5).push([
      { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
      { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: SER, placement: { from: { landmark: 'here' }, feet: 0 } },
    ]);
    const out = touch(g, { hitPoints: 5 });
    expect(isNeedsContext(out)).toBe(true);
  });

  it('lands with no scene at all', () => {
    expect(touch(game(5), { hitPoints: 5 }).ok).toBe(true);
  });

  /** A Paladin always reaches themselves, placed or not. */
  it('always reaches the Paladin themselves', () => {
    const g = game(5).push([
      { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
      { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
    ]);
    expect(touch(g, { target: 'ser', hitPoints: 3 }).ok).toBe(true);
  });
});

describe('the Bonus Action it costs', () => {
  const fighting = (g: Game): Game =>
    g.push([
      {
        type: 'combat-started',
        combatants: [
          { id: SER, initiative: 20, speed: 30 },
          { id: ALLY, initiative: 10, speed: 30 },
        ],
      },
    ]);

  it('spends the Bonus Action in combat, and refuses a second', () => {
    const g = fighting(game(5));
    const events = unwrap(touch(g, { hitPoints: 3 }), 'touch');
    expect(events.map((e) => e.type)).toContain('bonus-action-spent');

    g.push(events);
    const again = touch(g, { hitPoints: 3 });
    expect(isErr(again) && again.code).toBe('no_bonus_action');
  });

  it('costs no Bonus Action outside combat', () => {
    const events = unwrap(touch(game(5), { hitPoints: 3 }), 'touch');
    expect(events.map((e) => e.type)).not.toContain('bonus-action-spent');
  });
});

/**
 * Which pool a widening feature names.
 *
 * Restoring Touch is the only `lifts-conditions` grant in the SRD, so no
 * character the engine can build has two healing pools to confuse — and a
 * mutation that ignored the pool key entirely passed every test. `liftsFor`
 * is pure over a list of features, so a list with two pools in it can simply
 * be written, which is the difference between an untested rule and an
 * unreachable one.
 */
describe('a widening that names a pool', () => {
  const feature = (id: string, grants: FeatureDefinition['grants']): FeatureDefinition => ({
    id,
    name: id,
    level: 1,
    automation: 'engine',
    note: 'a fixture',
    ...(grants === undefined ? {} : { grants }),
  });

  const features: readonly FeatureDefinition[] = [
    feature('test:widens-hands', {
      kind: 'lifts-conditions',
      pool: 'lay-on-hands',
      conditions: ['blinded'],
    }),
    feature('test:widens-something-else', {
      kind: 'lifts-conditions',
      pool: 'some-other-pool',
      conditions: ['stunned'],
    }),
  ];

  it('adds only to the pool it names', () => {
    expect(liftsFor(features, 'lay-on-hands', ['poisoned'])).toEqual(['blinded', 'poisoned']);
    expect(liftsFor(features, 'some-other-pool', [])).toEqual(['stunned']);
  });

  it('unions rather than counting, and sorts, because the sheet is compared', () => {
    const twice = [
      ...features,
      feature('test:again', {
        kind: 'lifts-conditions',
        pool: 'lay-on-hands',
        conditions: ['blinded', 'charmed'],
      }),
    ];
    expect(liftsFor(twice, 'lay-on-hands', ['poisoned'])).toEqual([
      'blinded',
      'charmed',
      'poisoned',
    ]);
  });
});
