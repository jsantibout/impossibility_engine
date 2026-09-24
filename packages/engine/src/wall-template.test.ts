import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import { creaturesInArea, type Point } from './positioning.js';
import { resolveSpell } from './commands.js';
import { creaturesStandingInCastingArea } from './spells.js';

/**
 * A wall the caster draws, and the one template that is not a printed shape.
 *
 * SRD Wind Wall: "A wall of strong wind rises from the ground at a point you
 * choose within range. You can make the wall **up to 50 feet long, 15 feet
 * high**, and 1 foot thick. You can shape the wall in any way you choose so
 * long as it makes **one continuous path along the ground**."
 *
 * Every other area in the book is a dimension and, for three of them, a
 * direction: a reader can rebuild a 20-foot Cube from the page and a point.
 * Fifty feet of wall bent around a corner is a decision somebody took space by
 * space, and no number rebuilds which corner — which is why the path is stated
 * at the casting, judged there against the four sentences above, and not
 * pinned on the record for a later question no clause of this spell asks.
 *
 * **The engine judges and never straightens.** There is no shortest-path
 * answer to "where would you like your wall", so a path that is too long, not
 * continuous, doubling back, or off the ground is refused rather than
 * corrected.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
/** Standing on the wall's second space. */
const CAUGHT = id('caught');
/** Standing beside it: one space off the path, and not in the wall. */
const BESIDE = id('beside');
/** Standing on the space the wall rises from, which is wall like any other. */
const AT_THE_END = id('at-the-end');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 10, con: 14, int: 16, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

const MAX_HP = 200;

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: MAX_HP,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === DRUID ? 'party' : 'foes',
});

/** Every save fails by default, so a creature the wall caught is a creature that shows. */
const supply = (seed = 'wall', flat = -40) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed),
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

const at = (x: number, y: number, z = 0): Point => ({ x, y, z });

/**
 * The lane, and a wall that turns.
 *
 * The druid stands at (200, 200). The wall rises at (250, 200) — fifty feet
 * away, well inside Wind Wall's 120 — runs three spaces east and then turns
 * north, which is the corner a length and a bearing could not have said.
 */
const RISES = at(250, 200);
const CORNER: readonly Point[] = [
  at(250, 200),
  at(255, 200),
  at(260, 200),
  at(260, 205),
  at(260, 210),
];

const place = (who: CharacterId, p: Point): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { point: p }, feet: 0 },
});

const TABLE: readonly GameEvent[] = [
  added(DRUID),
  added(CAUGHT),
  added(BESIDE),
  added(AT_THE_END),
  ...[3, 4, 5].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 3, recovers: 'long-rest' },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['wind-wall'] }),
  },
  { type: 'scene-set', extent: { width: 900, depth: 900, height: 100 } },
  place(DRUID, at(200, 200)),
  place(CAUGHT, at(260, 205)),
  place(BESIDE, at(265, 205)),
  place(AT_THE_END, RISES),
];

const state = (): GameState => fold('s', TABLE);

const cast = (path: readonly Point[], seed = 'wall') =>
  resolveSpell(
    state(),
    DRUID,
    { spellId: 'wind-wall', targets: [], path, slotLevel: 3 },
    supply(seed),
  );

const caughtBy = (out: ReturnType<typeof cast>): readonly string[] =>
  out.ok ? out.value.outcomes.filter((one) => one.affected === true).map((one) => one.target) : [];

// — the definition ————————————————————————————————————————————————————————————

describe('the template the definition declares', () => {
  const wall = SPELL_DEFINITIONS.find((d) => d.id === 'wind-wall');

  it('states the two bounds the book prints', () => {
    expect(wall?.area).toEqual({ kind: 'wall', length: 50, height: 15, origin: 'point' });
  });

  /** And the save over it is the most ordinary shape in the book. */
  it('resolves an ordinary Strength save for half', () => {
    expect(wall?.effects).toEqual([
      {
        kind: 'save-damage',
        ability: 'str',
        damage: { dice: '4d8' },
        damageType: 'bludgeoning',
        onSuccess: 'half',
      },
    ]);
  });

  /** It is the only wall in the catalogue, so nothing here generalises. */
  it('is the only spell drawing one so far', () => {
    expect(SPELL_DEFINITIONS.filter((d) => d.area?.kind === 'wall').map((d) => d.id)).toEqual([
      'wind-wall',
    ]);
  });
});

// — who a stated path catches ——————————————————————————————————————————————————

describe('a wall catches the creatures standing on it', () => {
  it('catches the two creatures its path runs through', () => {
    const out = cast(CORNER);
    expect(out.ok).toBe(true);
    expect([...caughtBy(out)].sort()).toEqual([AT_THE_END, CAUGHT].sort());
  });

  /**
   * And not the one standing five feet off it. The wall is the spaces its path
   * names and nothing around them: an implementation that measured a distance
   * from the point it rose at would have caught this creature and, at fifty
   * feet, most of the room.
   */
  it('leaves the creature beside it alone', () => {
    expect(caughtBy(cast(CORNER))).not.toContain(BESIDE);
    expect(fold('s', [...TABLE, ...unwrap(cast(CORNER), 'wind wall').events]).creatures[BESIDE]
      ?.vitals.hp).toBe(MAX_HP);
  });

  /**
   * **The corner is the whole point.** The same five spaces drawn straight
   * east instead catch a different set, and no length and bearing could have
   * told the two paths apart.
   */
  it('catches a different set when the wall is drawn straight', () => {
    const straight = [at(250, 200), at(255, 200), at(260, 200), at(265, 200), at(270, 200)];
    expect(caughtBy(cast(straight))).toEqual([AT_THE_END]);
  });

  /** And it stands fifteen feet up, which is a fact about the lattice. */
  it('reaches the height the book prints and no further', () => {
    const scene = state().scene!;
    const shape = { kind: 'wall', path: CORNER, height: 15 } as const;
    const origin = { space: RISES } as const;
    expect(unwrap(creaturesInArea(scene, origin, shape), 'in the wall')).toContain(CAUGHT);
    expect(
      unwrap(creaturesInArea(scene, origin, { ...shape, height: 5 }), 'a shorter wall'),
    ).toContain(CAUGHT);
  });
});

// — what the book will not let a caster draw ——————————————————————————————————

describe('a path the spell does not permit', () => {
  const refusal = (path: readonly Point[]): string => {
    const out = cast(path);
    return isErr(out) ? out.code : 'ok';
  };

  /** "up to 50 feet long", which is ten spaces. Eleven is fifty-five. */
  it('refuses a wall longer than the fifty feet the book allows', () => {
    const long = Array.from({ length: 11 }, (_, n) => at(250 + n * 5, 200));
    expect(refusal(long)).toBe('wall_too_long');
    expect(refusal(long.slice(0, 10))).toBe('ok');
  });

  /** "one continuous path": a gap is two walls, and the spell makes one. */
  it('refuses a path with a gap in it', () => {
    expect(refusal([at(250, 200), at(255, 200), at(270, 200)])).toBe('wall_not_continuous');
  });

  /** "along the ground": one ground, not a staircase. */
  it('refuses a path that climbs', () => {
    expect(refusal([at(250, 200), at(255, 200, 5)])).toBe('wall_not_continuous');
  });

  /** A path that crosses itself has counted the same ground twice. */
  it('refuses a path that doubles back over itself', () => {
    expect(refusal([at(250, 200), at(255, 200), at(250, 200)])).toBe('wall_not_continuous');
  });

  /** A wall is what this spell is; a casting that draws none has cast nothing. */
  it('refuses a casting that draws no wall at all', () => {
    expect(refusal([])).toBe('no_wall_path');
  });

  /** "at a point you choose within range" — measured to the space it rises from. */
  it('refuses a wall that rises out of range', () => {
    expect(refusal([at(500, 200), at(505, 200)])).toBe('out_of_range');
  });

  /** And a point stated beside a path has to be the path's own beginning. */
  it('refuses a stated point that is not where the wall rises', () => {
    const out = resolveSpell(
      state(),
      DRUID,
      { spellId: 'wind-wall', targets: [], path: CORNER, at: at(255, 200), slotLevel: 3 },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('no_wall_path');
  });

  /**
   * A wall has no direction to point, and every other template has no path to
   * be drawn along. Both are stated facts nothing would read, which is the
   * defect `not_directional` already refuses from the other side.
   */
  it('refuses a direction stated beside a wall', () => {
    const out = resolveSpell(
      state(),
      DRUID,
      { spellId: 'wind-wall', targets: [], path: CORNER, towards: at(300, 200), slotLevel: 3 },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('not_directional');
  });

  it('refuses a path stated for a template that is not drawn', () => {
    const out = resolveSpell(
      fold('s', [
        ...TABLE,
        {
          type: 'spellcasting-declared',
          id: DRUID,
          spellcasting: declaredCasting({ ability: 'wis', prepared: ['wind-wall', 'fireball'] }),
        },
      ]),
      DRUID,
      { spellId: 'fireball', targets: [], at: at(260, 200), path: CORNER, slotLevel: 3 },
      supply(),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('area_is_not_drawn');
  });

  /** Every refusal is free: a wall nobody could draw costs no slot. */
  it('spends nothing on a path it refuses', () => {
    const before = state();
    expect(refusal([])).toBe('no_wall_path');
    expect(before.creatures[DRUID]?.resources.pools[spellSlotKey(3)]?.spent).toBe(0);
  });
});

// — and it folds ——————————————————————————————————————————————————————————————

describe('the whole spell, end to end through the public API', () => {
  it('spends the slot, concentrates, and folds from the log alone', () => {
    const out = unwrap(cast(CORNER), 'wind wall');
    const log = [...TABLE, ...out.events];
    const after = fold('s', log);

    expect(after.creatures[DRUID]?.resources.pools[spellSlotKey(3)]?.spent).toBe(1);
    expect(after.creatures[DRUID]?.concentration?.spell).toBe('Wind Wall');
    expect(after.creatures[CAUGHT]?.vitals.hp).toBeLessThan(MAX_HP);

    expect(fold('s', JSON.parse(JSON.stringify(log)) as GameEvent[])).toEqual(after);
    for (let n = 0; n <= log.length; n += 1) {
      expect(() => fold('s', log.slice(0, n))).not.toThrow();
    }
  });

  /**
   * **And nothing asks about the wall again.**
   *
   * `spell-resolution.ts` pins an area's point only where one of the four
   * clauses that read it later is written — a trigger, terrain, light,
   * obscurement — and Wind Wall writes none of them, so the record keeps the
   * casting and nothing geometric at all. That is the honest consequence of a
   * shape being *drawn* rather than printed: the path could not be
   * reconstructed from the book and a point, so nothing pretends it can, and
   * `checkSpellDefinition` refuses every clause that would want to ask.
   */
  it('keeps the casting and nothing about the shape it was drawn in', () => {
    const out = unwrap(cast(CORNER), 'wind wall');
    const after = fold('s', [...TABLE, ...out.events]);
    const record = Object.values(after.ongoing).find((one) => one.spellId === 'wind-wall');
    expect(record).toBeDefined();
    // The printed bounds are pinned like every other template's dimensions —
    // they reconstruct themselves off the page — and the two facts that were
    // decisions are not there at all: where it rose, and the shape it was
    // drawn in.
    expect(record?.area).toEqual({ kind: 'wall', length: 50, height: 15, origin: 'point' });
    expect(record?.origin).toBeUndefined();
    expect(record?.areaTrigger).toBeUndefined();
    // Which is what `areaShapeOf` answers null for, so no later question about
    // this casting has a shape to be asked of.
    expect(creaturesStandingInCastingArea(after.scene!, record!)).toBeNull();
  });
});
