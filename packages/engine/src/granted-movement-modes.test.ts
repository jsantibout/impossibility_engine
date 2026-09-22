import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { fliesWithoutFallingOn, hasSpeedInModeOn, speedOf } from './standing.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { checkFeatureDefinition } from './feature-schema.js';
import { checkContent } from './content.js';
import { applyConditionTo, endConcentration, resolveMove, resolveSpell } from './commands.js';
import { flightLost } from './commands/movement.js';

/**
 * The writers movement modes never got.
 *
 * Wave 1.5b built the reader half whole — four Speeds on the sheet and off a
 * stat block, a move that names its mode, the surcharge for going without the
 * Speed, a flier who is stopped falling, both jumps — and nothing in the
 * engine could **grant** a mode, so no spell and no feature moved.
 *
 * Three writers, and they are the three doors a Speed already comes through:
 *
 * | | SRD | What it writes |
 * |---|---|---|
 * | a spell, a fixed Speed | Fly, "a Fly Speed of 60 feet and can hover" | `{ change: 'add', feet: 60, mode: 'fly', hover: true }` |
 * | a spell, the walking Speed again | Spider Climb, "a Climb Speed equal to its Speed" | `{ change: 'match-walk', mode: 'climb' }` |
 * | a feature | Second-Story Work, "a Climb Speed equal to your Speed" | the same pair on a `StandingGrant` |
 *
 * And the sibling the reader half flagged for whoever got here:
 * `hasSpeedInMode` and `fliesWithoutFalling` read the **sheet**, so a creature
 * whose only Fly Speed is a granted one was refused the flight it had been
 * given. {@link hasSpeedInModeOn} and {@link fliesWithoutFallingOn} are the
 * state-level pair, and every rule that asks "can it fly at all" asks those.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const SEED = 'modes';

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 11,
  abilities: { str: 10, dex: 10, con: 10, int: 20, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

const slots: readonly GameEvent[] = [2, 3].map((level) => ({
  type: 'resource-pool-declared',
  id: CASTER,
  pool: {
    key: spellSlotKey(level),
    label: `level ${level} spell slot`,
    max: 4,
    recovers: 'long-rest',
  },
}));

const SETUP: readonly GameEvent[] = [
  added(CASTER),
  added(TARGET),
  ...slots,
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: [],
      prepared: ['fly', 'spider-climb'],
    }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 200 } },
  { type: 'landmark-added', name: 'the ford', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'the ford' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { landmark: 'the ford' }, feet: 5, bearing: 0 },
  },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'granted modes');

const applyAll = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce(applyEvent, state);

const castOn = (log: readonly GameEvent[], spellId: string, slotLevel: number): GameState => {
  const before = fold(SEED, log);
  return applyAll(
    before,
    must(resolveSpell(before, CASTER, { spellId, targets: [TARGET], slotLevel }, supply(spellId)))
      .events,
  );
};

describe('a spell grants a Fly Speed', () => {
  /**
   * SRD Fly, whole: "You touch a willing creature. For the duration, the
   * target gains a Fly Speed of 60 feet and can hover."
   */
  it('gives a creature with no Fly Speed one, and leaves the walk alone', () => {
    const before = fold(SEED, SETUP);
    expect(speedOf(before, TARGET, 'fly')).toBe(0);
    expect(hasSpeedInModeOn(before, TARGET, 'fly')).toBe(false);

    const after = castOn(SETUP, 'fly', 3);
    expect(speedOf(after, TARGET, 'fly')).toBe(60);
    expect(hasSpeedInModeOn(after, TARGET, 'fly')).toBe(true);
    expect(speedOf(after, TARGET)).toBe(30);
  });

  it('lets the target fly, which the reader half refused outright', () => {
    const before = fold(SEED, SETUP);
    const refused = resolveMove(
      before,
      TARGET,
      { placement: { from: { landmark: 'the ford' }, feet: 40, bearing: 0 }, mode: 'fly' },
      supply('walk'),
    );
    expect(isErr(refused) && refused.code).toBe('no_such_speed');

    const after = castOn(SETUP, 'fly', 3);
    const flown = resolveMove(
      after,
      TARGET,
      { placement: { from: { landmark: 'the ford' }, feet: 40, bearing: 0 }, mode: 'fly' },
      supply('fly-move'),
    );
    expect(isErr(flown)).toBe(false);
  });

  /**
   * SRD "Flying": "the creature falls unless it has the Hover trait" — and
   * Fly's own sentence hands the target that trait, so a Prone flier on this
   * spell stays up.
   */
  it('hands over the hovering the sentence prints', () => {
    const after = castOn(SETUP, 'fly', 3);
    expect(fliesWithoutFallingOn(after, TARGET)).toBe(true);
    const prone = applyAll(after, must(applyConditionTo(after, TARGET, 'prone', 'dm')));
    expect(flightLost(prone, TARGET)).toEqual({ kind: 'hovers' });
  });

  it('takes the Fly Speed back when the Concentration breaks', () => {
    const after = castOn(SETUP, 'fly', 3);
    const ended = applyAll(after, must(endConcentration(after, CASTER, 'voluntary')));
    expect(speedOf(ended, TARGET, 'fly')).toBe(0);
    expect(hasSpeedInModeOn(ended, TARGET, 'fly')).toBe(false);
  });
});

describe('a spell grants a Climb Speed equal to the walking one', () => {
  /**
   * SRD Spider Climb: "The target also gains a Climb Speed equal to its
   * Speed."
   */
  it('matches the walking Speed rather than printing a number', () => {
    const after = castOn(SETUP, 'spider-climb', 2);
    expect(speedOf(after, TARGET, 'climb')).toBe(30);
    expect(hasSpeedInModeOn(after, TARGET, 'climb')).toBe(true);
    // Not a flight: one mode granted is one mode.
    expect(hasSpeedInModeOn(after, TARGET, 'fly')).toBe(false);
  });

  /**
   * **The matched Speed is the walking *base*, and this is the fixture that
   * says so.**
   *
   * {@link SpeedChange}'s `match-walk` argues the ruling and nothing asserted
   * it, so the reading it argues against — match the whole walking Speed and
   * then let everything that reaches a mode reach it again — passed every
   * test in the engine. Two halves, and they fail in opposite directions:
   *
   * | | matching the base | matching the whole |
   * |---|---|---|
   * | Slowed spider, walk 30 halved to 15 | climbs 15 | climbs 7 |
   * | Longstrider'd spider, walk 40 | climbs 30 | climbs 40 |
   *
   * The first is the SRD's: a halving is one halving, which is the rule
   * `combineSpeed` already fixes for every other input. The second is the
   * ruling directly above this family — an increase is the walking Speed's —
   * and a climb that took Longstrider's ten feet would be reading a sentence
   * the book does not print.
   */
  it('halves a Slowed spider once rather than twice', () => {
    const slowed: readonly GameEvent[] = [
      ...SETUP,
      {
        type: 'speed-modifier-granted',
        id: TARGET,
        modifier: { source: 'Slow#cast:99', change: 'halve' },
      },
    ];
    const after = castOn(slowed, 'spider-climb', 2);
    expect(speedOf(after, TARGET)).toBe(15);
    expect(speedOf(after, TARGET, 'climb')).toBe(15);
  });

  it('does not hand the climb a walking increase', () => {
    const faster: readonly GameEvent[] = [
      ...SETUP,
      {
        type: 'speed-modifier-granted',
        id: TARGET,
        modifier: { source: 'Longstrider#cast:99', change: 'add', feet: 10 },
      },
    ];
    const after = castOn(faster, 'spider-climb', 2);
    expect(speedOf(after, TARGET)).toBe(40);
    expect(speedOf(after, TARGET, 'climb')).toBe(30);
  });

  /**
   * SRD: "each foot of movement costs 1 extra foot ... unless the creature has
   * a Climb Speed". The surcharge is the reader this writer was built for.
   */
  it('stops the climbing surcharge, which is the reader it was built for', () => {
    const before = fold(SEED, SETUP);
    const dear = must(
      resolveMove(
        before,
        TARGET,
        { placement: { from: { landmark: 'the ford' }, feet: 10, bearing: 0 }, mode: 'climb' },
        supply('climb'),
      ),
    );

    const after = castOn(SETUP, 'spider-climb', 2);
    const cheap = must(
      resolveMove(
        after,
        TARGET,
        { placement: { from: { landmark: 'the ford' }, feet: 10, bearing: 0 }, mode: 'climb' },
        supply('climb'),
      ),
    );
    expect(dear.cost).toBe(cheap.cost * 2);
  });
});

describe('a feature grants a mode', () => {
  /**
   * SRD Second-Story Work: "You gain a Climb Speed equal to your Speed." A
   * `StandingGrant` and not a casting, so it is derived on every read — and
   * the mode and the match are spelled exactly as the spell's are.
   */
  const withClimb = (): readonly GameEvent[] => [
    {
      type: 'creature-added',
      id: TARGET,
      name: 'thief',
      sheet: sheet({
        standing: [
          {
            feature: 'a-feature',
            name: 'A Feature',
            reach: { kind: 'self' },
            grant: { kind: 'speed', change: 'match-walk', mode: 'climb' },
          },
        ],
      }),
      maxHp: 30,
      diesAtZero: false,
      creatureType: 'Humanoid',
    },
  ];

  it('reads the Climb Speed off the sheet, on every read', () => {
    const state = fold(SEED, withClimb());
    expect(speedOf(state, TARGET, 'climb')).toBe(30);
    expect(hasSpeedInModeOn(state, TARGET, 'climb')).toBe(true);
  });

  it('takes the Climb Speed away with everything else a pin takes', () => {
    const state = fold(SEED, withClimb());
    const held = applyAll(
      state,
      must(applyConditionTo(state, TARGET, 'grappled', 'dm')),
    );
    expect(speedOf(held, TARGET, 'climb')).toBe(0);
    // It is still a creature that *has* a Climb Speed; it has been stopped.
    expect(hasSpeedInModeOn(held, TARGET, 'climb')).toBe(true);
  });

  const featureCodes = (effect: unknown): readonly string[] =>
    checkFeatureDefinition(
      {
        id: 'rogue:a-climb',
        name: 'A Climb',
        level: 3,
        automation: 'engine',
        note: 'A Climb Speed equal to your Speed, executed through the grant.',
        grants: { kind: 'standing', effects: [effect] },
      } as never,
      {
        levels: 20,
        readableGrants: new Set(['standing']),
        readableFields: new Set(['grants']),
        spellExists: () => true,
      },
    ).map((problem) => problem.code);

  it('accepts the match, and refuses an operation that takes Speed away', () => {
    expect(featureCodes({ kind: 'speed', change: 'match-walk', mode: 'climb' })).toEqual([]);
    expect(featureCodes({ kind: 'speed', change: 'halve', mode: 'climb' })).toContain(
      'bad_speed_change',
    );
  });

  it('refuses a match with no mode to give, and feet beside one', () => {
    expect(featureCodes({ kind: 'speed', change: 'match-walk' })).toContain('bad_speed_change');
    expect(
      featureCodes({ kind: 'speed', change: 'match-walk', mode: 'climb', feet: 10 }),
    ).toContain('bad_speed_change');
  });
});

describe('the validator holds the pairing', () => {
  const codes = (effect: unknown): readonly string[] =>
    checkSpellDefinitionValue({
      id: 'mode',
      name: 'Mode',
      level: 1,
      school: 'transmutation',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'touch' },
      targets: { count: 1 },
      effects: [effect],
      durationSeconds: 600,
    }).map((problem) => problem.code);

  it('accepts a fixed Speed in a mode', () => {
    expect(codes({ kind: 'speed', change: 'add', feet: 60, mode: 'fly', hover: true })).toEqual([]);
  });

  it('refuses a mode nothing moves in', () => {
    expect(codes({ kind: 'speed', change: 'add', feet: 10, mode: 'slither' })).toContain(
      'bad_speed_change',
    );
  });

  it('refuses feet beside a match, which reads two numbers for one Speed', () => {
    expect(codes({ kind: 'speed', change: 'match-walk', mode: 'climb', feet: 10 })).toContain(
      'bad_speed_change',
    );
  });

  it('refuses a match on the walking Speed, which is itself', () => {
    expect(codes({ kind: 'speed', change: 'match-walk' })).toContain('bad_speed_change');
  });

  it('refuses hovering on anything but a flight', () => {
    expect(codes({ kind: 'speed', change: 'add', feet: 10, mode: 'climb', hover: true })).toContain(
      'bad_speed_change',
    );
  });

  it('refuses a mode on an operation that only takes Speed away', () => {
    expect(codes({ kind: 'speed', change: 'zero', mode: 'fly' })).toContain('bad_speed_change');
  });

  /**
   * **The two carriers that may not name a mode**, which is the other half of
   * the rule and the half the arithmetic leans on.
   *
   * A `speed-change` rider says "its Speed is reduced by 10 feet" and an
   * `areaStanding` says "Speed is halved in the Emanation": neither sentence
   * is about a mode, neither type holds the field, and `speedOf` reads an
   * area's change through a branch that names every member precisely because
   * one it did not name would be read as a Speed of 0.
   */
  const riderCodes = (rider: unknown): readonly string[] =>
    checkSpellDefinitionValue({
      id: 'mode-rider',
      name: 'Mode Rider',
      level: 0,
      school: 'evocation',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'ranged', feet: 60 },
      targets: { count: 1 },
      effects: [
        {
          kind: 'attack',
          attack: 'ranged',
          damage: { dice: '1d8' },
          damageType: 'cold',
          modifiers: [rider],
        },
      ],
    }).map((problem) => problem.code);

  const areaCodes = (standing: unknown): readonly string[] =>
    checkSpellDefinitionValue({
      id: 'mode-area',
      name: 'Mode Area',
      level: 1,
      school: 'evocation',
      castingTime: 'action',
      concentration: true,
      range: { kind: 'self' },
      area: { kind: 'emanation', size: 15, origin: 'self' },
      targets: { count: 0 },
      effects: [],
      durationSeconds: 60,
      areaStanding: standing,
      // A definition the engine resolves nothing of must say what the DM
      // adjudicates; this fixture is about the area's Speed and nothing else.
      unmodelled: ['everything but the halved Speed is outside this fixture'],
    }).map((problem) => problem.code);

  it('accepts the two changes each carrier really writes', () => {
    expect(
      riderCodes({ kind: 'speed-change', change: 'add', feet: -10, lasts: 'start-of-casters-next-turn' }),
    ).toEqual([]);
    expect(areaCodes({ kind: 'speed', change: 'halve' })).toEqual([]);
  });

  it('refuses a mode on a rider and on an area, which hold no such field', () => {
    expect(
      riderCodes({
        kind: 'speed-change',
        change: 'add',
        feet: -10,
        mode: 'fly',
        lasts: 'start-of-casters-next-turn',
      }),
    ).toContain('bad_speed_change');
    expect(areaCodes({ kind: 'speed', change: 'halve', mode: 'fly' })).toContain(
      'bad_speed_change',
    );
  });

  it('refuses a match on a rider and on an area, which have no mode to give', () => {
    expect(
      riderCodes({ kind: 'speed-change', change: 'match-walk', lasts: 'start-of-casters-next-turn' }),
    ).toContain('bad_speed_change');
    expect(areaCodes({ kind: 'speed', change: 'match-walk' })).toContain('bad_speed_change');
  });

  it('refuses hovering on a rider, which reads no such field either', () => {
    expect(
      riderCodes({
        kind: 'speed-change',
        change: 'add',
        feet: -10,
        hover: true,
        lasts: 'start-of-casters-next-turn',
      }),
    ).toContain('bad_speed_change');
  });
});

describe('a feat is held to the same pairing a feature is', () => {
  /**
   * A feat reaches `checkFeatureDefinition` through nothing: its whole door is
   * `featStandingProblems`, so the rule that refuses a halved mode on a class
   * feature had a hole exactly the width of one population until that door
   * called the same helper.
   */
  const featCodes = (effect: unknown): readonly string[] =>
    checkContent({
      feats: [
        {
          id: 'wall-runner',
          name: 'Wall Runner',
          grants: { kind: 'standing', reach: 'self', effects: [effect] },
        },
      ],
    } as never).map((problem) => problem.code);

  it('accepts a feat that gives a Climb Speed', () => {
    expect(featCodes({ kind: 'speed', change: 'match-walk', mode: 'climb' })).toEqual([]);
  });

  it('refuses a feat whose Speed nothing would gather', () => {
    expect(featCodes({ kind: 'speed', change: 'halve', mode: 'climb' })).toContain(
      'bad_speed_change',
    );
  });
});
