/**
 * **A form that hits back, and two small widenings** — W7-B12.
 *
 * SRD Black Pudding and SRD Gray Ooze, Corrosive Form: "A creature that hits
 * the pudding with a melee attack roll takes 4 (1d8) Acid damage. … Any
 * nonmagical weapon takes a cumulative −1 penalty to attack rolls immediately
 * after dealing damage to the pudding and coming into contact with it. The
 * weapon is destroyed if the penalty reaches −5."
 *
 * SRD Giant Boar, Bloodied Fury: "The boar has Advantage on melee attack rolls
 * while it is Bloodied." SRD Swarm of Insects, Spider Climb: "If the swarm has
 * a Climb Speed, the swarm can climb difficult surfaces, including along
 * ceilings, without needing to make an ability check."
 *
 * The first is a defence nobody elects, consulted where SRD Fire Shield is; the
 * other two are a narrowing and a gate on kinds that already had readers.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  resolveMove,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { rollModesFor } from './standing.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'corrosive-form';

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * Stat blocks in a row five feet apart, the first on the monsters' side and the
 * rest on the party's, in a fight in the order given.
 */
function row(blocks: readonly (readonly [CharacterId, string])[]): GameEvent[] {
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
  blocks.forEach(([who], at) => {
    step(`${who} takes a side`, () =>
      declareCreatureSide(state(), who, at === 0 ? 'monsters' : 'party'),
    );
    step(`${who} is placed`, () =>
      placeCreatureInScene(state(), who, {
        from: { landmark: 'the stone' },
        feet: at * 10,
        bearing: 90,
      }),
    );
  });
  log.push({
    type: 'combat-started',
    combatants: blocks.map(([who], at) => ({ id: who, initiative: 20 - at, speed: 30 })),
  });
  return log;
}

const at = (log: readonly GameEvent[]): GameState => fold(SEED, log);

describe('SRD Giant Boar, Bloodied Fury: Advantage on melee attack rolls while Bloodied', () => {
  const BOAR = id('boar');
  const GOBLIN = id('goblin');

  /** The boar, one point past half its Hit Points. */
  const bloodiedBoar = (): GameEvent[] => {
    const log = row([
      [BOAR, 'giant-boar'],
      [GOBLIN, 'goblin-warrior'],
    ]);
    const boar = at(log).creatures[BOAR]!;
    log.push({ type: 'damage-taken', id: BOAR, amount: Math.ceil(boar.vitals.hpMax / 2) });
    return log;
  };

  const modes = (state: GameState, melee: boolean | undefined): readonly string[] =>
    rollModesFor(state, {
      family: 'attack',
      roller: BOAR,
      against: GOBLIN,
      ...(melee === undefined ? {} : { melee }),
    }).modes.map((mode) => mode.source);

  it('gives the Bloodied boar Advantage on a melee attack roll', () => {
    expect(modes(at(bloodiedBoar()), true)).toEqual(['Bloodied Fury']);
  });

  it('gives it nothing on a ranged one, and nothing on a roll nobody said was either', () => {
    expect(modes(at(bloodiedBoar()), false)).toEqual([]);
    // Silence is a miss, which is the reading every narrowing axis takes.
    expect(modes(at(bloodiedBoar()), undefined)).toEqual([]);
  });

  it('gives it nothing while it has more than half its Hit Points', () => {
    const log = row([
      [BOAR, 'giant-boar'],
      [GOBLIN, 'goblin-warrior'],
    ]);
    expect(modes(at(log), true)).toEqual([]);
  });

  it('swings its Gore with the Advantage, because the attack path says the swing is melee', () => {
    const log = bloodiedBoar();
    const swung = unwrap(
      resolveAttack(at(log), BOAR, { target: GOBLIN, weapon: null, action: 'Gore' }, supply()),
      'the gore',
    );
    expect(swung.attack?.mode).toBe('advantage');
  });

  it('leaves the boar’s own sentence reaching every attack roll it makes', () => {
    const log = row([
      [id('small'), 'boar'],
      [GOBLIN, 'goblin-warrior'],
    ]);
    const small = at(log).creatures[id('small')]!;
    log.push({ type: 'damage-taken', id: id('small'), amount: Math.ceil(small.vitals.hpMax / 2) });
    expect(
      rollModesFor(at(log), { family: 'attack', roller: id('small'), against: GOBLIN, melee: false })
        .modes.map((mode) => mode.source),
    ).toEqual(['Bloodied Fury']);
  });
});

describe('SRD Swarm of Insects, Spider Climb: a gate on the climb that costs no check', () => {
  const SWARM = id('swarm');

  const climb = (log: readonly GameEvent[]) =>
    unwrap(
      resolveMove(
        at(log),
        SWARM,
        { placement: { from: { landmark: 'the stone' }, feet: 10, bearing: 270 }, mode: 'climb' },
        supply(),
      ),
      'the climb',
    );

  const asked = (log: readonly GameEvent[]): boolean =>
    climb(log).unverified.some((note) => note.includes('Athletics'));

  it('still hands a swarm with no Climb Speed the check its sentence is gated on', () => {
    expect(asked(row([[SWARM, 'swarm-of-insects']]))).toBe(true);
  });

  it('asks nothing of the same swarm once it has a Climb Speed', () => {
    const log = [
      ...row([[SWARM, 'swarm-of-insects']]),
      {
        type: 'speed-modifier-granted' as const,
        id: SWARM,
        modifier: { source: 'the test', change: 'add' as const, feet: 20, mode: 'climb' as const },
      },
    ];
    expect(asked(log)).toBe(false);
  });

  it('leaves an ungated Spider Climb asking nothing, Climb Speed or not', () => {
    // SRD Vampire Spawn prints the trait and no Climb Speed.
    const log = row([[id('spawn'), 'vampire-spawn']]);
    const climbed = unwrap(
      resolveMove(
        at(log),
        id('spawn'),
        { placement: { from: { landmark: 'the stone' }, feet: 10, bearing: 270 }, mode: 'climb' },
        supply(),
      ),
      'the climb',
    );
    expect(climbed.unverified.some((note) => note.includes('Athletics'))).toBe(false);
  });
});
