import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { positionOf } from './positioning.js';
import { elsewhereOf } from './elsewhere.js';
import {
  addCreature,
  dismissKeptSummons,
  recallKeptSummons,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
  returnFromElsewhere,
  summonCreature,
  takePrintedPlaneShift,
} from './commands.js';

/**
 * SRD Magic Circle's other road in:
 *
 * > "The creature can't willingly enter the Cylinder by nonmagical means. If
 * > the creature tries to use teleportation or **interplanar travel** to do
 * > so, it must first succeed on a Charisma saving throw."
 *
 * The teleport half was built with the circle; the engine holds one plane
 * besides this one — the Ethereal — and every road back from it arrives in the
 * scene at a space a caller names. So each of those roads asks the barriers the
 * teleport asks, of the space the creature arrives in, and rolls the save the
 * circle pins before the creature stands there. Reversed, the circle asks the
 * same of a creature leaving the Cylinder for the Ethereal Plane.
 *
 * An extradimensional space (a Rope Trick, a familiar's pocket) and another
 * creature's insides are not planes, and nothing is asked of a creature coming
 * back from one.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const FIEND = id('fiend');
const HUMAN = id('human');
const GHOST = id('ghost');
const IMP = id('imp');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 16, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, creatureType: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 400,
  diesAtZero: false,
  creatureType,
  side: who === CLERIC ? 'party' : 'foes',
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

const LANDMARKS = {
  'the altar': { x: 200, y: 200, z: 0 },
  'inside east': { x: 205, y: 200, z: 0 },
  'inside west': { x: 195, y: 200, z: 0 },
  'outside east': { x: 215, y: 200, z: 0 },
  'far east': { x: 225, y: 200, z: 0 },
} as const;
type Landmark = keyof typeof LANDMARKS;

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('planes') : restoreRng(state.rng)) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

const unwrapped = <T,>(result: Result<T>, step: string): T => unwrap(result, step);
const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

class Table {
  readonly log: GameEvent[];

  constructor() {
    this.log = [
      added(CLERIC, 'Humanoid'),
      added(FIEND, 'Fiend'),
      added(HUMAN, 'Humanoid'),
      {
        type: 'spellcasting-declared',
        id: CLERIC,
        spellcasting: declaredCasting({ ability: 'wis', classId: 'cleric', prepared: ['magic-circle'] }),
      },
      ...slots(CLERIC),
      { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
      ...Object.entries(LANDMARKS).map(([name, at]): GameEvent => ({ type: 'landmark-added', name, at })),
      { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the altar' }, feet: 0 } },
      { type: 'creature-placed', id: FIEND, placement: { from: { landmark: 'outside east' }, feet: 0 } },
      { type: 'creature-placed', id: HUMAN, placement: { from: { landmark: 'far east' }, feet: 0 } },
    ];
  }

  get state(): GameState {
    return fold('planes', this.log);
  }

  push(more: readonly GameEvent[]): this {
    this.log.push(...more);
    return this;
  }

  /** The circle at the altar: declared, a minute on the clock, settled. */
  draw(option: 'inward' | 'outward', types: readonly string[]): this {
    const declared = unwrapped(
      resolveSpell(
        this.state,
        CLERIC,
        { spellId: 'magic-circle', targets: [], at: LANDMARKS['the altar'], types, option },
        supply(this.state),
      ),
      'declare the circle',
    );
    this.push(declared.events);
    this.push([{ type: 'time-advanced', seconds: 60, reason: 'the rite' }]);
    this.push(unwrapped(resolveDeclaredCast(this.state, declared.castingId!, supply(this.state)), 'the circle').events);
    return this;
  }

  /** A creature on the Ethereal Plane under a Blink that has already ended, so the way back is open. */
  etherealised(who: CharacterId): this {
    return this.push([
      { type: 'creature-sent-elsewhere', id: who, kind: 'ethereal', source: 'Blink#cast:90', returns: { within: 10 } },
    ]);
  }

  back(who: CharacterId, to: Landmark, flat?: number, withSupply = true) {
    const state = this.state;
    return returnFromElsewhere(
      state,
      who,
      { to: { from: { landmark: to }, feet: 0 } },
      withSupply ? supply(state, flat) : undefined,
    );
  }
}

const saves = (events: readonly GameEvent[]) =>
  events.filter((event) => event.type === 'roll-recorded' && /Charisma save vs Magic Circle/.test(event.label));

describe('SRD Magic Circle: a return from the Ethereal Plane into the Cylinder', () => {
  it('rolls the Charisma save first, and on a success the fiend stands inside', () => {
    const table = new Table().draw('inward', ['Fiend']).etherealised(FIEND);
    const out = unwrapped(table.back(FIEND, 'inside east', 30), 'the return');
    expect(saves(out.events)).toHaveLength(1);
    expect(out.at).toEqual(LANDMARKS['inside east']);
    const state = table.push(out.events).state;
    expect(positionOf(state.scene!, FIEND)).toEqual(LANDMARKS['inside east']);
    expect(elsewhereOf(state, FIEND)).toBeNull();
  });

  it('on a failure keeps the fiend on the Ethereal Plane, refused that space and free to be sent again', () => {
    const table = new Table().draw('inward', ['Fiend']).etherealised(FIEND);
    const out = unwrapped(table.back(FIEND, 'inside east', -30), 'the return');
    expect(saves(out.events)).toHaveLength(1);
    expect(out.at).toBeNull();
    expect(out.events.some((event) => event.type === 'creature-returned')).toBe(false);
    const state = table.push(out.events).state;
    expect(elsewhereOf(state, FIEND)?.kind).toBe('ethereal');
    // Sent again, to a space outside the Cylinder, it comes back unasked.
    const outside = unwrapped(
      returnFromElsewhere(state, FIEND, { to: { from: { landmark: 'outside east' }, feet: 0 }, commandId: 'again' }, supply(state)),
      'the second return',
    );
    expect(saves(outside.events)).toHaveLength(0);
    expect(outside.at).toEqual(LANDMARKS['outside east']);
  });

  it('asks nothing of a return that lands outside it', () => {
    const table = new Table().draw('inward', ['Fiend']).etherealised(FIEND);
    const out = unwrapped(table.back(FIEND, 'outside east'), 'the return');
    expect(saves(out.events)).toHaveLength(0);
    expect(out.at).toEqual(LANDMARKS['outside east']);
  });

  it('asks nothing of a creature the circle was not drawn against', () => {
    const table = new Table().draw('inward', ['Fiend']).etherealised(HUMAN);
    const out = unwrapped(table.back(HUMAN, 'outside east'), 'the return');
    expect(saves(out.events)).toHaveLength(0);
    const inside = unwrapped(new Table().draw('inward', ['Fiend']).etherealised(HUMAN).back(HUMAN, 'far east'), 'the return');
    expect(saves(inside.events)).toHaveLength(0);
  });

  it('asks for a generator where the save is owed and none was handed over', () => {
    const table = new Table().draw('inward', ['Fiend']).etherealised(FIEND);
    expect(codeOf(table.back(FIEND, 'inside east', undefined, false))).toBe('crossing_save_owed');
  });

  it('asks nothing of a return from a place that is not a plane', () => {
    const table = new Table().draw('inward', ['Fiend']);
    table.push([
      { type: 'creature-sent-elsewhere', id: FIEND, kind: 'extradimensional', source: 'Rope Trick#cast:91', returns: { within: 10 } },
    ]);
    const out = unwrapped(table.back(FIEND, 'inside east'), 'the drop out');
    expect(saves(out.events)).toHaveLength(0);
    expect(out.at).toEqual(LANDMARKS['inside east']);
  });

  it('asks nothing of a familiar recalled from its pocket into the Cylinder', () => {
    const table = new Table().draw('inward', ['Fiend']);
    table.push(
      unwrapped(
        summonCreature(table.state, SRD_CONTENT, {
          id: IMP,
          monsterId: 'owl',
          by: CLERIC,
          creatureType: 'Fiend',
          kept: { spell: 'find-familiar', untilSummonerDies: false, pocket: { within: 30 } },
          placement: { from: { landmark: 'far east' }, feet: 5, bearing: 90 },
        }),
        'the familiar',
      ).events,
    );
    table.push(unwrapped(dismissKeptSummons(table.state, CLERIC, { who: IMP }), 'the pocket').events);
    const back = unwrapped(
      recallKeptSummons(table.state, CLERIC, { who: IMP, to: { from: { landmark: 'inside west' }, feet: 0 } }),
      'the recall',
    );
    expect(saves(back.events)).toHaveLength(0);
    expect(positionOf(table.push(back.events).state.scene!, IMP)).toEqual(LANDMARKS['inside west']);
  });
});

describe('SRD Magic Circle: the Blink that comes back at the start of a turn', () => {
  /** The fiend blinks at the end of its turn, from just outside the circle; the first seed on which it vanishes. */
  const blinked = (seed: string) => {
    const table = new Table();
    table.push([
      {
        type: 'spellcasting-declared',
        id: FIEND,
        spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['blink'] }),
      },
      ...slots(FIEND),
    ]);
    table.draw('inward', ['Fiend']);
    table.push([
      {
        type: 'combat-started',
        combatants: [
          { id: FIEND, initiative: 20, speed: 30 },
          { id: CLERIC, initiative: 10, speed: 30 },
        ],
      },
    ]);
    const rng = (state: GameState) => ({ ...supply(state), rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng });
    table.push(unwrapped(resolveSpell(table.state, FIEND, { spellId: 'blink', targets: [FIEND], slotLevel: 3 }, rng(table.state)), 'Blink').events);
    table.push(unwrapped(resolveTurn(table.state, rng(table.state)), 'the fiend’s turn ends').events);
    return { table, rng };
  };
  const SEED = 'abcdefghijklmnopqrstuvwxyz'
    .split('')
    .map((letter) => `blink-${letter}`)
    .find((seed) => elsewhereOf(blinked(seed).table.state, FIEND) !== null)!;

  it('rolls the save as the fiend comes back into the Cylinder, and leaves it away on a failure', () => {
    const { table } = blinked(SEED);
    const into = { returns: [{ who: FIEND, to: { from: { landmark: 'inside east' as const }, feet: 0 } }] };
    const failed = unwrapped(resolveTurn(table.state, supply(table.state, -30), into), 'the cleric’s turn ends');
    expect(saves(failed.events)).toHaveLength(1);
    const state = table.push(failed.events).state;
    expect(elsewhereOf(state, FIEND)?.kind).toBe('ethereal');
  });

  it('reversed, rolls the save before a fiend inside may vanish, and on a failure it stays', () => {
    /** The fiend inside a reversed circle blinks, and the boundary settles with the save forced. */
    const inside = (seed: string, flat: number) => {
      const table = new Table();
      table.push([
        { type: 'creature-moved', id: FIEND, placement: { from: { landmark: 'inside east' }, feet: 0 } },
        {
          type: 'spellcasting-declared',
          id: FIEND,
          spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['blink'] }),
        },
        ...slots(FIEND),
      ]);
      table.draw('outward', ['Fiend']);
      table.push([
        {
          type: 'combat-started',
          combatants: [
            { id: FIEND, initiative: 20, speed: 30 },
            { id: CLERIC, initiative: 10, speed: 30 },
          ],
        },
      ]);
      const seeded = (state: GameState) => ({
        ...supply(state, flat),
        rng: (state.rng === null ? createRng(seed) : restoreRng(state.rng)) as Rng,
      });
      table.push(unwrapped(resolveSpell(table.state, FIEND, { spellId: 'blink', targets: [FIEND], slotLevel: 3 }, seeded(table.state)), 'Blink').events);
      const ended = unwrapped(resolveTurn(table.state, seeded(table.state)), 'the fiend’s turn ends');
      return { events: ended.events, state: table.push(ended.events).state };
    };
    const seed = 'abcdefghijklmnopqrstuvwxyz'
      .split('')
      .map((letter) => `inside-${letter}`)
      .find((candidate) => elsewhereOf(inside(candidate, 30).state, FIEND) !== null)!;
    expect(saves(inside(seed, 30).events)).toHaveLength(1);
    const held = inside(seed, -30);
    expect(saves(held.events)).toHaveLength(1);
    expect(elsewhereOf(held.state, FIEND)).toBeNull();
    expect(positionOf(held.state.scene!, FIEND)).toEqual(LANDMARKS['inside east']);
  });

  it('stands the fiend inside on a success', () => {
    const { table } = blinked(SEED);
    const into = { returns: [{ who: FIEND, to: { from: { landmark: 'inside east' as const }, feet: 0 } }] };
    const crossed = unwrapped(resolveTurn(table.state, supply(table.state, 30), into), 'the cleric’s turn ends');
    expect(saves(crossed.events)).toHaveLength(1);
    expect(positionOf(table.push(crossed.events).state.scene!, FIEND)).toEqual(LANDMARKS['inside east']);
  });
});

describe('SRD Magic Circle: a stat block’s own step onto the Ethereal Plane', () => {
  const ETHEREALNESS = SRD_CONTENT.monsterById('ghost')!.actions.find((line) => line.name === 'Etherealness')!.name;

  /** The ghost in the circle's east half, and the order on its turn. */
  const haunted = (option: 'inward' | 'outward'): Table => {
    const table = new Table();
    table.push(unwrapped(addCreature(table.state, SRD_CONTENT, GHOST, 'ghost'), 'the ghost').events);
    table.push([{ type: 'creature-placed', id: GHOST, placement: { from: { landmark: 'inside east' }, feet: 0 } }]);
    table.draw(option, ['Undead']);
    table.push([
      {
        type: 'combat-started',
        combatants: [
          { id: GHOST, initiative: 20, speed: 40 },
          { id: CLERIC, initiative: 10, speed: 30 },
        ],
      },
    ]);
    return table;
  };

  it('rolls the save as the ghost steps back into the Cylinder it left', () => {
    const table = haunted('inward');
    table.push(unwrapped(takePrintedPlaneShift(table.state, GHOST, { line: ETHEREALNESS }, supply(table.state)), 'out').events);
    expect(elsewhereOf(table.state, GHOST)?.kind).toBe('ethereal');
    for (const step of ['ghost', 'cleric']) {
      table.push(unwrapped(resolveTurn(table.state, supply(table.state), { commandId: `end ${step}` }), step).events);
    }
    const failed = unwrapped(
      takePrintedPlaneShift(table.state, GHOST, { line: ETHEREALNESS, commandId: 'back' }, supply(table.state, -30)),
      'back',
    );
    expect(saves(failed.events)).toHaveLength(1);
    expect(elsewhereOf(table.push(failed.events).state, GHOST)?.kind).toBe('ethereal');
  });

  it('reversed, rolls the save before the ghost may leave the Cylinder for the Ethereal Plane', () => {
    const held = haunted('outward');
    const failed = unwrapped(
      takePrintedPlaneShift(held.state, GHOST, { line: ETHEREALNESS }, supply(held.state, -30)),
      'out',
    );
    expect(saves(failed.events)).toHaveLength(1);
    const state = held.push(failed.events).state;
    expect(elsewhereOf(state, GHOST)).toBeNull();
    expect(positionOf(state.scene!, GHOST)).toEqual(LANDMARKS['inside east']);

    const free = haunted('outward');
    const gone = unwrapped(takePrintedPlaneShift(free.state, GHOST, { line: ETHEREALNESS }, supply(free.state, 30)), 'out');
    expect(saves(gone.events)).toHaveLength(1);
    expect(elsewhereOf(free.push(gone.events).state, GHOST)?.kind).toBe('ethereal');
  });
});
