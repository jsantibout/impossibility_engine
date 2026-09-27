import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { areaPointAt, obscurementAt, type Point } from './positioning.js';
import { canSee } from './standing.js';
import { activateSpell, declareWind, resolveSpell } from './commands.js';

/**
 * A strong wind, and the two clouds it disperses.
 *
 * > SRD Fog Cloud: "It lasts for the duration or until a strong wind (such as
 * > one created by _Gust of Wind_) disperses it."
 * > SRD Stinking Cloud: "The cloud lingers in the air for the duration or
 * > until a strong wind (such as the one created by _Gust of Wind_) disperses
 * > it."
 * > SRD Gust of Wind: "A Line of strong wind 60 feet long and 10 feet wide
 * > blasts from you … The gust disperses gas or vapor."
 *
 * Two halves of one sentence, written on two different spells: the clouds
 * print what ends them (`dispersed-by-wind`), and the gust prints what it does
 * to the air it blows through (`disperses`). The ending is derived in the fold
 * off the two records' own geometry — some space in both — with no dice and
 * nobody deciding it, on Tiny Hut's precedent. A wind the table says blows is
 * the third source (`wind-declared`), because the book says "a strong wind",
 * of which Gust of Wind is only the example.
 */

const id = (s: string) => asCharacterId(s);
const DRUID = id('druid');
const MAGE = id('mage');
const HERMIT = id('hermit');
const SORC = id('sorc');
const WEAVER = id('weaver');
const DWARF = id('dwarf');
const ROGUE = id('rogue');
const VICTIM = id('victim');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 18, cha: 10 },
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
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'party',
});

/** Darkvision 60, as a species trait grants it. */
const DARKVISION_60 = {
  feature: 'a-species:darkvision',
  name: 'Darkvision',
  reach: { kind: 'self' },
  grant: { kind: 'sense', sense: 'darkvision', feet: 60 },
} as const;

const caster = (who: CharacterId, spellId: string, level: number): readonly GameEvent[] => [
  added(who),
  {
    type: 'spellcasting-declared',
    id: who,
    spellcasting: declaredCasting({ ability: 'int', prepared: [spellId] }),
  },
  {
    type: 'resource-pool-declared',
    id: who,
    pool: { key: spellSlotKey(level), label: `level ${level}`, max: 3, recovers: 'long-rest' },
  },
];

const at = (name: string, point: Point): GameEvent => ({ type: 'landmark-added', name, at: point });
const put = (who: CharacterId, landmark: string): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { landmark }, feet: 0 },
});

/** The druid at the hall; the Line blows due east, sixty feet long. */
const HALL: Point = { x: 100, y: 100, z: 0 };
const EAST: Point = { x: 200, y: 100, z: 0 };
const NORTH: Point = { x: 100, y: 200, z: 0 };
/** Forty feet down the Line: the fog's centre sits on it. */
const DOWN_THE_LINE: Point = { x: 140, y: 100, z: 0 };
/** Fifteen feet off the Line's side and inside the fog's twenty. */
const BESIDE_THE_LINE: Point = { x: 140, y: 115, z: 0 };
/** Far across the room, where no gust reaches. */
const FAR_CORNER: Point = { x: 320, y: 320, z: 0 };

const ROOM: readonly GameEvent[] = [
  ...caster(DRUID, 'gust-of-wind', 2),
  ...caster(MAGE, 'fog-cloud', 1),
  ...caster(HERMIT, 'fog-cloud', 1),
  ...caster(SORC, 'stinking-cloud', 3),
  ...caster(WEAVER, 'web', 2),
  added(DWARF, { standing: [DARKVISION_60] }),
  added(ROGUE),
  added(VICTIM),
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  at('the hall', HALL),
  at('the balcony', { x: 140, y: 200, z: 0 }),
  at('the far stair', { x: 300, y: 260, z: 0 }),
  at('the gallery', { x: 160, y: 160, z: 0 }),
  at('the loom', { x: 120, y: 150, z: 0 }),
  at('the arch', { x: 250, y: 60, z: 0 }),
  at('beside the line', BESIDE_THE_LINE),
  at('in the gas', { x: 215, y: 100, z: 0 }),
  at('a step east', { x: 140, y: 100, z: 0 }),
  put(DRUID, 'the hall'),
  put(MAGE, 'the balcony'),
  put(HERMIT, 'the far stair'),
  put(SORC, 'the gallery'),
  put(WEAVER, 'the loom'),
  put(DWARF, 'the arch'),
  put(ROGUE, 'beside the line'),
  put(VICTIM, 'in the gas'),
];

/** A flat bonus that settles every save, so nobody is pushed out of the story. */
const supply = (seed = 'wind') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  bonuses: [{ source: 'the fixture', flat: 40 }],
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

const cast = (
  log: readonly GameEvent[],
  who: CharacterId,
  request: Parameters<typeof resolveSpell>[2],
): { readonly log: readonly GameEvent[]; readonly castingId: string } => {
  const out = unwrap(resolveSpell(state(log), who, request, supply()), `${who} casts ${request.spellId}`);
  return { log: [...log, ...out.events], castingId: out.castingId! };
};

const fog = (log: readonly GameEvent[], who = MAGE, where: Point = DOWN_THE_LINE) =>
  cast(log, who, { spellId: 'fog-cloud', targets: [], at: where, slotLevel: 1 });
const gust = (log: readonly GameEvent[], towards: Point = EAST) =>
  cast(log, DRUID, { spellId: 'gust-of-wind', targets: [], towards, slotLevel: 2 });
const stench = (log: readonly GameEvent[], where: Point) =>
  cast(log, SORC, { spellId: 'stinking-cloud', targets: [], at: where, slotLevel: 3 });

describe('the definitions print the wind', () => {
  const definition = (spellId: string) => SPELL_DEFINITIONS.find((one) => one.id === spellId)!;

  it('ends Fog Cloud and Stinking Cloud on a strong wind, and nothing else on it', () => {
    expect(definition('fog-cloud').endsEarly).toEqual([{ on: 'dispersed-by-wind', ends: 'casting' }]);
    expect(definition('stinking-cloud').endsEarly).toEqual([
      { on: 'dispersed-by-wind', ends: 'casting' },
    ]);
    expect(definition('web').endsEarly?.map((one) => one.on)).not.toContain('dispersed-by-wind');
  });

  it('makes Gust of Wind’s Line disperse gas', () => {
    expect(definition('gust-of-wind').areaStanding).toEqual([{ kind: 'disperses', what: 'gas' }]);
    expect(checkSpellDefinitionValue(definition('gust-of-wind'))).toEqual([]);
  });

  it('refuses a dispersal of anything the book does not blow away, and a wind that ends one target', () => {
    const gusty = definition('gust-of-wind');
    const codes = (value: unknown): readonly string[] =>
      checkSpellDefinitionValue({ ...gusty, areaStanding: [value] }).map((one) => one.code);
    expect(codes({ kind: 'disperses', what: 'smoke' })).toContain('unknown_dispersal');
    expect(codes({ kind: 'disperses' })).toContain('unknown_dispersal');

    const foggy = definition('fog-cloud');
    expect(
      checkSpellDefinitionValue({
        ...foggy,
        endsEarly: [{ on: 'dispersed-by-wind', ends: 'target' }],
      }).map((one) => one.code),
    ).toContain('inert_end_scope');
  });
});

describe('Gust of Wind disperses a cloud', () => {
  it('ends a Fog Cloud the Line is cast through, and the Rogue in it stands in clear air', () => {
    const fogged = fog(ROOM);
    expect(obscurementAt(state(fogged.log), BESIDE_THE_LINE).degree).toBe('heavily');

    const blown = gust(fogged.log);
    const after = state(blown.log);
    expect(after.ongoing[fogged.castingId]).toBeUndefined();
    expect(after.ongoing[blown.castingId]).toBeDefined();
    expect(obscurementAt(after, BESIDE_THE_LINE).degree).toBeNull();
    // The fog's caster is concentrating on nothing: the one door out took it.
    expect(after.creatures[MAGE]!.concentration).toBeNull();
  });

  it('ends a Fog Cloud cast into a Line that is already blowing, at once', () => {
    const blown = gust(ROOM);
    const fogged = fog(blown.log);
    const after = state(fogged.log);
    expect(after.ongoing[fogged.castingId]).toBeUndefined();
    expect(obscurementAt(after, BESIDE_THE_LINE).degree).toBeNull();
  });

  it('leaves a fog the Line does not reach', () => {
    const far = fog(ROOM, HERMIT, FAR_CORNER);
    const after = state(gust(far.log).log);
    expect(after.ongoing[far.castingId]).toBeDefined();
    expect(obscurementAt(after, FAR_CORNER).degree).toBe('heavily');
  });

  /**
   * "blasts from you": the Line is carried, so a druid who steps carries the
   * wind with them. Seventy-five feet east of the hall is out of the sixty; a
   * step of forty brings the Line's tip into the gas.
   */
  it('ends a Stinking Cloud the druid steps the Line into', () => {
    const blown = gust(ROOM);
    const gas = stench(blown.log, { x: 215, y: 100, z: 0 });
    expect(state(gas.log).ongoing[gas.castingId]).toBeDefined();

    const stepped = [
      ...gas.log,
      {
        type: 'creature-moved',
        id: DRUID,
        placement: { from: { landmark: 'a step east' }, feet: 0 },
      } as GameEvent,
    ];
    expect(state(stepped).ongoing[gas.castingId]).toBeUndefined();
  });

  it('ends a Stinking Cloud the Bonus Action turns the Line onto', () => {
    const blown = gust(ROOM);
    const gas = stench(blown.log, { x: 100, y: 170, z: 0 });
    expect(state(gas.log).ongoing[gas.castingId]).toBeDefined();

    const turned = unwrap(
      activateSpell(state(gas.log), DRUID, { castingId: blown.castingId, targets: [], towards: NORTH }, supply()),
      'the Line turned north',
    );
    const after = state([...gas.log, ...turned.events]);
    expect(after.ongoing[gas.castingId]).toBeUndefined();
    expect(after.ongoing[blown.castingId]).toBeDefined();
  });

  it('leaves a Web in the Line standing, because Web prints no wind', () => {
    const webbed = cast(ROOM, WEAVER, {
      spellId: 'web',
      targets: [],
      at: { x: 120, y: 100, z: 0 },
      towards: { x: 140, y: 100, z: 0 },
      slotLevel: 2,
    });
    const after = state(gust(webbed.log).log);
    expect(after.ongoing[webbed.castingId]).toBeDefined();
  });
});

describe('Stinking Cloud is Heavily Obscured', () => {
  it('lays its obscurement, and a Dwarf with Darkvision does not see into it', () => {
    const gas = stench(ROOM, { x: 215, y: 100, z: 0 });
    const after = state(gas.log);
    expect(obscurementAt(after, { x: 215, y: 100, z: 0 }).degree).toBe('heavily');
    expect(canSee(after, DWARF, VICTIM)).toBe(false);
  });
});

describe('the table’s wind', () => {
  it('ends every fog in the scene when it names no region', () => {
    const one = fog(ROOM);
    const two = fog(one.log, HERMIT, FAR_CORNER);
    const blown = unwrap(declareWind(state(two.log), {}), 'a gale');
    expect(blown).toEqual([{ type: 'wind-declared' }]);
    const after = state([...two.log, ...blown]);
    expect(after.ongoing[one.castingId]).toBeUndefined();
    expect(after.ongoing[two.castingId]).toBeUndefined();
  });

  it('ends only the fogs its region touches', () => {
    const one = fog(ROOM);
    const two = fog(one.log, HERMIT, FAR_CORNER);
    const blown = unwrap(
      declareWind(state(two.log), {
        region: { origin: areaPointAt(FAR_CORNER), shape: { kind: 'sphere', radius: 10 } },
      }),
      'a draught in the corner',
    );
    const after = state([...two.log, ...blown]);
    expect(after.ongoing[one.castingId]).toBeDefined();
    expect(after.ongoing[two.castingId]).toBeUndefined();
  });

  it('is refused where there is no scene for a region to lie in', () => {
    const out = declareWind(state([]), {
      region: { origin: areaPointAt(FAR_CORNER), shape: { kind: 'sphere', radius: 10 } },
    });
    expect(isErr(out) && out.code).toBe('no_scene');
  });
});

describe('the past', () => {
  /**
   * A record pinned before the cause existed prints no `endsEarly`, and the
   * fold reads what the record says rather than what the book says today.
   */
  it('leaves a cloud whose record printed no wind running in a gale', () => {
    const fogged = fog(ROOM);
    const older = fogged.log.map((event): GameEvent => {
      if (event.type !== 'spell-ongoing') return event;
      const rest = { ...event.casting };
      delete (rest as { endsEarly?: unknown }).endsEarly;
      return { ...event, casting: rest };
    });
    const blown = gust(older);
    expect(state(blown.log).ongoing[fogged.castingId]).toBeDefined();
    const declared = [...older, { type: 'wind-declared' } as GameEvent];
    expect(state(declared).ongoing[fogged.castingId]).toBeDefined();
  });
});
