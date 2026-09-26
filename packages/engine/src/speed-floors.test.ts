import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { beginRest } from './rest.js';
import { hasSpeedInModeOn, speedOf, type AreaSpeedStanding, type HungGrant } from './standing.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import type { ModifierRider } from './spell-definitions.js';
import {
  applyConditionTo,
  attuneItem,
  awardItems,
  endConcentration,
  equipItem,
  resolveSpell,
  useItem,
} from './commands.js';

/**
 * A Speed given in a mode is a floor, not an addend.
 *
 * > SRD Fly: "the target **gains a Fly Speed of 60 feet** and can hover."
 * > SRD Winged Boots: "**gaining a Fly Speed of 30 feet** for 1 hour."
 * > SRD Longstrider: "The target's Speed **increases by 10 feet**."
 * > Glossary, Speed: "If you have more than one speed, choose which one to use
 * > when you move."
 *
 * "A Fly Speed of 60" states what the Fly Speed is. Two such sentences are two
 * Fly Speeds and the creature moves at the higher; "increases by" is the only
 * sentence that adds. Before this file both mode-named grants were written as
 * `add`, so Fly beside Winged Boots flew at 90, an Owl under Fly at 120, and a
 * Potion of Flying's matched walk beside Fly at 90.
 *
 * Driven through the doors a table holds: Fly is cast, the boots are awarded,
 * worn, attuned and used, and the potion is drunk.
 */

const id = (s: string) => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');
const SEED = 'floors';

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

const setup = (target: Partial<CharacterSheet> = {}): readonly GameEvent[] => [
  added(CASTER),
  added(TARGET, target),
  ...[1, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: CASTER,
      pool: { key: spellSlotKey(level), label: `level ${level} spell slot`, max: 4, recovers: 'long-rest' },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({ ability: 'int', cantrips: [], prepared: ['fly', 'longstrider'] }),
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

const supply = (state: GameState, seed: string) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<Emitted>,
  label: string,
): readonly GameEvent[] => [...log, ...eventsOf(unwrap(command(fold(SEED, log)), label))];

const cast = (log: readonly GameEvent[], spellId: string, slotLevel: number) =>
  run(
    log,
    (s) =>
      resolveSpell(
        s,
        CASTER,
        // Fly asks for "a willing creature"; Longstrider asks nobody's consent.
        { spellId, targets: [TARGET], ...(spellId === 'fly' ? { willing: [TARGET] } : {}), slotLevel },
        supply(s, spellId),
      ),
    spellId,
  );

/** Awarded, worn, rested over and attuned, then used: the whole path the bracket asks for. */
const bootsOn = (log: readonly GameEvent[]) => {
  const BOOTS = 'winged-boots';
  const awarded = run(log, (s) => awardItems(s, supply(s, 'hoard'), TARGET, [{ id: BOOTS }], 'the hoard'), 'award');
  const worn = run(awarded, (s) => equipItem(s, SRD_CONTENT, TARGET, BOOTS), 'equip');
  const rested = run(worn, (s) => beginRest(s, TARGET, 'short'), 'rest');
  const attuned = run(rested, (s) => attuneItem(s, SRD_CONTENT, TARGET, BOOTS), 'attune');
  return run(attuned, (s) => useItem(s, TARGET, { item: BOOTS }, supply(s, 'boots')), 'use boots');
};

const potionDrunk = (log: readonly GameEvent[]) => {
  const POTION = 'potion-of-flying';
  const awarded = run(log, (s) => awardItems(s, supply(s, 'hoard'), TARGET, [{ id: POTION }], 'the hoard'), 'award');
  return run(awarded, (s) => useItem(s, TARGET, { item: POTION }, supply(s, 'potion')), 'drink');
};

const fly = (log: readonly GameEvent[]) => speedOf(fold(SEED, log), TARGET, 'fly');

describe('two Fly Speeds are two Fly Speeds, and the higher one is flown', () => {
  it('flies at 60 under Fly with Winged Boots running, not at 90', () => {
    expect(fly(cast(bootsOn(setup()), 'fly', 3))).toBe(60);
  });

  it('flies at 60 whichever came first', () => {
    expect(fly(bootsOn(cast(setup(), 'fly', 3)))).toBe(60);
  });

  it('flies an Owl at its own 60 under Fly, not at 120', () => {
    const owl = setup({ speeds: { fly: 60 } });
    expect(fly(owl)).toBe(60);
    expect(fly(cast(owl, 'fly', 3))).toBe(60);
  });

  it('flies at a printed Speed that is higher than the grant', () => {
    const hawk = setup({ speeds: { fly: 80 } });
    expect(fly(cast(hawk, 'fly', 3))).toBe(80);
  });

  it('flies at 60 under Fly with a Potion of Flying matching a walk of 30, not at 90', () => {
    expect(fly(cast(potionDrunk(setup()), 'fly', 3))).toBe(60);
  });

  it('flies at 30 on the boots alone, and has a Fly Speed to say so', () => {
    const state = fold(SEED, bootsOn(setup()));
    expect(speedOf(state, TARGET, 'fly')).toBe(30);
    expect(hasSpeedInModeOn(state, TARGET, 'fly')).toBe(true);
    expect(speedOf(state, TARGET)).toBe(30);
  });

  it('falls back to the boots when Fly’s Concentration breaks', () => {
    const both = cast(bootsOn(setup()), 'fly', 3);
    const ended = run(both, (s) => endConcentration(s, CASTER, 'voluntary'), 'end');
    expect(fly(ended)).toBe(30);
  });

  it('has a Fly Speed it cannot use while Grappled', () => {
    const flying = bootsOn(setup());
    const held = run(flying, (s) => applyConditionTo(s, TARGET, 'grappled', 'dm'), 'grapple');
    const state = fold(SEED, held);
    expect(speedOf(state, TARGET, 'fly')).toBe(0);
    expect(hasSpeedInModeOn(state, TARGET, 'fly')).toBe(true);
  });
});

describe('what reaches a floor still reaches it', () => {
  it('halves a Slowed target’s 60-foot flight to 30', () => {
    const slowed: readonly GameEvent[] = [
      ...setup(),
      {
        type: 'speed-modifier-granted',
        id: TARGET,
        modifier: { source: 'Slow#cast:99', change: 'halve' },
      },
    ];
    expect(fly(cast(slowed, 'fly', 3))).toBe(30);
  });

  it('lets Longstrider reach the walk and not the flight, per today’s ruling', () => {
    const state = fold(SEED, cast(cast(setup(), 'fly', 3), 'longstrider', 1));
    expect(speedOf(state, TARGET)).toBe(40);
    expect(speedOf(state, TARGET, 'fly')).toBe(60);
  });
});

describe('a log written before the floor reads as it was written', () => {
  /**
   * Every Fly cast before this left a stored `add` with a mode. The pin says
   * what was written, so it folds and reads as it did.
   */
  it('reads a pinned mode-named addition as the 60 feet it added', () => {
    const old: readonly GameEvent[] = [
      ...setup(),
      {
        type: 'speed-modifier-granted',
        id: TARGET,
        modifier: { source: 'Fly#cast:1', change: 'add', feet: 60, mode: 'fly', hover: true },
      },
    ];
    expect(fly(old)).toBe(60);
  });
});

describe('the validator holds the floor to what it means', () => {
  const problems = (effect: unknown) =>
    checkSpellDefinitionValue({
      id: 'floor',
      name: 'Floor',
      level: 1,
      school: 'transmutation',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'touch' },
      targets: { count: 1 },
      effects: [effect],
      durationSeconds: 600,
    });
  const codes = (effect: unknown) => problems(effect).map((problem) => problem.code);
  const fields = (effect: unknown) => problems(effect).map((problem) => problem.field);

  it('accepts a Speed of N in a mode, with the hovering beside a flight', () => {
    expect(codes({ kind: 'speed', change: 'at-least', feet: 60, mode: 'fly', hover: true })).toEqual([]);
    expect(codes({ kind: 'speed', change: 'at-least', feet: 40, mode: 'swim' })).toEqual([]);
  });

  it('refuses a floor with no feet, or with feet that are not a distance', () => {
    for (const feet of [undefined, 0, -10, 12.5]) {
      expect(fields({ kind: 'speed', change: 'at-least', feet, mode: 'fly' })).toContain(
        'effects[0].feet',
      );
    }
  });

  it('refuses a floor that names no mode, or the walking one', () => {
    expect(fields({ kind: 'speed', change: 'at-least', feet: 30 })).toContain('effects[0].mode');
    expect(fields({ kind: 'speed', change: 'at-least', feet: 30, mode: 'walk' })).toContain(
      'effects[0].mode',
    );
  });

  it('refuses hovering beside anything but a flight', () => {
    expect(fields({ kind: 'speed', change: 'at-least', feet: 30, mode: 'climb', hover: true })).toContain(
      'effects[0].hover',
    );
  });

  const riderReasons = (rider: unknown): readonly string[] =>
    checkSpellDefinitionValue({
      id: 'floor-rider',
      name: 'Floor Rider',
      level: 0,
      school: 'evocation',
      castingTime: 'action',
      concentration: false,
      range: { kind: 'ranged', feet: 60 },
      targets: { count: 1 },
      effects: [
        { kind: 'attack', attack: 'ranged', damage: { dice: '1d8' }, damageType: 'cold', modifiers: [rider] },
      ],
    }).map((problem) => problem.reason);

  const areaReasons = (standing: unknown): readonly string[] =>
    checkSpellDefinitionValue({
      id: 'floor-area',
      name: 'Floor Area',
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
      unmodelled: ['everything but the Speed is outside this fixture'],
    }).map((problem) => problem.reason);

  it('refuses a floor on a rider and on an area, which have no mode to give it in', () => {
    expect(
      riderReasons({
        kind: 'speed-change',
        change: 'at-least',
        feet: 30,
        lasts: 'start-of-casters-next-turn',
      }).join(' '),
    ).toContain('no mode to give it in');
    expect(areaReasons([{ kind: 'speed', change: 'at-least', feet: 30 }]).join(' ')).toContain(
      'no mode to give it in',
    );
  });

  /**
   * The three carriers that hold no mode refuse the member in their types. A
   * hung grant has no runtime check of its `change` at all — `feature-schema`
   * reads a hung `roll-mode` alone — so the type is the whole of its door, as
   * it already is for `match-walk` and `only`.
   */
  it('refuses a floor in the types of the three carriers that hold no mode', () => {
    const hung: HungGrant = {
      kind: 'speed',
      // @ts-expect-error a hung grant has no mode to give a Speed in.
      change: 'at-least',
      feet: 30,
      lasts: 'end-of-current-turn',
    };
    const area: AreaSpeedStanding = {
      kind: 'speed',
      // @ts-expect-error nor does an area.
      change: 'at-least',
      feet: 30,
    };
    const rider: Extract<ModifierRider, { kind: 'speed-change' }> = {
      kind: 'speed-change',
      // @ts-expect-error nor does a rider.
      change: 'at-least',
      feet: 30,
    };
    expect([hung, area, rider]).toHaveLength(3);
  });
});
