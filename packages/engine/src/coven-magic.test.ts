/**
 * **A spell list three hags unlock** — W7-B12.
 *
 * SRD Green Hag, Coven Magic: "While within 30 feet of at least two hag
 * allies, the hag can cast one of the following spells, requiring no Material
 * components, using the spell's normal casting time, and using Intelligence as
 * the spellcasting ability (spell save DC 11): _Augury_, _Find Familiar_,
 * _Identify_, _Locate Object_, _Scrying_, or _Unseen Servant_. The hag must
 * finish a Long Rest before using this trait to cast that spell again." The
 * Night Hag prints DC 14 and the Sea Hag DC 11.
 *
 * A cast line printed as a **trait**: no heading prices the use, the spell's
 * own casting time stands, each spell on the menu is once between Long Rests,
 * and the door asks the gate — two allies of the printed kind, within the
 * printed reach — before anything is spent.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  type CharacterId,
  isErr,
  isNeedsContext,
  expect as unwrap,
} from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  advanceTime,
  castPrintedLine,
  declareCreatureSide,
  placeCreatureInScene,
  setScene,
} from './commands.js';
import { beginRest, endRest } from './rest.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster } from './monster.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string): CharacterId => asCharacterId(s);
const SEED = 'coven-magic';
const COVEN = 'Coven Magic';
const MOTHER = id('mother');
const SISTER = id('sister');
const AUNT = id('aunt');

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng(SEED) as Rng,
  content: SRD_CONTENT,
});

/**
 * Hags on the coven's side at stated distances east of the mother, plus any
 * other creatures named, outside any fight — most of the menu is a minute's
 * casting or more.
 */
function coven(
  others: readonly (readonly [CharacterId, string, number, string])[],
  block = 'green-hag',
  sided = true,
): GameState {
  let state = fold(SEED, []);
  const step = (events: readonly GameEvent[]): void => {
    state = events.reduce(applyEvent, state);
  };
  step(unwrap(addCreature(state, SRD_CONTENT, MOTHER, block), 'the mother').events);
  for (const [who, other] of others) {
    step(unwrap(addCreature(state, SRD_CONTENT, who, other), `${who}`).events);
  }
  step(unwrap(setScene(state, { width: 400, depth: 400, height: 40 }), 'scene'));
  step(unwrap(addSceneLandmark(state, 'the hut', { x: 100, y: 100, z: 0 }), 'landmark'));
  step(unwrap(placeCreatureInScene(state, MOTHER, { from: { landmark: 'the hut' }, feet: 0 }), 'mother'));
  if (sided) step(unwrap(declareCreatureSide(state, MOTHER, 'coven'), 'side'));
  others.forEach(([who, , feet, side], at) => {
    step(
      unwrap(
        placeCreatureInScene(state, who, { from: { creature: MOTHER }, feet, bearing: 90 * (at + 1) }),
        `${who} placed`,
      ),
    );
    step(unwrap(declareCreatureSide(state, who, side), `${who} side`));
  });
  return state;
}

const WHOLE: readonly (readonly [CharacterId, string, number, string])[] = [
  [SISTER, 'green-hag', 20, 'coven'],
  [AUNT, 'sea-hag', 25, 'coven'],
];

const cast = (state: GameState, spell: string, commandId = spell) =>
  castPrintedLine(state, MOTHER, { line: COVEN, spell, casting: {}, commandId }, supply());

describe('SRD Coven Magic: the gate, the DC and the rest per spell', () => {
  it('compiles the menu into routes only the line reaches, at the printed DC', () => {
    const hag = adaptMonster(SRD_CONTENT.monsterById('green-hag')!, MOTHER);
    const routes = hag.spellcasting!.granted.filter((grant) => grant.throughLine === COVEN);
    expect(routes.map((grant) => grant.spellId).sort()).toEqual([
      'augury',
      'find-familiar',
      'identify',
      'locate-object',
      'scrying',
      'unseen-servant',
    ]);
    for (const route of routes) {
      expect(route).toMatchObject({ ability: 'int', saveDc: 11, slotCasting: false });
      // The spell's own casting time, which a trait prints no heading to change.
      expect(route.castingTime).toBeUndefined();
      expect(route.freeCastPool).not.toBeNull();
    }
    // One use of each spell between Long Rests, each in a pool of its own.
    const pools = hag.pools.filter((pool) => routes.some((route) => route.freeCastPool === pool.key));
    expect(pools).toHaveLength(6);
    expect(pools.every((pool) => pool.max === 1 && pool.recovers === 'long-rest')).toBe(true);
    // The Night Hag prints DC 14.
    const night = adaptMonster(SRD_CONTENT.monsterById('night-hag')!, MOTHER);
    expect(night.spellcasting!.granted.find((grant) => grant.throughLine === COVEN)?.saveDc).toBe(14);
  });

  it('casts a spell off the menu within thirty feet of two hag allies, at DC 11', () => {
    const state = coven(WHOLE);
    const out = unwrap(cast(state, 'locate-object'), 'the coven casts');
    const after = out.events.reduce(applyEvent, state);
    expect(out.castingId).not.toBeNull();
    expect(after.ongoing[out.castingId!]!.numbers.saveDc).toBe(11);
    // "requiring no Material components" is read now rather than confessed:
    // the route waives the Material component, and the Verbal and Somatic
    // ones the spell prints are still made — so a Counterspell may answer it.
    // (E-L1)
    expect(out.unverified.join(' ')).not.toContain('components');
    const route = after.creatures[MOTHER]!.spellcasting.granted.find(
      (grant) => grant.spellId === 'locate-object',
    );
    expect(route?.waives).toEqual(['material']);
  });

  it('refuses the same spell again before a Long Rest, and not another off the menu', () => {
    let state = coven(WHOLE);
    state = unwrap(cast(state, 'locate-object'), 'first').events.reduce(applyEvent, state);
    const again = cast(state, 'locate-object', 'again');
    // The pipeline's own refusal of a free casting already spent: the pool the
    // route draws on is empty until the rest.
    expect(isErr(again) && again.code).toBe('no_free_casting');
    const other = castPrintedLine(
      state,
      MOTHER,
      { line: COVEN, spell: 'augury', casting: { targets: [MOTHER] }, commandId: 'augury' },
      supply(),
    );
    expect(isErr(other)).toBe(false);
  });

  it('gives the spell back when the hag finishes a Long Rest', () => {
    let state = coven(WHOLE);
    const first = unwrap(cast(state, 'locate-object'), 'first');
    state = first.events.reduce(applyEvent, state);
    state = [
      { type: 'spell-ended' as const, castingId: first.castingId!, on: null, reason: 'dismissed' as const },
    ].reduce(applyEvent, state);
    state = unwrap(beginRest(state, MOTHER, 'long'), 'rest').reduce(applyEvent, state);
    state = unwrap(advanceTime(state, 8 * 3600, 'the night'), 'night').reduce(applyEvent, state);
    state = unwrap(endRest(state, MOTHER), 'dawn').events.reduce(applyEvent, state);
    expect(isErr(cast(state, 'locate-object', 'after the rest'))).toBe(false);
  });

  it('refuses a coven of two', () => {
    const refused = cast(coven([[SISTER, 'green-hag', 20, 'coven']]), 'locate-object');
    expect(isErr(refused) && refused.code).toBe('coven_too_small');
  });

  it('counts no ally thirty-five feet away, no goblin, and no hag on the other side', () => {
    const far = cast(
      coven([
        [SISTER, 'green-hag', 20, 'coven'],
        [AUNT, 'sea-hag', 35, 'coven'],
      ]),
      'locate-object',
    );
    expect(isErr(far) && far.code).toBe('coven_too_small');

    const goblin = cast(
      coven([
        [SISTER, 'green-hag', 20, 'coven'],
        [id('goblin'), 'goblin-warrior', 10, 'coven'],
      ]),
      'locate-object',
    );
    expect(isErr(goblin) && goblin.code).toBe('coven_too_small');

    const rival = cast(
      coven([
        [SISTER, 'green-hag', 20, 'coven'],
        [AUNT, 'sea-hag', 25, 'rivals'],
      ]),
      'locate-object',
    );
    expect(isErr(rival) && rival.code).toBe('coven_too_small');
  });

  it('asks whose side the hag is on, where nobody has said, rather than counting no allies', () => {
    const asked = cast(coven(WHOLE, 'green-hag', false), 'locate-object');
    expect(isNeedsContext(asked)).toBe(true);
    expect(isErr(asked) && asked.code).toBe('undeclared_side');
  });

  it('asks where the coven stands, rather than refusing on a room nobody has described', () => {
    // No scene at all: three hags in a hut nobody has set.
    let bare = fold(SEED, []);
    for (const [who, block] of [
      [MOTHER, 'green-hag'],
      [SISTER, 'green-hag'],
      [AUNT, 'sea-hag'],
    ] as const) {
      bare = unwrap(addCreature(bare, SRD_CONTENT, who, block), who).events.reduce(applyEvent, bare);
      bare = unwrap(declareCreatureSide(bare, who, 'coven'), 'side').reduce(applyEvent, bare);
    }
    const noRoom = cast(bare, 'locate-object');
    expect(isNeedsContext(noRoom)).toBe(true);
    expect(isErr(noRoom) && noRoom.code).toBe('no_scene');

    // A scene, and one sister nobody has placed.
    let room = coven([[SISTER, 'green-hag', 20, 'coven']]);
    room = unwrap(addCreature(room, SRD_CONTENT, AUNT, 'sea-hag'), 'aunt').events.reduce(applyEvent, room);
    room = unwrap(declareCreatureSide(room, AUNT, 'coven'), 'side').reduce(applyEvent, room);
    const unplaced = cast(room, 'locate-object');
    expect(isNeedsContext(unplaced)).toBe(true);
    expect(isErr(unplaced) && unplaced.code).toBe('unplaced');
  });

  it('refuses a spell the menu does not print', () => {
    const wrong = cast(coven(WHOLE), 'fireball');
    expect(isErr(wrong) && wrong.code).toBe('spell_not_on_the_line');
  });
});
