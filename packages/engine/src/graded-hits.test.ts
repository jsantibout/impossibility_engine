/**
 * A hit that hands its failure to the printed-save reader.
 *
 * SRD Cockatrice's Petrifying Bite: "_Hit:_ 3 (1d4 + 1) Piercing damage. If the
 * target is a creature, it is subjected to the following effect.
 * _Constitution Saving Throw:_ DC 11. _First Failure:_ The target has the
 * Restrained condition. The target repeats the save at the end of its next turn
 * if it is still Restrained, ending the effect on itself on a success. _Second
 * Failure:_ The target has the Petrified condition, instead of the Restrained
 * condition, for 24 hours." SRD Homunculus's Bite prints the margin rung:
 * "_Failure:_ Poisoned until the end of the homunculus's next turn. _Failure by
 * 5 or More:_ Poisoned for 1 minute. While Poisoned, the target has the
 * Unconscious condition, which ends early if the target takes any damage."
 *
 * **One reader, reached through a door.** A hit's rider compiles to one effect
 * list against one DC, and these are two lists off one save — the printed-save
 * vocabulary's own shape since the Gorgon's Petrifying Breath was read. So the
 * parser lifts the template out of the rider at ingest and the swing hands it
 * to `forcePrintedSaveOn`, which is the reader a DM's printed save goes
 * through. Nothing here grades a failure twice.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  type CharacterId,
  type ConditionName,
  type Result,
  expect as unwrap,
} from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  placeCreatureInScene,
  resolveAttack,
  resolveTurn,
  setScene,
} from './commands.js';
import { hasCondition } from './conditions.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';

const BIRD = asCharacterId('cocky');
const HOMUNCULUS = asCharacterId('homer');
const PREY = asCharacterId('bren');

class Table {
  constructor(private readonly seed: string) {}
  private readonly log: GameEvent[] = [];
  get state(): GameState {
    return fold(this.seed, this.log);
  }
  do(step: string, produce: (state: GameState) => Result<readonly GameEvent[]>): GameState {
    this.log.push(...unwrap(produce(this.state), step));
    return this.state;
  }
  did(
    step: string,
    produce: (state: GameState) => Result<{ readonly events: readonly GameEvent[] }>,
  ): GameState {
    this.log.push(...unwrap(produce(this.state), step).events);
    return this.state;
  }
  supply(): { issuer: ReturnType<typeof createRollIssuer>; rng: Rng; content: typeof SRD_CONTENT } {
    return { issuer: createRollIssuer('r'), rng: createRng(this.seed) as Rng, content: SRD_CONTENT };
  }
}

/** A biter and its prey, five feet apart, with the biter's turn up. */
function ring(seed: string, biter: CharacterId, block: string): Table {
  const table = new Table(seed);
  table.did('the biter arrives', (s) => addCreature(s, SRD_CONTENT, biter, block));
  table.did('the prey arrives', (s) => addCreature(s, SRD_CONTENT, PREY, 'commoner'));
  table.do('the yard', (s) => setScene(s, { width: 60, depth: 40, height: 20 }));
  table.do('the post', (s) => addSceneLandmark(s, 'the post', { x: 10, y: 10, z: 0 }));
  table.do('the biter stands', (s) =>
    placeCreatureInScene(s, biter, { from: { landmark: 'the post' }, feet: 5, bearing: 90 }),
  );
  table.do('the prey stands', (s) =>
    placeCreatureInScene(s, PREY, { from: { landmark: 'the post' }, feet: 10, bearing: 90 }),
  );
  table.do('the biter’s side', (s) => declareCreatureSide(s, biter, 'wild'));
  table.do('the prey’s side', (s) => declareCreatureSide(s, PREY, 'party'));
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: biter, initiative: 20, speed: 30 },
      { id: PREY, initiative: 1, speed: 30 },
    ]),
  );
  return table;
}

const has = (table: Table, who: CharacterId, condition: ConditionName): boolean =>
  hasCondition(table.state.creatures[who]!.conditions, condition);

/** Bite until the save is failed the way the caller wants, seed by seed. */
function biteUntil(
  block: string,
  line: string,
  biter: CharacterId,
  wanted: (table: Table, saves: readonly GameEvent[]) => boolean,
): Table {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const table = ring(`graded-${block}-${attempt}`, biter, block);
    const swing = resolveAttack(
      table.state,
      biter,
      { target: PREY, weapon: null, action: line },
      table.supply(),
    );
    if (!swing.ok) continue;
    const events = swing.value.events;
    table.did('the bite', () => swing);
    const saves = events.filter(
      (event) => event.type === 'roll-recorded' && / save vs /.test(event.label),
    );
    if (saves.length === 0) continue;
    if (wanted(table, saves)) return table;
  }
  throw new Error(`no ${block} bite reached the outcome the test wanted`);
}

const saveTotalOf = (events: readonly GameEvent[]): number =>
  (events[0] as unknown as { readonly total: number }).total;

describe('a cockatrice’s bite grades its failure', () => {
  const LINE = SRD_CONTENT.monsterById('cockatrice')!.actions.find((one) =>
    one.name.startsWith('Petrifying'),
  )!.name;

  it('reads the template out of the rider and leaves no prose behind', () => {
    const line = SRD_CONTENT.monsterById('cockatrice')!.actions.find(
      (one) => one.name === LINE,
    )!;
    expect(line.attack!.rider).toBeNull();
    expect(line.attack!.riderSave).toEqual({
      ability: 'con',
      dc: 11,
      targets: 'a creature',
      onSuccess: 'none',
      onFailure: [
        {
          kind: 'condition',
          condition: 'restrained',
          repeats: {
            at: 'end',
            of: 'target',
            onFailure: { condition: 'petrified', lasts: { kind: 'seconds', seconds: 86400 } },
          },
        },
      ],
    });
  });

  it('restrains on the first failure and offers the repeat the line prints', () => {
    const table = biteUntil('cockatrice', LINE, BIRD, (t) => has(t, PREY, 'restrained'));
    expect(has(table, PREY, 'restrained')).toBe(true);
    expect(has(table, PREY, 'petrified')).toBe(false);
  });

  /**
   * **The second rung, and the save that avoids it.** The repeat falls due at
   * the end of the target's next turn, is raised by the boundary and rolled
   * there — so this winds the fight forward and asks what the two answers
   * were. Both are looked for across seeds, because a test that only ever saw
   * one of them would pass against a rule that could only produce that one.
   */
  it('petrifies on the second failure and lifts the Restrained on a made save', () => {
    let petrified = 0;
    let freed = 0;
    for (let attempt = 0; attempt < 40 && (petrified === 0 || freed === 0); attempt += 1) {
      const table = ring(`repeat-${attempt}`, BIRD, 'cockatrice');
      const swing = resolveAttack(
        table.state,
        BIRD,
        { target: PREY, weapon: null, action: LINE },
        table.supply(),
      );
      if (!swing.ok) continue;
      table.did('the bite', () => swing);
      if (!has(table, PREY, 'restrained')) continue;

      for (let guard = 0; guard < 4; guard += 1) {
        const turned = resolveTurn(table.state, table.supply());
        if (!turned.ok) break;
        table.did('the boundary', () => turned);
        if (!has(table, PREY, 'restrained')) break;
      }
      if (has(table, PREY, 'petrified')) {
        // The deeper condition replaced the shallow one rather than joining it.
        expect(has(table, PREY, 'restrained')).toBe(false);
        petrified += 1;
      } else {
        freed += 1;
      }
    }
    expect(petrified).toBeGreaterThan(0);
    expect(freed).toBeGreaterThan(0);
  });
});

describe('a homunculus’s bite grades by the margin', () => {
  it('reads the margin rung and the sleep a blow ends', () => {
    const line = SRD_CONTENT.monsterById('homunculus')!.actions.find(
      (one) => one.name === 'Bite',
    )!;
    expect(line.attack!.rider).toBeNull();
    expect(line.attack!.riderSave!.onFailureBy).toEqual({
      by: 5,
      effects: [
        {
          kind: 'condition',
          condition: 'poisoned',
          lasts: { kind: 'seconds', seconds: 60 },
          implies: ['unconscious'],
          endsOnDamage: ['unconscious'],
        },
      ],
    });
    // The plain failure is the shallower rung, and it is not the deeper one.
    expect(line.attack!.riderSave!.onFailure).toEqual([
      {
        kind: 'condition',
        condition: 'poisoned',
        lasts: { kind: 'turn', moment: 'end', of: 'source' },
      },
    ]);
  });

  it('poisons on a plain failure and adds the sleep on a failure by 5', () => {
    const shallow = biteUntil(
      'homunculus',
      'Bite',
      HOMUNCULUS,
      (t, saves) => has(t, PREY, 'poisoned') && saveTotalOf(saves) > 12 - 5,
    );
    expect(has(shallow, PREY, 'poisoned')).toBe(true);
    expect(has(shallow, PREY, 'unconscious')).toBe(false);

    const deep = biteUntil(
      'homunculus',
      'Bite',
      HOMUNCULUS,
      (t, saves) => has(t, PREY, 'poisoned') && saveTotalOf(saves) <= 12 - 5,
    );
    expect(has(deep, PREY, 'unconscious')).toBe(true);
  });
});
