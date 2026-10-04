/**
 * **SRD Ghost's Possession, the engine's facts of it** — M-MIND.
 *
 * > "_Charisma Saving Throw:_ DC 13, one Humanoid the ghost can see within 5
 * > feet. _Failure:_ The target is possessed by the ghost; the ghost
 * > disappears, and the target has the Incapacitated condition and loses
 * > control of its body. The ghost now controls the body, but the target
 * > retains awareness. The ghost can't be targeted by any attack, spell, or
 * > other effect, except ones that specifically target Undead. The ghost's
 * > game statistics are the same, except it uses the possessed target's Speed,
 * > as well as the target's Strength, Dexterity, and Constitution modifiers.
 * > The possession lasts until the body drops to 0 Hit Points or the ghost
 * > leaves as a Bonus Action. When the possession ends, the ghost appears in an
 * > unoccupied space within 5 feet of the target, and the target is immune to
 * > this ghost's Possession for 24 hours."
 *
 * The owner ruled a compulsion the table's to play and its condition, save and
 * repeats the engine's (2026-09-24). So the engine holds where the ghost is
 * (inside the body), what the body has (Incapacitated, for exactly as long as
 * the possession lasts), the two endings (the body's fall, which nobody
 * decides, and the ghost's own Bonus Action), where the ghost comes back and
 * the day's grace the ending buys. Who drives the body is filed for the table,
 * and these tests assert that split. And SRD Protection from Evil and Good's
 * "can't be possessed by … them" — a sentence the engine now has something to
 * refuse — is read.
 *
 * **No face is asserted.** A test that depends on the save searches a short
 * list of seeds for the branch it is about.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, type Result, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  forcePrintedSave,
  placeCreatureInScene,
  resolveSpell,
  resolveTurn,
  returnFromElsewhere,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { printedLineSource } from './monster.js';
import { printedElsewhereSource } from './elsewhere.js';
import { distanceBetween } from './positioning.js';
import { declaredCasting } from './spellcasting.js';
import type { CharacterSheet } from './character.js';
import { DM_DECIDES } from './spell-definitions.js';

const id = (s: string) => asCharacterId(s);
const GHOST = id('ghost');
const BODY = id('body');
const OTHER = id('other');
const LINE = 'Possession (Recharge 6)';
const POSSESSION = printedElsewhereSource(GHOST, LINE);
/** "an unoccupied space within 5 feet of the target", stated as a table would. */
const BESIDE = { to: { from: { creature: BODY }, feet: 5, bearing: 90 } } as const;

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const SEEDS = 'abcdefghijklmnopqrstuvwxyz'.split('').flatMap((a) => [a, `${a}2`, `${a}3`]);

class Table {
  readonly log: GameEvent[] = [];

  get state(): GameState {
    return fold('possession', this.log);
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
}

/** A warding cleric's sheet, crafted rather than created: what matters is the spell. */
const clericSheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 8 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple'],
});

/**
 * The ghost at a shrine, the body five feet off and somebody else ten feet
 * off; the ghost first in the order. The body is a stat block's Tough, or —
 * `warded` — a cleric who has cast Protection from Evil and Good on itself.
 */
const aHaunting = (body: 'tough' | 'warded' | 'unwarded-cleric' = 'tough'): Table => {
  const table = new Table();
  table.did('the ghost', (s) => addCreature(s, SRD_CONTENT, GHOST, 'ghost'));
  if (body === 'tough') table.did('the body', (s) => addCreature(s, SRD_CONTENT, BODY, 'tough'));
  else {
    table.log.push(
      {
        type: 'creature-added',
        id: BODY,
        name: 'body',
        sheet: clericSheet(),
        maxHp: 40,
        diesAtZero: false,
        creatureType: 'Humanoid',
        side: 'party',
      },
      {
        type: 'spellcasting-declared',
        id: BODY,
        spellcasting: declaredCasting({
          ability: 'wis',
          classId: 'cleric',
          prepared: ['protection-from-evil-and-good'],
        }),
      },
      {
        type: 'resource-pool-declared',
        id: BODY,
        pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
      },
    );
  }
  table.did('the other', (s) => addCreature(s, SRD_CONTENT, OTHER, 'tough'));
  table.do('the shrine', (s) => setScene(s, { width: 200, depth: 200, height: 20 }));
  table.do('the altar', (s) => addSceneLandmark(s, 'the altar', { x: 100, y: 100, z: 0 }));
  table.do('the ghost at the altar', (s) =>
    placeCreatureInScene(s, GHOST, { from: { landmark: 'the altar' }, feet: 0 }),
  );
  table.do('the body beside it', (s) =>
    placeCreatureInScene(s, BODY, { from: { creature: GHOST }, feet: 5, bearing: 0 }),
  );
  table.do('the other across the altar', (s) =>
    placeCreatureInScene(s, OTHER, { from: { creature: GHOST }, feet: 10, bearing: 180 }),
  );
  table.do("the body's side", (s) => declareCreatureSide(s, BODY, 'party'));
  table.do("the other's side", (s) => declareCreatureSide(s, OTHER, 'party'));
  table.do("the ghost's side", (s) => declareCreatureSide(s, GHOST, 'dead'));
  if (body !== 'tough') {
    // The ward, on the cleric's own willing self, before the fight.
    table.did('the ward', (s) =>
      resolveSpell(
        s,
        BODY,
        { spellId: 'protection-from-evil-and-good', targets: [BODY], willing: [BODY] },
        supply('ward'),
      ),
    );
    // A cleric who never cast it: the ward's grant taken off again, so the
    // only difference between the two tables is the ward itself.
    if (body === 'unwarded-cleric') {
      table.log.splice(
        table.log.findIndex((event) => event.type === 'spell-cast'),
        table.log.length,
      );
    }
  }
  table.do('the order', (s) =>
    beginCombat(s, [
      { id: GHOST, initiative: 20, speed: 30 },
      { id: BODY, initiative: 10, speed: 30 },
      { id: OTHER, initiative: 5, speed: 30 },
    ]),
  );
  return table;
};

const failedOn = (events: readonly GameEvent[]): boolean =>
  events.some(
    (event) =>
      event.type === 'roll-recorded' &&
      event.who === BODY &&
      event.label === `Charisma save vs ${LINE}` &&
      event.outcome !== 'resisted',
  );

/** A haunting in which the ghost has just possessed the body, on a seed where the save failed. */
const possessed = (body: 'tough' | 'warded' | 'unwarded-cleric' = 'tough') => {
  for (const seed of SEEDS) {
    const table = aHaunting(body);
    const out = forcePrintedSave(
      table.state,
      GHOST,
      { line: LINE, targets: [BODY], commandId: `possess-${seed}` },
      supply(seed),
    );
    if (!out.ok || !failedOn(out.value.events)) continue;
    table.log.push(...out.value.events);
    return { table, done: out.value };
  }
  throw new Error('no seed in the list failed the save');
};

describe('a failed save: the ghost inside the body, and the body Incapacitated', () => {
  it('takes the ghost out of the scene into the body, and hangs the Incapacitated under the possession', () => {
    const { table, done } = possessed();
    const state = table.state;
    expect(state.creatures[GHOST]!.elsewhere).toMatchObject({
      kind: 'inside',
      host: BODY,
      source: POSSESSION,
      returns: { within: 5, near: BODY },
      possesses: { leavesAs: 'bonus-action', immunity: { line: LINE, seconds: 86400 } },
    });
    expect(state.creatures[BODY]!.conditions.conditions).toEqual(['incapacitated']);
    expect(state.creatures[BODY]!.conditions.instances.map((one) => one.source)).toEqual([POSSESSION]);
    expect(done.outcomes[0]?.conditions).toEqual(['incapacitated']);
    // "the ghost disappears": no ruler reaches it.
    const apart = distanceBetween(state.scene!, OTHER, GHOST);
    expect(isErr(apart) && apart.code).toBe('not_here');
    // Who drives the body is the table's, in the book's words.
    expect(done.unverified.filter((line) => line.includes(DM_DECIDES))).toHaveLength(3);
  });
});

describe('the ghost leaves as a Bonus Action', () => {
  it('spends its Bonus Action, appears within 5 feet of the body, and lifts the Incapacitated', () => {
    const { table } = possessed();
    const out = unwrap(returnFromElsewhere(table.state, GHOST, BESIDE), 'the ghost leaves');
    expect(out.events.some((event) => event.type === 'bonus-action-spent' && event.id === GHOST)).toBe(true);
    const state = out.events.reduce(applyEvent, table.state);
    expect(state.creatures[GHOST]!.elsewhere).toBeNull();
    expect(unwrap(distanceBetween(state.scene!, GHOST, BODY), 'apart')).toBeLessThanOrEqual(5);
    expect(state.creatures[BODY]!.conditions.conditions).toEqual([]);
    expect(state.combat!.budgets[GHOST]!.bonusAction).toBe(false);
    // "the target is immune to this ghost's Possession for 24 hours".
    expect(state.creatures[BODY]!.lineImmunities.map((one) => one.source)).toEqual([
      printedLineSource(GHOST, LINE),
    ]);
  });

  it("may not leave on somebody else's turn, and leaves nothing behind when refused", () => {
    const { table } = possessed();
    table.did('the ghost ends its turn', (s) => resolveTurn(s));
    const refused = returnFromElsewhere(table.state, GHOST, BESIDE);
    expect(isErr(refused)).toBe(true);
    expect(table.state.creatures[GHOST]!.elsewhere).not.toBeNull();
    expect(table.state.creatures[BODY]!.conditions.conditions).toEqual(['incapacitated']);
  });
});

describe('the body drops to 0 Hit Points', () => {
  const felled = () => {
    const { table } = possessed();
    const hp = table.state.creatures[BODY]!.vitals.hp;
    table.log.push({ type: 'damage-taken', id: BODY, amount: hp, source: 'the other' });
    return table;
  };

  it('ends the possession with nobody deciding, and lifts what it hung', () => {
    const state = felled().state;
    expect(state.creatures[GHOST]!.elsewhere?.possesses?.ended).toBe(true);
    expect(
      state.creatures[BODY]!.conditions.instances.filter((one) => one.source === POSSESSION),
    ).toEqual([]);
  });

  it('owes the ghost its return before the turn moves on, and the return costs nothing', () => {
    const table = felled();
    const stuck = resolveTurn(table.state, supply('a'));
    expect(isErr(stuck) && stuck.code).toBe('elsewhere_stranded');

    const out = unwrap(returnFromElsewhere(table.state, GHOST, BESIDE), 'the ghost appears');
    expect(out.events.some((event) => event.type === 'bonus-action-spent')).toBe(false);
    const state = out.events.reduce(applyEvent, table.state);
    expect(state.creatures[GHOST]!.elsewhere).toBeNull();
    expect(unwrap(distanceBetween(state.scene!, GHOST, BODY), 'apart')).toBeLessThanOrEqual(5);
    expect(state.creatures[BODY]!.lineImmunities.map((one) => one.source)).toEqual([
      printedLineSource(GHOST, LINE),
    ]);
  });
});

describe("Protection from Evil and Good: the target can't be possessed by them", () => {
  it('a warded cleric who fails the save is not possessed, and is told why', () => {
    const { table, done } = possessed('warded');
    const state = table.state;
    expect(state.creatures[GHOST]!.elsewhere).toBeNull();
    expect(state.creatures[BODY]!.conditions.conditions).toEqual([]);
    expect(done.unverified.join(' ')).toContain('warded against being possessed');
  });

  it('the same cleric unwarded is possessed', () => {
    const { table } = possessed('unwarded-cleric');
    expect(table.state.creatures[GHOST]!.elsewhere).toMatchObject({ kind: 'inside', host: BODY });
  });
});
