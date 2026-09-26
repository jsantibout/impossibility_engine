import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { hasCondition } from './conditions.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell, resolveTurn } from './commands.js';

/**
 * SRD Fear, all three of its sentences.
 *
 * > "Each creature in a 30-foot Cone must succeed on a Wisdom saving throw or
 * > drop whatever it is holding and have the Frightened condition for the
 * > duration. A Frightened creature takes the Dash action and moves away from
 * > you by the safest route on each of its turns unless there is nowhere to
 * > move. If the creature ends its turn in a space where it doesn't have line
 * > of sight to you, the creature makes a Wisdom saving throw. On a successful
 * > save, the spell ends on that creature."
 *
 * The drop is Command's Drop — "whatever it is holding" names no object — and
 * the repeat save is the first in the book that is **gated**: owed only where
 * the creature cannot see the caster. Sight is a pairwise declaration with
 * three answers, and only a declared *no* raises the debt: a boundary has
 * nobody to ask, so nobody having said leaves the creature Frightened until
 * somebody does.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
/** Ends its turn where it cannot see the wizard. */
const HIDDEN = id('hidden');
/** Ends its turn in full view of the wizard. */
const WATCHING = id('watching');
/** Nobody has said whether it can see the wizard. */
const UNSAID = id('unsaid');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** A goblin's kit: a scimitar in one hand and a shield on the other arm. */
const armed = (who: CharacterId): readonly GameEvent[] => [
  {
    type: 'items-gained',
    id: who,
    items: [
      { id: 'scimitar', quantity: 1 },
      { id: 'shield', quantity: 1 },
    ],
    source: 'the warren',
  },
  { type: 'item-equipped', id: who, item: 'scimitar', armor: null },
  { type: 'item-equipped', id: who, item: 'shield', armor: SRD_CONTENT.item('shield')?.armor ?? null },
];

const GOBLINS = [HIDDEN, WATCHING, UNSAID] as const;

const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  ...GOBLINS.map((who) => added(who, 'goblins')),
  ...GOBLINS.flatMap(armed),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['fear'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 200, y: 200, z: 0 } },
  { type: 'landmark-added', name: 'the left post', at: { x: 195, y: 185, z: 0 } },
  { type: 'landmark-added', name: 'the middle post', at: { x: 200, y: 185, z: 0 } },
  { type: 'landmark-added', name: 'the right post', at: { x: 205, y: 185, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  { type: 'creature-placed', id: HIDDEN, placement: { from: { landmark: 'the left post' }, feet: 0 } },
  { type: 'creature-placed', id: WATCHING, placement: { from: { landmark: 'the middle post' }, feet: 0 } },
  { type: 'creature-placed', id: UNSAID, placement: { from: { landmark: 'the right post' }, feet: 0 } },
  // The wizard sees all three; what each of them sees is the point.
  ...GOBLINS.map((who): GameEvent => ({ type: 'sight-declared', from: WIZARD, to: who, seen: true })),
  { type: 'sight-declared', from: HIDDEN, to: WIZARD, seen: false },
  { type: 'sight-declared', from: WATCHING, to: WIZARD, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: HIDDEN, initiative: 15, speed: 30 },
      { id: WATCHING, initiative: 10, speed: 30 },
      { id: UNSAID, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('fear') : restoreRng(state.rng)) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

/** A save nobody could make, and one nobody could miss. */
const DOOMED = -40;
const SPARED = 40;

class Game {
  readonly events: GameEvent[] = [...FIELD];

  get state(): GameState {
    return fold('fear', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** The wizard's Cone, pointed down the posts. */
  fear(flat = DOOMED): this {
    const out = unwrap(
      resolveSpell(
        this.state,
        WIZARD,
        { spellId: 'fear', targets: [], towards: { x: 200, y: 160, z: 0 } },
        supply(this.state, flat),
      ),
      'fear',
    );
    return this.push(out.events);
  }

  /** End the current turn; the flat bonus reaches whatever save the boundary owes. */
  turn(flat?: number): readonly GameEvent[] {
    const out = unwrap(resolveTurn(this.state, supply(this.state, flat)), 'turn');
    this.push(out.events);
    return out.events;
  }

  /** Advance the order until it is this creature's turn to act. */
  until(who: CharacterId, flat?: number): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.turn(flat);
    }
    throw new Error(`the order never came round to ${who}`);
  }

  frightened(who: CharacterId): boolean {
    return hasCondition(this.state.creatures[who]!.conditions, 'frightened');
  }

  holding(who: CharacterId): readonly string[] {
    return (this.state.creatures[who]?.equipped ?? []).map((worn) => worn.id).sort();
  }

  running(): boolean {
    return Object.values(this.state.ongoing).some((record) => record.spell === 'Fear');
  }
}

describe('SRD Fear’s failed save', () => {
  it('drops whatever the creature is holding and leaves it Frightened', () => {
    const game = new Game().fear();
    for (const who of GOBLINS) {
      expect(game.frightened(who), who).toBe(true);
      expect(game.holding(who), who).toEqual([]);
    }
    expect(game.running()).toBe(true);
  });

  it('leaves a creature that made the save holding both, and unafraid', () => {
    const game = new Game().fear(SPARED);
    for (const who of GOBLINS) {
      expect(game.frightened(who), who).toBe(false);
      expect(game.holding(who), who).toEqual(['scimitar', 'shield']);
    }
  });
});

describe('SRD Fear’s end-of-turn save, owed only out of the caster’s sight', () => {
  it('frees the creature that ends its turn unable to see the caster', () => {
    const game = new Game().fear();
    game.until(HIDDEN);
    const rolled = game.turn(SPARED);
    expect(
      rolled.some((event) => event.type === 'roll-recorded' && event.who === HIDDEN),
    ).toBe(true);
    expect(game.frightened(HIDDEN)).toBe(false);
    // On that creature alone: the others stay caught and the casting runs on.
    expect(game.frightened(WATCHING)).toBe(true);
    expect(game.frightened(UNSAID)).toBe(true);
    expect(game.running()).toBe(true);
  });

  it('owes no save to the creature that can still see the caster', () => {
    const game = new Game().fear();
    game.until(WATCHING);
    const rolled = game.turn(SPARED);
    expect(
      rolled.some((event) => event.type === 'roll-recorded' && event.who === WATCHING),
    ).toBe(false);
    expect(game.frightened(WATCHING)).toBe(true);
  });

  /** Sight is three-valued, and only a declared no is "doesn't have line of sight". */
  it('owes no save where nobody has said whether the creature can see the caster', () => {
    const game = new Game().fear();
    game.until(UNSAID);
    const rolled = game.turn(SPARED);
    expect(
      rolled.some((event) => event.type === 'roll-recorded' && event.who === UNSAID),
    ).toBe(false);
    expect(game.frightened(UNSAID)).toBe(true);
  });

  it('keeps the creature Frightened when the save it is owed fails', () => {
    const game = new Game().fear();
    game.until(HIDDEN);
    game.turn(DOOMED);
    expect(game.frightened(HIDDEN)).toBe(true);
  });
});
