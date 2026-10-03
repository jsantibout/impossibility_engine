import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { hasCondition } from './conditions.js';
import { obscurementAt, terrainAt, type Point } from './positioning.js';
import { exposeToFire, resolveSpell, resolveTurn } from './commands.js';
import { checkSpellDefinitionValue } from './spell-schema.js';

/**
 * SRD Web: "**The webs are flammable. Any 5-foot Cube of webs exposed to fire
 * burns away in 1 round, dealing 2d4 Fire damage to any creature that starts
 * its turn in the fire.**" (E-L2)
 *
 * Whether a Cube of webs meets fire is the table's to say — a torch, a Fire
 * Bolt through the strands, a burning goblin — and what follows is the
 * engine's: for the round the Cube burns, a creature that starts its turn in it
 * takes the 2d4 the engine throws; when the round is out the Cube is gone from
 * the webs, so it is ordinary ground and clear air again and a creature
 * Restrained "while in the webs" whose only space it was is free. The rest of
 * the webs stand.
 */

const id = (s: string) => asCharacterId(s);
const WEAVER = id('weaver');
const GOBLIN = id('goblin');
const OGRE = id('ogre');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** A Dexterity nobody saves with. */
const CLUMSY: Partial<CharacterSheet> = {
  abilities: { str: 10, dex: 1, con: 10, int: 10, wis: 10, cha: 10 },
};

const WEB_AT: Point = { x: 120, y: 100, z: 0 };
const WEB_TOWARDS: Point = { x: 140, y: 100, z: 0 };
/** The goblin's Cube of webs, and another the fire never reaches. */
const BURNING: Point = { x: 130, y: 100, z: 0 };
const UNTOUCHED: Point = { x: 120, y: 100, z: 0 };
const OUTSIDE: Point = { x: 200, y: 100, z: 0 };

const ROOM: readonly GameEvent[] = [
  added(WEAVER, 'party'),
  added(GOBLIN, 'foes', CLUMSY),
  added(OGRE, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WEAVER,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['web', 'fog-cloud'] }),
  },
  ...[1, 2].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WEAVER,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 3, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'creature-placed', id: WEAVER, placement: { from: { point: { x: 100, y: 100, z: 0 } }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { point: BURNING }, feet: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { point: OUTSIDE }, feet: 0 } },
  {
    type: 'combat-started',
    combatants: [
      { id: WEAVER, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (state: GameState, flat = 0) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('tinder') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the fixture', flat }],
});

const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

/** The web spun in the weaver's turn, and the goblin's Cube of it set alight before the goblin's turn. */
const alight = () => {
  const log: GameEvent[] = [...ROOM];
  const spun = unwrap(
    resolveSpell(
      fold('tinder', log),
      WEAVER,
      { spellId: 'web', targets: [], at: WEB_AT, towards: WEB_TOWARDS, slotLevel: 2 },
      supply(fold('tinder', log)),
    ),
    'the web',
  );
  log.push(...spun.events);
  log.push(...unwrap(exposeToFire(fold('tinder', log), SRD_CONTENT, spun.castingId!, BURNING), 'the torch'));
  return { log, castingId: spun.castingId! };
};

const turn = (log: GameEvent[], flat = 0): readonly GameEvent[] => {
  const state = fold('tinder', log);
  const out = unwrap(resolveTurn(state, supply(state, flat)), 'the turn');
  log.push(...out.events);
  return out.events;
};

const fireDamageTo = (events: readonly GameEvent[], who: CharacterId): number =>
  events
    .filter((event) => event.type === 'damage-taken' && event.id === who)
    .reduce((sum, event) => sum + (event.type === 'damage-taken' ? event.amount : 0), 0);

describe('SRD Web: "Any 5-foot Cube of webs exposed to fire burns away in 1 round"', () => {
  it('burns a creature that starts its turn in the fire', () => {
    const { log } = alight();
    // The weaver's turn ends and the goblin's begins, in the burning Cube.
    const boundary = turn(log, -40);
    expect(fireDamageTo(boundary, GOBLIN)).toBeGreaterThan(0);
    expect(fold('tinder', log).creatures[GOBLIN]!.vitals.hp).toBeLessThan(60);
  });

  it('is still web while it burns, and gone from the webs when the round is out', () => {
    const { log } = alight();
    turn(log, -40); // the goblin's turn begins: burnt, and caught by the webs
    const burning = fold('tinder', log);
    expect(terrainAt(burning, BURNING).costPerFoot).toBe(2);
    expect(hasCondition(burning.creatures[GOBLIN]!.conditions, 'restrained')).toBe(true);

    turn(log); // the goblin's turn ends: the ogre's begins
    turn(log); // the ogre's ends and the round wraps: the Cube has burned away
    const burnt = fold('tinder', log);
    expect(terrainAt(burnt, BURNING).costPerFoot).toBe(1);
    expect(obscurementAt(burnt, BURNING).degree).toBeNull();
    // "while in the webs": the goblin's one space is web no longer.
    expect(hasCondition(burnt.creatures[GOBLIN]!.conditions, 'restrained')).toBe(false);
    // And the rest of the webs stand.
    expect(terrainAt(burnt, UNTOUCHED).costPerFoot).toBe(2);
    expect(obscurementAt(burnt, UNTOUCHED).degree).toBe('lightly');
  });

  it('burns nobody once the Cube has burned away', () => {
    const { log } = alight();
    turn(log, -40);
    turn(log);
    turn(log); // the round wraps; the weaver's turn begins
    const next = turn(log); // the goblin's next turn begins in the ashes
    expect(fireDamageTo(next, GOBLIN)).toBe(0);
  });

  it('refuses a spell that is not flammable, a space the webs do not fill, and a casting not running', () => {
    const { log, castingId } = alight();
    const state = fold('tinder', log);
    expect(codeOf(exposeToFire(state, SRD_CONTENT, castingId, OUTSIDE))).toBe('outside_area');
    expect(codeOf(exposeToFire(state, SRD_CONTENT, 'cast:99', BURNING))).toBe('not_ongoing');

    const fogLog: GameEvent[] = [...ROOM];
    const fog = unwrap(
      resolveSpell(
        fold('tinder', fogLog),
        WEAVER,
        { spellId: 'fog-cloud', targets: [], at: BURNING, slotLevel: 1 },
        supply(fold('tinder', fogLog)),
      ),
      'the fog',
    );
    fogLog.push(...fog.events);
    expect(codeOf(exposeToFire(fold('tinder', fogLog), SRD_CONTENT, fog.castingId!, BURNING))).toBe(
      'not_flammable',
    );
  });

  it('holds the definition to dice, a type, a span and a running area', () => {
    const web = SRD_CONTENT.spell('web')!;
    expect(checkSpellDefinitionValue(web)).toEqual([]);
    const codes = (flammable: unknown, over: Record<string, unknown> = {}) =>
      checkSpellDefinitionValue({ ...web, ...over, flammable }).map((problem) => problem.code);
    expect(codes({ dice: 'lots', damageType: 'fire', burnsSeconds: 6 })).toContain('bad_dice');
    expect(codes({ dice: '2d4', damageType: 'heat', burnsSeconds: 6 })).toContain('unknown_damage_type');
    expect(codes({ dice: '2d4', damageType: 'fire', burnsSeconds: 0 })).toContain('bad_duration');
    const { area, ...arealess } = web;
    expect(area).toBeDefined();
    expect(
      checkSpellDefinitionValue({ ...arealess, flammable: web.flammable }).map((problem) => problem.code),
    ).toContain('nothing_to_burn');
  });

  it('refuses a Cube already burning', () => {
    const { log, castingId } = alight();
    expect(codeOf(exposeToFire(fold('tinder', log), SRD_CONTENT, castingId, BURNING))).toBe(
      'already_burning',
    );
  });
});
