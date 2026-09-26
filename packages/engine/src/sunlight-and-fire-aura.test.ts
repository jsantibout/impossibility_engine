/**
 * **A sun read at the turn's start, and an aura that burns** — W7-B12.
 *
 * SRD Vampire Spawn, Sunlight: "The vampire takes 20 Radiant damage if it
 * starts its turn in sunlight. While in sunlight, it has Disadvantage on attack
 * rolls and ability checks."
 *
 * SRD Fire Elemental, Fire Aura: "At the end of each of the elemental's turns,
 * each creature in a 10-foot Emanation originating from the elemental takes 5
 * (1d10) Fire damage. Creatures and flammable objects in the Emanation start
 * burning."
 *
 * The first sentence of each is a moment the boundary already settles for
 * somebody else — a payout, an aura — read now against the block's own trait;
 * the second is a rule the engine already held (the `in-sunlight` mode, the
 * glossary's Burning) reached by one more sentence.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  declareCreatureSide,
  placeCreatureInScene,
  resolveTurn,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { caughtIn } from './hazards.js';
import { createRollIssuer } from './rolls.js';
import { rollModesFor } from './standing.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'sunlight-and-fire-aura';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * Stat blocks along a line east of a stone at the stated distances, the first
 * on the monsters' side, the rest on the party's, fighting in the order given.
 */
function line(blocks: readonly (readonly [CharacterId, string, number])[]): GameEvent[] {
  const log: GameEvent[] = [];
  const state = (): GameState => fold(SEED, log);
  const step = (what: string, produce: () => ReturnType<typeof declareCreatureSide>): void => {
    log.push(...unwrap(produce(), what));
  };
  for (const [who, block] of blocks) {
    log.push(...unwrap(addCreature(state(), SRD_CONTENT, who, block), block).events);
  }
  step('the field', () => setScene(state(), { width: 400, depth: 400, height: 200 }));
  step('a stone', () => addSceneLandmark(state(), 'the stone', { x: 100, y: 100, z: 0 }));
  blocks.forEach(([who, , feet], at) => {
    step(`${who} takes a side`, () =>
      declareCreatureSide(state(), who, at === 0 ? 'monsters' : 'party'),
    );
    step(`${who} is placed`, () =>
      placeCreatureInScene(state(), who, { from: { landmark: 'the stone' }, feet, bearing: 90 }),
    );
  });
  log.push({
    type: 'combat-started',
    combatants: blocks.map(([who], at) => ({ id: who, initiative: 20 - at, speed: 30 })),
  });
  return log;
}

const at = (log: readonly GameEvent[]): GameState => fold(SEED, log);

/** The open sky over everything within twenty feet of a creature. */
const sunOver = (who: CharacterId): GameEvent => ({
  type: 'light-declared',
  patch: 'the open sky',
  region: { origin: { creature: who }, shape: { kind: 'sphere', radius: 20 } },
  level: 'bright',
  sunlight: true,
});

describe('SRD Vampire Spawn, Sunlight: the burn at the start of its turn', () => {
  const SPAWN = id('spawn');
  const GOBLIN = id('goblin');

  /** The goblin's turn running, the spawn's next. */
  const noon = (sunlit: boolean): GameEvent[] => {
    const log = line([
      [GOBLIN, 'goblin-warrior', 10],
      [SPAWN, 'vampire-spawn', 0],
    ]);
    // The goblin first, so ending its turn begins the spawn's.
    log.push(...(sunlit ? [sunOver(SPAWN)] : []));
    return log;
  };

  const lost = (log: readonly GameEvent[]): number => {
    const before = at(log);
    const turned = unwrap(resolveTurn(before, supply()), 'the turn');
    const after = fold(SEED, [...log, ...turned.events]);
    return before.creatures[SPAWN]!.vitals.hp - after.creatures[SPAWN]!.vitals.hp;
  };

  it('takes the 20 Radiant the sentence prints when its turn begins in sunlight', () => {
    expect(lost(noon(true))).toBe(20);
  });

  it('takes nothing in the shade, and nothing where nobody has said what the light is', () => {
    expect(lost(noon(false))).toBe(0);
  });

  it('attacks at Disadvantage while it stands there, which is the second sentence', () => {
    const modes = rollModesFor(at(noon(true)), {
      family: 'attack',
      roller: SPAWN,
      against: GOBLIN,
    }).modes.map((mode) => mode.source);
    expect(modes).toEqual(['Sunlight']);
  });

  it('refuses to advance with no generator for the burn the sun owes', () => {
    const refused = resolveTurn(at(noon(true)), undefined);
    expect(isErr(refused) && refused.code).toBe('boundary_damage_owed');
  });
});

describe('SRD Fire Elemental, Fire Aura: the damage, and the burning it lights', () => {
  const ELEMENTAL = id('elemental');
  const GOBLIN = id('goblin');
  const FAR = id('far');

  /** The elemental's turn running, a goblin ten feet off and another thirty. */
  const around = (): GameEvent[] =>
    line([
      [ELEMENTAL, 'fire-elemental', 0],
      [GOBLIN, 'goblin-warrior', 15],
      [FAR, 'goblin-warrior', 40],
    ]);

  it('burns the goblin ten feet off and sets it burning, and leaves the far one alone', () => {
    const log = around();
    const before = at(log);
    const turned = unwrap(resolveTurn(before, supply()), 'the turn');
    const after = fold(SEED, [...log, ...turned.events]);

    expect(after.creatures[GOBLIN]!.vitals.hp).toBeLessThan(before.creatures[GOBLIN]!.vitals.hp);
    expect(caughtIn(after, GOBLIN, 'burning')).toBe(true);
    expect(after.creatures[FAR]!.vitals.hp).toBe(before.creatures[FAR]!.vitals.hp);
    expect(caughtIn(after, FAR, 'burning')).toBe(false);
    // An Emanation "ignores the creature it originates from".
    expect(caughtIn(after, ELEMENTAL, 'burning')).toBe(false);
  });

  it('says the flammable objects in the Emanation are the table’s', () => {
    const turned = unwrap(resolveTurn(at(around()), supply()), 'the turn');
    expect(turned.unverified.some((note) => note.includes('flammable objects'))).toBe(true);
  });

  it('tells the table at arrival which half of the burning sentence is its own', () => {
    const arrived = unwrap(addCreature(fold(SEED, []), SRD_CONTENT, ELEMENTAL, 'fire-elemental'), 'arrival');
    const note = arrived.unverified.find((line) => line.includes('flammable objects'));
    expect(note).toContain('the engine lights the creatures');
    expect(note).not.toContain('the engine does not apply that');
  });

  it('lights nobody where the aura prints no burning — the azer’s', () => {
    const log = line([
      [ELEMENTAL, 'azer-sentinel', 0],
      [GOBLIN, 'goblin-warrior', 5],
    ]);
    const turned = unwrap(resolveTurn(at(log), supply(), { burns: [GOBLIN] }), 'the turn');
    expect(caughtIn(fold(SEED, [...log, ...turned.events]), GOBLIN, 'burning')).toBe(false);
  });
});
