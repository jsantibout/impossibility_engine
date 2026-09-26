/**
 * SRD Bestow Curse's third face: "In combat, the target must succeed on a Wisdom
 * saving throw at the start of each of its turns or be forced to take the Dodge
 * action on that turn."
 *
 * **Two things the vocabulary could not say, and they are the two halves of one
 * sentence.** A repeat save hung on a casting ended the casting on a success or
 * ended it on one target, and this one ends *nothing*: making it buys the
 * creature that turn and the curse runs on to ask again at the next one. And a
 * failure deepened a **condition**, where this failure has no condition to deepen
 * and narrows the turn instead.
 *
 * So `onSuccess` has a third value and `onFailure` a second arm: a rule over the
 * turn the failure happened on, written as the legality it is — `permits-only` on
 * the Action slot with the Dodge the only member, failing closed. That is the
 * owner's compulsion ruling exactly: the engine refuses everything else and walks
 * nobody through a Dodge.
 *
 * The hook rides on the **casting's own timer**, which is what leaves the
 * per-creature `grants` key free for the rule the failure hangs there — with a
 * deadline of its own at the end of the turn it governs.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveAttack, resolveSpell, resolveTurn, takeDodge } from './commands.js';

const id = (s: string) => asCharacterId(s);
const WARLOCK = id('warlock');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 1, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === GOBLIN ? 'goblins' : 'party',
});

const SETUP: readonly GameEvent[] = [
  added(WARLOCK),
  added(GOBLIN),
  {
    type: 'spellcasting-declared',
    id: WARLOCK,
    spellcasting: declaredCasting({ ability: 'cha', prepared: ['bestow-curse'] }),
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WARLOCK,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  {
    type: 'items-gained',
    id: GOBLIN,
    items: [{ id: 'longsword', quantity: 1 }],
    source: 'the kit',
  },
  { type: 'item-equipped', id: GOBLIN, item: 'longsword', armor: null },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the hut', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WARLOCK, placement: { from: { landmark: 'the hut' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WARLOCK }, feet: 5 } },
  { type: 'sight-declared', from: WARLOCK, to: GOBLIN, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WARLOCK, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (state: GameState, flat: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('curse') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
  bonuses: [{ source: 'the test insists', flat }],
});

const must = <T,>(result: Result<T>): T => unwrap(result, 'the curse');
const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);

class Table {
  readonly events: GameEvent[] = [...SETUP];

  get state(): GameState {
    return fold('curse', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** The curse, spoken as the Dodge face, with the opening save forced to fail. */
  curse(flat = -40): this {
    const out = must(
      resolveSpell(
        this.state,
        WARLOCK,
        { spellId: 'bestow-curse', targets: [GOBLIN], option: 'dodge', slotLevel: 3 } as never,
        supply(this.state, flat),
      ),
    );
    return this.push(out.events);
  }

  /**
   * Advance to the start of the goblin's turn, rolling the repeat the boundary
   * owes, and hand back the save it rolled.
   */
  boundary(flat: number): { readonly rolled: number; readonly success: boolean | null } {
    // The order may have to wrap: a boundary raises the repeat at the start of
    // the *goblin's* turn, and the warlock's turn is in between.
    for (let guard = 0; guard < 4; guard += 1) {
      const out = must(resolveTurn(this.state, supply(this.state, flat)));
      this.push(out.events);
      const mine = out.saves.filter((one) => one.target === GOBLIN);
      if (mine.length > 0) return { rolled: mine.length, success: mine[0]!.success };
    }
    return { rolled: 0, success: null };
  }

  /** What the goblin may do with its action now. */
  swing(): string | null {
    return codeOf(
      resolveAttack(this.state, GOBLIN, { target: WARLOCK, weapon: 'longsword' }, supply(this.state, 0)),
    );
  }

  dodge(): string | null {
    return codeOf(takeDodge(this.state, GOBLIN, {}));
  }
}

describe('SRD Bestow Curse: a save at the start of every turn, or the Dodge', () => {
  it('rolls the opening save and curses nothing else', () => {
    const table = new Table().curse();
    const state = table.state;

    // The save is rolled — a branch that resolves something rolls the die the
    // other three roll — and it imposes no condition at all.
    expect(state.creatures[GOBLIN]!.conditions.instances).toEqual([]);
    expect(Object.values(state.ongoing)).toMatchObject([{ spellId: 'bestow-curse' }]);
  });

  it('refuses the Attack action on a turn whose save failed, and permits the Dodge', () => {
    const table = new Table().curse();
    const boundary = table.boundary(-40);

    expect(boundary.rolled).toBe(1);
    expect(boundary.success).toBe(false);
    expect(table.swing()).toBe('action_forbidden');
    expect(table.dodge()).toBeNull();
  });

  it('leaves the turn alone where the save was made, and asks again next turn', () => {
    const table = new Table().curse();
    const made = table.boundary(40);

    expect(made.success).toBe(true);
    expect(table.swing()).toBeNull();
    // And the curse is still running: a success ends nothing at all.
    expect(Object.values(table.state.ongoing)).toMatchObject([{ spellId: 'bestow-curse' }]);
  });

  it('lets the rule go with the turn it governed', () => {
    const table = new Table().curse();
    table.boundary(-40);
    expect(table.swing()).toBe('action_forbidden');

    // A full round on, with the next boundary's save made: the rule the first
    // failure hung ended with its own turn, so nothing is left over.
    const next = table.boundary(40);
    expect(next.success).toBe(true);
    expect(table.swing()).toBeNull();
  });

  it('names the spell and the turn in the refusal', () => {
    const table = new Table().curse();
    table.boundary(-40);
    const refused = resolveAttack(
      table.state,
      GOBLIN,
      { target: WARLOCK, weapon: 'longsword' },
      supply(table.state, 0),
    );
    expect(isErr(refused) && refused.reason).toContain('Bestow Curse');
    expect(isErr(refused) && refused.reason).toContain('the end of this turn');
  });
});
