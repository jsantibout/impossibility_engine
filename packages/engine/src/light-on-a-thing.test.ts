import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { lightAt, obscurementAt, type Point } from './positioning.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { canSee, rollModesFor } from './standing.js';
import {
  activateSpell,
  carrying,
  declareObject,
  dropConjured,
  equipItem,
  evokeConjured,
  moveCastLight,
  resolveSpell,
  resolveTurn,
} from './commands.js';

/**
 * A light on a thing: the object it hangs on, the bowl put over it, and a glow
 * that runs out before its casting does (W9-S1).
 *
 * `docs/design/light-and-sight.md` ruled that light on a carried torch is a
 * patch carried by the creature and light on a thrown rock is a point the table
 * re-declares. The re-declaration went through `declare_light`, which lays a
 * *table* patch — no `source`, so it outlived a dispel, and no `magical`, so
 * Darkness's own rules stopped applying. `moveCastLight` re-lays the casting's
 * own patches under their own names, keeping everything that makes them the
 * casting's, and adds the one word the book prints about every object-borne
 * light: covered.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const ALLY = id('ally');
const GOBLIN = id('goblin');
const ROGUE = id('rogue');
const DWARF = id('dwarf');
const ORC = id('orc');
const KOBOLD = id('kobold');
const SNEAK = id('sneak');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}, side = 'party'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const at = (x: number, y: number): Point => ({ x, y, z: 0 });

const placed = (who: CharacterId, where: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: where }, feet: 0 },
});

/** Somebody already in the scene, somewhere else. */
const moved = (who: CharacterId, where: Point): GameEvent => ({
  type: 'creature-moved',
  id: who,
  placement: { from: { point: where }, feet: 0 },
});

/** Darkvision 60, as a species trait grants it. */
const DARKVISION_60 = {
  feature: 'a-species:darkvision',
  name: 'Darkvision',
  reach: { kind: 'self' },
  grant: { kind: 'sense', sense: 'darkvision', feet: 60 },
} as const;

/** SRD Sunlight Sensitivity, as `light-and-sight.test.ts` writes it. */
const SENSITIVE = {
  feature: 'a-monster:sunlight-sensitivity',
  name: 'Sunlight Sensitivity',
  reach: { kind: 'self' },
  grant: {
    kind: 'roll-mode',
    modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'roller' } },
  },
  requires: [{ kind: 'in-sunlight' }],
} as const;

const PREPARED = [
  'produce-flame',
  'flame-blade',
  'moonbeam',
  'light',
  'continual-flame',
  'darkness',
  'daylight',
  'faerie-fire',
];

const caster = (who: CharacterId): readonly GameEvent[] => [
  added(who),
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', prepared: PREPARED }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 6, recovers: 'long-rest' },
    }),
  ),
];

const supply = (state: GameState, seed = 'glow') => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

type Emitted = readonly GameEvent[] | { readonly events: readonly GameEvent[] };
const eventsOf = (value: Emitted): readonly GameEvent[] =>
  Array.isArray(value) ? value : (value as { readonly events: readonly GameEvent[] }).events;

/** A log that grows, and the state it folds to. */
class Room {
  readonly log: GameEvent[];

  constructor(start: readonly GameEvent[]) {
    this.log = [...start];
  }

  get state(): GameState {
    return fold('room', this.log);
  }

  push(...more: readonly GameEvent[]): this {
    this.log.push(...more);
    return this;
  }

  run(label: string, command: (state: GameState) => Result<Emitted>): this {
    return this.push(...eventsOf(unwrap(command(this.state), label)));
  }

  cast(spellId: string, request: Record<string, unknown>, by: CharacterId = DRUID): string {
    const out = unwrap(
      resolveSpell(this.state, by, { spellId, targets: [], ...request } as never, supply(this.state)),
      spellId,
    );
    this.push(...out.events);
    return out.castingId!;
  }

  move(castingId: string, command: Parameters<typeof moveCastLight>[3]): this {
    return this.run('move', (state) => moveCastLight(state, SRD_CONTENT, castingId, command));
  }

  object(who: CharacterId, where: Point, size: 'tiny' | 'small' = 'tiny'): this {
    this.run(`declare ${who}`, (state) =>
      declareObject(state, SRD_CONTENT, who, {
        name: String(who),
        material: 'stone',
        size,
        build: 'resilient',
      }),
    );
    return this.push(placed(who, where));
  }

  light(where: Point) {
    return lightAt(this.state, where);
  }
}

const room = (...more: readonly GameEvent[]): Room =>
  new Room([
    ...caster(DRUID),
    added(ALLY),
    added(GOBLIN, {}, 'goblins'),
    { type: 'scene-set', extent: { width: 600, depth: 400, height: 40 } },
    placed(DRUID, at(100, 100)),
    placed(ALLY, at(105, 100)),
    placed(GOBLIN, at(300, 300)),
    ...more,
  ]);

// ─── Part A: the two definitions, and Moonbeam's Dim Light ────────────────

describe('SRD Produce Flame sheds the light it prints', () => {
  it('lays Bright Light in 20 feet and Dim Light 20 feet beyond, on the caster', () => {
    const r = room();
    r.cast('produce-flame', { targets: [DRUID] });

    expect(r.light(at(100, 100))).toMatchObject({ level: 'bright', magical: true });
    expect(r.light(at(120, 100)).level).toBe('bright');
    expect(r.light(at(140, 100)).level).toBe('dim');
    expect(r.light(at(145, 100)).level).toBeNull();
  });

  it('walks with the caster', () => {
    const r = room();
    r.cast('produce-flame', { targets: [DRUID] });
    r.push(moved(DRUID, at(300, 100)));

    expect(r.light(at(100, 100)).level).toBeNull();
    expect(r.light(at(300, 100)).level).toBe('bright');
  });

  it('is replaced by the recast: "The spell ends if you cast it again"', () => {
    const r = room();
    const first = r.cast('produce-flame', { targets: [DRUID] });
    const second = r.cast('produce-flame', { targets: [DRUID] });

    expect(r.state.ongoing[first]).toBeUndefined();
    const names = r.light(at(100, 100)).patches;
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.includes(second))).toBe(true);
  });

  it('puts the flame in the hand it appears in', () => {
    const r = room();
    const flame = r.cast('produce-flame', { targets: [DRUID] });

    const line = r.state.creatures[DRUID]!.inventory.find((held) => held.id === 'produce-flame');
    expect(line?.casting).toBe(flame);
  });

  /** "While there, the flame … sheds Bright Light": gone from the hand, dark. */
  it('sheds nothing once the flame is no longer in the hand', () => {
    const r = room();
    r.cast('produce-flame', { targets: [DRUID] });
    r.run('let go', (state) => dropConjured(state, SRD_CONTENT, DRUID, 'produce-flame'));

    expect(r.light(at(100, 100)).level).toBeNull();
  });

  /**
   * A Self spell's effect lands on the creature the casting names. A
   * `casterOnly` spell can name one creature and it is the caster, so a
   * casting that names nobody is cast on its caster (W9-T) — the flame in
   * the caster's hand and its light on them — and anybody else is refused.
   */
  it('names its caster when nobody is named, and refuses anybody else', () => {
    const r = room();
    const flame = r.cast('produce-flame', { targets: [] });
    expect(carrying(r.state, DRUID).find((held) => held.id === 'produce-flame')?.casting).toBe(
      flame,
    );
    expect(r.light(at(100, 100))).toMatchObject({ level: 'bright', magical: true });

    const ally = resolveSpell(
      r.state,
      DRUID,
      { spellId: 'produce-flame', targets: [ALLY] },
      supply(r.state),
    );
    expect(isErr(ally) && ally.code).toBe('not_the_caster');
  });
});

describe('SRD Flame Blade sheds light while the blade is held', () => {
  const evoked = () => {
    const r = room();
    const blade = r.cast('flame-blade', { targets: [DRUID], slotLevel: 2 });
    return { r, blade };
  };

  it('lights Bright 10 and Dim 10 beyond while the blade is in hand', () => {
    const { r } = evoked();

    expect(r.light(at(110, 100))).toMatchObject({ level: 'bright', magical: true });
    expect(r.light(at(120, 100)).level).toBe('dim');
    expect(r.light(at(125, 100)).level).toBeNull();
  });

  it('goes dark when the blade is let go of, and lights again when it is evoked', () => {
    const { r } = evoked();

    r.run('let go', (state) => dropConjured(state, SRD_CONTENT, DRUID, 'flame-blade'));
    expect(r.light(at(100, 100)).level).toBeNull();

    r.run('evoke', (state) => evokeConjured(state, DRUID, { item: 'flame-blade' }, supply(state)));
    expect(r.light(at(100, 100)).level).toBe('bright');
  });

  it('goes out when the Concentration breaks', () => {
    const { r, blade } = evoked();
    r.push({ type: 'concentration-ended', id: DRUID, castingId: blade, reason: 'voluntary' });

    expect(r.light(at(100, 100)).level).toBeNull();
  });
});

describe('SRD Moonbeam: "Dim Light fills the Cylinder"', () => {
  it('lays Dim Light in the Cylinder, and again where the Magic action moves it', () => {
    const r = room();
    const beam = r.cast('moonbeam', { at: at(200, 100), slotLevel: 2 });

    expect(r.light(at(200, 100))).toMatchObject({ level: 'dim', magical: true });
    expect(r.light(at(215, 100)).level).toBeNull();

    r.run('move the beam', (state) =>
      activateSpell(
        state,
        DRUID,
        {
          castingId: beam,
          targets: [],
          to: at(240, 100),
          via: [205, 210, 215, 220, 225, 230, 235, 240].map((x) => at(x, 100)),
        },
        supply(state),
      ),
    );
    expect(r.light(at(200, 100)).level).toBeNull();
    expect(r.light(at(240, 100)).level).toBe('dim');
  });
});

// ─── Part B: a glow with its own deadline ───────────────────────────────────

describe('SRD Starry Wisp: "until the end of your next turn, it emits Dim Light"', () => {
  const fight = (armorClass: number): Room =>
    new Room([
      ...caster(DRUID),
      added(SNEAK, { stated: { armorClass, proficiencyBonus: 2, initiative: 0 } }, 'goblins'),
      added(ROGUE, { skills: { stealth: 'proficient' } }),
      {
        type: 'spellcasting-declared',
        id: DRUID,
        spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', cantrips: ['starry-wisp'], prepared: [] }),
      },
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 }, light: 'darkness' },
      placed(DRUID, at(100, 100)),
      placed(SNEAK, at(100, 130)),
      placed(ROGUE, at(105, 130)),
      { type: 'sight-declared', from: DRUID, to: SNEAK, seen: true },
      {
        type: 'combat-started',
        combatants: [
          { id: DRUID, initiative: 20, speed: 30 },
          { id: SNEAK, initiative: 10, speed: 30 },
        ],
      },
    ] as GameEvent[]);

  const wisp = (r: Room) =>
    unwrap(
      resolveSpell(r.state, DRUID, { spellId: 'starry-wisp', targets: [SNEAK] }, supply(r.state, 'wisp')),
      'wisp',
    );

  it('glows Dim in 10 feet around the creature it hit', () => {
    const r = fight(1);
    const out = wisp(r);
    expect(out.outcomes[0]?.attack?.hit).toBe(true);
    r.push(...out.events);

    expect(r.light(at(100, 130))).toMatchObject({ level: 'dim', magical: true });
    expect(r.light(at(100, 140)).level).toBe('dim');
  });

  it('takes the darkness a Rogue beside it would Hide in', () => {
    const r = fight(1);
    expect(obscurementAt(r.state, at(105, 130)).degree).toBe('heavily');
    r.push(...wisp(r).events);

    expect(obscurementAt(r.state, at(105, 130)).degree).toBe('lightly');
  });

  it('goes out at the end of the caster’s next turn', () => {
    const r = fight(1);
    r.push(...wisp(r).events);

    r.run('the druid’s turn ends', (state) => resolveTurn(state, supply(state, 'turn')));
    expect(r.light(at(100, 130)).level).toBe('dim');
    r.run('the sneak’s turn ends', (state) => resolveTurn(state, supply(state, 'turn')));
    expect(r.light(at(100, 130)).level).toBe('dim');
    r.run('the druid’s next turn ends', (state) => resolveTurn(state, supply(state, 'turn')));

    expect(r.light(at(100, 130)).level).toBe('darkness');
    expect(r.light(at(100, 130)).magical).toBe(false);
  });

  it('sheds nothing on a miss', () => {
    const r = fight(40);
    const out = wisp(r);
    expect(out.outcomes[0]?.attack?.hit).toBe(false);
    r.push(...out.events);

    expect(r.light(at(100, 130)).level).toBe('darkness');
    expect(out.events.some((event) => event.type === 'light-declared')).toBe(false);
  });
});

describe('what a definition may say about a glow’s deadline', () => {
  const definition = (light: unknown): unknown => ({
    id: 'homebrew-mote',
    name: 'Homebrew Mote',
    level: 0,
    school: 'evocation',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1 },
    effects: [
      { kind: 'attack', attack: 'ranged', damage: { dice: '1d8' }, damageType: 'radiant', light },
    ],
  });

  const codes = (light: unknown): readonly string[] =>
    checkSpellDefinitionValue(definition(light)).map((one) => one.code);

  it('refuses a glow on an Instantaneous casting with no deadline of its own', () => {
    expect(codes({ level: 'dim', radius: 10 })).toContain('grant_without_lifetime');
  });

  it('accepts one that says when it goes out', () => {
    expect(codes({ level: 'dim', radius: 10, lasts: 'end-of-casters-next-turn' })).toEqual([]);
  });

  it('refuses a deadline that is not one', () => {
    expect(codes({ level: 'dim', radius: 10, lasts: 'whenever' })).toContain('malformed_field');
  });
});

// ─── Part C: the thing a cast light hangs on ────────────────────────────────

describe('SRD Light on a thing', () => {
  const SCONCE = id('the sconce');

  it('sits on a declared sconce when the casting names it', () => {
    const r = room().object(SCONCE, at(100, 105));
    r.cast('light', { targets: [SCONCE] });
    r.push(moved(DRUID, at(300, 100)));

    expect(r.light(at(100, 105)).level).toBe('bright');
    expect(r.light(at(100, 125)).level).toBe('bright');
    expect(r.light(at(300, 100)).level).toBeNull();
  });

  it('stays where it was set down when the caster walks away', () => {
    const r = room();
    const light = r.cast('light', { targets: [DRUID] });
    r.move(light, { to: { space: at(100, 100) } });
    r.push(moved(DRUID, at(300, 100)));

    expect(r.light(at(100, 100))).toMatchObject({ level: 'bright', magical: true });
    expect(r.light(at(300, 100)).level).toBeNull();
  });

  it('walks with the ally it is handed to', () => {
    const r = room();
    const light = r.cast('light', { targets: [DRUID] });
    r.move(light, { to: { creature: ALLY } });
    r.push(moved(ALLY, at(400, 100)));

    expect(r.light(at(400, 100)).level).toBe('bright');
    expect(r.light(at(100, 100)).level).toBeNull();
  });

  it('lights nothing while it is covered, and lights again when it is not', () => {
    const r = room();
    const light = r.cast('light', { targets: [DRUID] });

    r.move(light, { covered: true });
    expect(r.light(at(100, 100)).level).toBeNull();
    expect(r.light(at(100, 100)).patches).toEqual([]);
    // Covering is not ending: the casting runs on underneath.
    expect(r.state.ongoing[light]).toBeDefined();

    r.move(light, { covered: false });
    expect(r.light(at(100, 100)).level).toBe('bright');
  });

  it('keeps the casting’s own patch, so the casting’s end takes it wherever it went', () => {
    const r = room();
    const flame = r.cast('continual-flame', { targets: [DRUID], slotLevel: 2 });
    r.move(flame, { to: { creature: ALLY } });
    expect(r.light(at(105, 100)).level).toBe('bright');

    r.push({ type: 'spell-ended', castingId: flame, on: null, reason: 'dispelled' });
    expect(r.light(at(105, 100)).level).toBeNull();
  });

  it('re-lays the patch under its own name, keeping what makes it the casting’s', () => {
    const r = room();
    const light = r.cast('light', { targets: [DRUID] });
    const before = Object.keys(r.state.scene!.light).sort();
    r.move(light, { to: { creature: ALLY } });

    expect(Object.keys(r.state.scene!.light).sort()).toEqual(before);
    for (const name of before) {
      expect(r.state.scene!.light[name]).toMatchObject({
        source: light,
        magical: { spellLevel: 0 },
        region: { origin: { creature: ALLY } },
      });
    }
  });
});

describe('SRD Darkness cast on an object', () => {
  const STONE = id('the stone');

  /** The stone forty feet from the druid, and the orc on the next space. */
  const dark = () => {
    const r = room(
      added(DWARF, { standing: [DARKVISION_60] }),
      added(ORC, {}, 'goblins'),
      placed(DWARF, at(100, 150)),
      placed(ORC, at(145, 150)),
    ).object(STONE, at(140, 150));
    const darkness = r.cast('darkness', { at: at(140, 150), slotLevel: 2 });
    return { r, darkness };
  };

  it('fills a 15-foot Emanation from the stone once it is laid on it', () => {
    const { r, darkness } = dark();
    // The Sphere first: fifteen feet from the middle of the stone's space.
    expect(r.light(at(155, 150)).level).toBe('darkness');
    expect(r.light(at(160, 150)).level).toBeNull();

    r.move(darkness, { to: { creature: STONE } });

    for (const name of Object.keys(r.state.scene!.light)) {
      expect(r.state.scene!.light[name]?.region).toEqual({
        origin: { creature: STONE },
        shape: { kind: 'emanation', distance: 15 },
      });
    }
    // The Emanation, measured from the stone's own space: for a thing that
    // fills one space that is the same fifteen feet the Sphere reached.
    expect(r.light(at(140, 150))).toMatchObject({ level: 'darkness', magical: true });
    expect(r.light(at(155, 150)).level).toBe('darkness');
    expect(r.light(at(160, 150)).level).toBeNull();
  });

  it('lets a Dwarf see through it again when a bowl is put over the stone', () => {
    const { r, darkness } = dark();
    r.move(darkness, { to: { creature: STONE } });
    expect(canSee(r.state, DWARF, ORC)).toBe(false);

    r.move(darkness, { covered: true });
    expect(canSee(r.state, DWARF, ORC)).not.toBe(false);
  });

  it('follows the goblin who picks the stone up', () => {
    const { r, darkness } = dark();
    r.move(darkness, { to: { creature: STONE } });
    r.move(darkness, { to: { creature: GOBLIN } });

    expect(r.light(at(300, 300)).level).toBe('darkness');
    expect(r.light(at(140, 150)).level).toBeNull();
    r.push(moved(GOBLIN, at(400, 300)));
    expect(r.light(at(400, 300)).level).toBe('darkness');
  });

  it('refuses to lay a point-cast Darkness on a creature that is not an object', () => {
    const { r, darkness } = dark();
    const moved = moveCastLight(r.state, SRD_CONTENT, darkness, { to: { creature: ORC } });

    expect(isErr(moved) && moved.code).toBe('not_an_object');
  });

  it('refuses to lay it on an object that is not where it was cast', () => {
    const { r, darkness } = dark();
    r.object(id('another stone'), at(150, 160));
    const moved = moveCastLight(r.state, SRD_CONTENT, darkness, {
      to: { creature: id('another stone') },
    });

    expect(isErr(moved) && moved.code).toBe('not_where_it_was_cast');
  });

  it('refuses to move or cover a Darkness that is on no object', () => {
    const { r, darkness } = dark();
    const set = moveCastLight(r.state, SRD_CONTENT, darkness, { to: { space: at(150, 160) } });
    const covered = moveCastLight(r.state, SRD_CONTENT, darkness, { covered: true });

    expect(isErr(set) && set.code).toBe('not_an_object');
    expect(isErr(covered) && covered.code).toBe('not_an_object');
  });

  it('takes the moved patch away when the Concentration breaks', () => {
    const { r, darkness } = dark();
    r.move(darkness, { to: { creature: STONE } });
    r.push({ type: 'concentration-ended', id: DRUID, castingId: darkness, reason: 'voluntary' });

    expect(r.light(at(140, 150)).level).toBeNull();
  });
});

describe('the mutual dispel, on a light that moves or is covered', () => {
  const STONE = id('the stone');
  const LAMP = id('the lamp');
  const BYSTANDER = id('bystander');

  const scene = () => {
    const r = room(...caster(BYSTANDER), placed(BYSTANDER, at(500, 100))).object(STONE, at(130, 100));
    r.object(LAMP, at(500, 105));
    const darkness = r.cast('darkness', { at: at(130, 100), slotLevel: 2 });
    return { r, darkness };
  };

  it('puts a Darkness out when a Daylight is carried over it', () => {
    const { r, darkness } = scene();
    const daylight = r.cast('daylight', { at: at(500, 105), slotLevel: 3 }, BYSTANDER);
    expect(r.state.ongoing[darkness]).toBeDefined();

    r.move(daylight, { to: { creature: LAMP } });
    expect(r.state.ongoing[darkness]).toBeDefined();
    r.move(daylight, { to: { creature: ALLY } });

    expect(r.state.ongoing[darkness]).toBeUndefined();
    expect(r.state.ongoing[daylight]).toBeDefined();
  });

  it('neither dispels nor is dispelled while covered, and re-pins when uncovered', () => {
    const { r, darkness } = scene();
    r.move(darkness, { to: { creature: STONE } });
    r.move(darkness, { covered: true });

    // A Light on the druid, thirty feet from the stone, for the uncovering
    // below to find. (Its own laying could not have dispelled the Darkness
    // either way: an incoming Light is level 0 and a Darkness level 2.)
    const light = r.cast('light', { targets: [DRUID] });
    // And a Daylight laid over the covered stone finds no Darkness to put out.
    const daylight = r.cast('daylight', { at: at(140, 100), slotLevel: 3 });
    expect(r.state.ongoing[darkness]).toBeDefined();
    r.push({ type: 'spell-ended', castingId: daylight, on: null, reason: 'dismissed' });

    // Uncovered: the Darkness is pinned again, and the Light (level 0) goes.
    r.move(darkness, { covered: false });
    expect(r.state.ongoing[light]).toBeUndefined();
    expect(r.light(at(130, 100)).level).toBe('darkness');
  });
});

describe('a conjured light and the mutual dispel', () => {
  /**
   * SRD Darkness puts out "an area of Bright Light or Dim Light created by a
   * spell of level 2 or lower" — Flame Blade is level 2 — and a blade that has
   * been let go of sheds no light, so there is no area of it to overlap.
   */
  it('puts out a Flame Blade in hand, and not one that has been let go of', () => {
    // The ally is in the room already; this gives them the Darkness to cast.
    const held = room(...caster(ALLY).slice(1));
    const blade = held.cast('flame-blade', { targets: [DRUID], slotLevel: 2 });
    held.cast('darkness', { at: at(110, 100), slotLevel: 2 }, ALLY);
    expect(held.state.ongoing[blade]).toBeUndefined();

    const dropped = room(...caster(ALLY).slice(1));
    const second = dropped.cast('flame-blade', { targets: [DRUID], slotLevel: 2 });
    dropped.run('let go', (state) => dropConjured(state, SRD_CONTENT, DRUID, 'flame-blade'));
    dropped.cast('darkness', { at: at(110, 100), slotLevel: 2 }, ALLY);
    expect(dropped.state.ongoing[second]).toBeDefined();
  });
});

describe('the recast’s free hand (W9-T)', () => {
  /** A druid with a Shield strapped to one arm and the other hand free. */
  const shielded = () =>
    room({
      type: 'items-gained',
      id: DRUID,
      items: [{ id: 'shield', quantity: 1 }],
      source: 'the pack',
    }).run('the shield', (state) => equipItem(state, SRD_CONTENT, DRUID, 'shield'));

  /** Every patch lit at the druid's feet, by name. */
  const patchesHere = (r: Room) => r.light(at(100, 100)).patches;

  /**
   * SRD Produce Flame: "The spell ends if you cast it again." The recast ends
   * the old casting, and with it the flame in the hand — so the hand the new
   * flame appears in is the one the old flame leaves, and a Shield in the
   * other is no reason to refuse.
   */
  it('recasts Produce Flame with a Shield in the other hand, and the old flame’s light goes', () => {
    const r = shielded();
    const first = r.cast('produce-flame', { targets: [DRUID] });
    const second = r.cast('produce-flame', { targets: [DRUID] });

    expect(r.state.ongoing[first]).toBeUndefined();
    expect(r.state.ongoing[second]).toBeDefined();
    const flames = carrying(r.state, DRUID).filter((held) => held.id === 'produce-flame');
    expect(flames.map((held) => held.casting)).toEqual([second]);
    expect(patchesHere(r).length).toBeGreaterThan(0);
    expect(patchesHere(r).some((name) => name.includes(first))).toBe(false);
    expect(patchesHere(r).every((name) => name.includes(second))).toBe(true);
  });

  /**
   * SRD Flame Blade has no "if you cast it again"; it is Concentration, and
   * SRD: "You lose Concentration on an effect the moment you start casting a
   * spell that requires Concentration." The second blade's casting ends the
   * first, and the first blade leaves the hand the second is evoked in.
   */
  it('recasts Flame Blade with a Shield in the other hand, and the old blade’s light goes', () => {
    const r = shielded();
    const first = r.cast('flame-blade', { targets: [DRUID], slotLevel: 2 });
    const second = r.cast('flame-blade', { targets: [DRUID], slotLevel: 2 });

    expect(r.state.ongoing[first]).toBeUndefined();
    expect(r.state.creatures[DRUID]!.concentration?.castingId).toBe(second);
    const blades = carrying(r.state, DRUID).filter((held) => held.id === 'flame-blade');
    expect(blades.map((held) => held.casting)).toEqual([second]);
    expect(patchesHere(r).length).toBeGreaterThan(0);
    expect(patchesHere(r).some((name) => name.includes(first))).toBe(false);
    expect(patchesHere(r).every((name) => name.includes(second))).toBe(true);
  });

  /**
   * A different spell ends nothing: Produce Flame is not Concentration and
   * does not replace a Flame Blade, so a Shield and a blade leave no hand
   * for the flame. And a Flame Blade over a Produce Flame ends nothing
   * either — Produce Flame holds no Concentration to lose.
   */
  it('still refuses a different conjured spell with both hands full', () => {
    const blade = shielded();
    blade.cast('flame-blade', { targets: [DRUID], slotLevel: 2 });
    const flame = resolveSpell(
      blade.state,
      DRUID,
      { spellId: 'produce-flame', targets: [DRUID] },
      supply(blade.state),
    );
    expect(isErr(flame) && flame.code).toBe('no_free_hand');

    const lit = shielded();
    lit.cast('produce-flame', { targets: [DRUID] });
    const sword = resolveSpell(
      lit.state,
      DRUID,
      { spellId: 'flame-blade', targets: [DRUID], slotLevel: 2 },
      supply(lit.state),
    );
    expect(isErr(sword) && sword.code).toBe('no_free_hand');
  });
});

/**
 * SRD Darkness: "If any of this spell's area overlaps with an area of Bright
 * Light or Dim Light created by a spell of level 2 or lower, **that other spell
 * is dispelled**." SRD Daylight prints the mirror at level 3. (E-L2)
 *
 * The sentence belongs to the spell that prints it and holds whichever came
 * first: a Darkness laid over a light puts it out, and a light laid into a
 * Darkness — or carried into one — is put out by it. A spell that prints no
 * such sentence dispels nothing, whatever its level: Moonbeam and Flame Blade
 * are level 2 and lose to a Darkness rather than ending it.
 */
describe('the dispel belongs to the spell that prints it, whichever came first', () => {
  const WISP_ROOM = (darkFirst = false): Room => {
    const r = new Room([
      ...caster(DRUID),
      ...caster(ALLY),
      added(SNEAK, { stated: { armorClass: 1, proficiencyBonus: 2, initiative: 0 } }, 'goblins'),
      {
        type: 'spellcasting-declared',
        id: DRUID,
        spellcasting: declaredCasting({ ability: 'wis', classId: 'druid', cantrips: ['starry-wisp'], prepared: [] }),
      },
      { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
      placed(DRUID, at(100, 100)),
      placed(ALLY, at(105, 100)),
      placed(SNEAK, at(100, 130)),
      { type: 'sight-declared', from: DRUID, to: SNEAK, seen: true },
    ]);
    // A Darkness already standing over the sneak, cast before anybody's turn.
    if (darkFirst) r.cast('darkness', { at: at(100, 130), slotLevel: 2 }, ALLY);
    return r.push({
      type: 'combat-started',
      combatants: [
        { id: DRUID, initiative: 20, speed: 30 },
        { id: ALLY, initiative: 15, speed: 30 },
        { id: SNEAK, initiative: 10, speed: 30 },
      ],
    });
  };

  /** The wisp's own timer — the key its glow lapses with. */
  const glowTimerOf = (events: readonly GameEvent[]): string => {
    const glow = events.find((event) => event.type === 'light-declared' && event.lapsesWith !== undefined);
    return glow?.type === 'light-declared' ? glow.lapsesWith! : '';
  };

  /**
   * SRD Starry Wisp's glow is a spell's Dim Light on a deadline of its own —
   * its casting is Instantaneous and never reaches `state.ongoing` — so the
   * dispel ends **the timer** it lapses with, which takes the glow and the
   * Invisible it denies with it: "that other spell is dispelled", whole.
   */
  it('puts out Starry Wisp’s glow when a Darkness is laid over it', () => {
    const r = WISP_ROOM();
    const out = unwrap(
      resolveSpell(r.state, DRUID, { spellId: 'starry-wisp', targets: [SNEAK] }, supply(r.state, 'wisp')),
      'wisp',
    );
    r.push(...out.events);
    const timer = glowTimerOf(out.events);
    expect(r.state.timers[timer]).toBeDefined();
    r.run('the druid’s turn ends', (state) => resolveTurn(state, supply(state, 'turn')));

    r.cast('darkness', { at: at(100, 130), slotLevel: 2 }, ALLY);

    expect(r.light(at(100, 130))).toMatchObject({ level: 'darkness', magical: true });
    expect(r.state.timers[timer]).toBeUndefined();
  });

  it('puts out Starry Wisp’s glow when it lands on a creature standing in a Darkness', () => {
    const r = WISP_ROOM(true);
    const darkness = Object.keys(r.state.ongoing)[0]!;
    const out = unwrap(
      resolveSpell(r.state, DRUID, { spellId: 'starry-wisp', targets: [SNEAK] }, supply(r.state, 'wisp')),
      'wisp',
    );
    expect(out.outcomes[0]?.attack?.hit).toBe(true);
    r.push(...out.events);

    expect(r.state.timers[glowTimerOf(out.events)]).toBeUndefined();
    expect(r.state.ongoing[darkness]).toBeDefined();
    expect(r.light(at(100, 130)).level).toBe('darkness');
  });

  /** Flame Blade is level 2 and prints no dispel: it is the one put out. */
  it('puts out a Flame Blade evoked inside a Darkness, and leaves the Darkness', () => {
    const r = room(...caster(ALLY).slice(1));
    const darkness = r.cast('darkness', { at: at(110, 100), slotLevel: 2 }, ALLY);
    const blade = r.cast('flame-blade', { targets: [DRUID], slotLevel: 2 });

    expect(r.state.ongoing[blade]).toBeUndefined();
    expect(r.state.ongoing[darkness]).toBeDefined();
    expect(r.light(at(100, 100)).level).toBe('darkness');
  });

  it('puts out a Moonbeam cast into a Darkness, and leaves the Darkness', () => {
    const r = room(...caster(ALLY).slice(1));
    const darkness = r.cast('darkness', { at: at(150, 100), slotLevel: 2 }, ALLY);
    const beam = r.cast('moonbeam', { at: at(150, 100), slotLevel: 2 });

    expect(r.state.ongoing[beam]).toBeUndefined();
    expect(r.state.ongoing[darkness]).toBeDefined();
    expect(r.light(at(150, 100)).level).toBe('darkness');
  });

  it('puts out a Light cast on a creature standing in a Darkness', () => {
    const r = room(...caster(ALLY).slice(1));
    r.cast('darkness', { at: at(110, 100), slotLevel: 2 }, ALLY);
    const light = r.cast('light', { targets: [DRUID] });

    expect(r.state.ongoing[light]).toBeUndefined();
    expect(r.light(at(100, 100)).level).toBe('darkness');
  });

  /**
   * A light carried into the Darkness overlaps it the moment its bearer
   * arrives, and nobody re-lays anything: the patch is the bearer's, so the
   * move is the moment.
   */
  it('puts out a Light whose bearer walks into a Darkness', () => {
    const r = room(...caster(ALLY).slice(1));
    const light = r.cast('light', { targets: [DRUID] });
    const darkness = r.cast('darkness', { at: at(160, 100), slotLevel: 2 }, ALLY);
    expect(r.state.ongoing[light]).toBeDefined();

    r.push(moved(DRUID, at(150, 100)));

    expect(r.state.ongoing[light]).toBeUndefined();
    expect(r.state.ongoing[darkness]).toBeDefined();
    expect(r.light(at(150, 100)).level).toBe('darkness');
  });

  it('leaves a Light whose bearer walks nowhere near the Darkness', () => {
    const r = room(...caster(ALLY).slice(1));
    const light = r.cast('light', { targets: [DRUID] });
    r.cast('darkness', { at: at(160, 100), slotLevel: 2 }, ALLY);

    r.push(moved(DRUID, at(60, 100)));

    expect(r.state.ongoing[light]).toBeDefined();
  });
});

describe('SRD Daylight covered on its object', () => {
  const LAMP = id('the lamp');

  it('stops giving a Kobold its Disadvantage', () => {
    const r = room(added(KOBOLD, { standing: [SENSITIVE] }, 'goblins'), placed(KOBOLD, at(110, 100)));
    r.object(LAMP, at(100, 105));
    const daylight = r.cast('daylight', { at: at(100, 105), slotLevel: 3 });
    r.move(daylight, { to: { creature: LAMP } });

    const modes = () =>
      rollModesFor(r.state, { roller: KOBOLD, against: DRUID, family: 'attack' }).modes.map(
        (mode) => mode.source,
      );
    expect(modes()).toContain('Sunlight Sensitivity');

    r.move(daylight, { covered: true });
    expect(modes()).not.toContain('Sunlight Sensitivity');
  });
});

describe('what moveCastLight refuses', () => {
  it('a casting that is not running', () => {
    const r = room();
    const moved = moveCastLight(r.state, SRD_CONTENT, 'cast:99', { covered: true });

    expect(isErr(moved) && moved.code).toBe('not_ongoing');
  });

  it('a light the spell prints on no object: Faerie Fire’s outline', () => {
    const r = room();
    const fire = r.cast('faerie-fire', {
      at: at(100, 100),
      towards: at(100, 200),
      slotLevel: 1,
    });
    const moved = moveCastLight(r.state, SRD_CONTENT, fire, { to: { creature: ALLY } });

    expect(isErr(moved) && moved.code).toBe('no_object');
  });

  it('a call that says neither where nor whether it is covered', () => {
    const r = room();
    const light = r.cast('light', { targets: [DRUID] });
    const moved = moveCastLight(r.state, SRD_CONTENT, light, {});

    expect(isErr(moved) && moved.code).toBe('nothing_to_move');
  });

  /** Cast before there was a scene, the light lies over no space to move. */
  it('a light that was never laid on the lattice', () => {
    const r = new Room([...caster(DRUID), added(ALLY)]);
    const light = r.cast('light', { targets: [DRUID] });
    r.push({ type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } });
    const moved = moveCastLight(r.state, SRD_CONTENT, light, { covered: true });

    expect(isErr(moved) && moved.code).toBe('no_light_laid');
  });

  it('asks where an object is before laying a Darkness on it', () => {
    const r = room();
    const darkness = r.cast('darkness', { at: at(130, 100), slotLevel: 2 });
    r.run('declare the stone', (state) =>
      declareObject(state, SRD_CONTENT, id('the stone'), {
        name: 'the stone',
        material: 'stone',
        size: 'tiny',
        build: 'resilient',
      }),
    );
    const moved = moveCastLight(r.state, SRD_CONTENT, darkness, { to: { creature: id('the stone') } });

    expect(moved.ok).toBe(false);
    expect(!moved.ok && moved.kind).toBe('needs-context');
  });

  it('is idempotent under its command id', () => {
    const r = room();
    const light = r.cast('light', { targets: [DRUID] });
    r.move(light, { covered: true, commandId: 'bowl' });
    const again = unwrap(
      moveCastLight(r.state, SRD_CONTENT, light, { covered: true, commandId: 'bowl' }),
      'again',
    );

    expect(again).toEqual([]);
  });
});

describe('what a definition may say about a light on a thing', () => {
  const base = {
    id: 'homebrew-glow',
    name: 'Homebrew Glow',
    level: 0,
    school: 'evocation',
    castingTime: 'action',
    concentration: false,
    durationSeconds: 60,
    range: { kind: 'touch' },
    targets: { count: 1, self: true },
    effects: [{ kind: 'light', level: 'bright', radius: 10 }],
  };
  const codes = (definition: unknown): readonly string[] =>
    checkSpellDefinitionValue(definition).map((one) => one.code);

  it('takes each reading where the light it moves is written', () => {
    expect(codes({ ...base, lightOnObject: 'always' })).toEqual([]);
    expect(
      codes({
        ...base,
        targets: { count: 0 },
        effects: [],
        range: { kind: 'ranged', feet: 60 },
        area: { kind: 'sphere', radius: 15, origin: 'point' },
        areaLight: { level: 'darkness' },
        lightOnObject: 'or-a-point',
      }),
    ).toEqual([]);
  });

  it('refuses a reading the vocabulary does not print', () => {
    expect(codes({ ...base, lightOnObject: 'sometimes' })).toContain('bad_light_on_object');
  });

  it('refuses a light on a thing where the definition lays no light to move', () => {
    expect(codes({ ...base, effects: [], unmodelled: ['nothing'], lightOnObject: 'always' })).toContain(
      'light_on_object_without_light',
    );
    expect(codes({ ...base, lightOnObject: 'or-a-point' })).toContain('light_on_object_without_light');
  });
});

describe('the past', () => {
  it('folds a light-declared carrying none of the new fields exactly as before', () => {
    const state = fold('past', [
      { type: 'scene-set', extent: { width: 100, depth: 100, height: 20 } },
      {
        type: 'light-declared',
        patch: 'the brazier',
        region: { origin: { space: at(50, 50) }, shape: { kind: 'sphere', radius: 10 } },
        level: 'bright',
      },
    ]);

    expect(state.scene!.light['the brazier']).toEqual({
      region: { origin: { space: at(50, 50) }, shape: { kind: 'sphere', radius: 10 } },
      level: 'bright',
    });
    expect(lightAt(state, at(50, 50)).level).toBe('bright');
  });
});
