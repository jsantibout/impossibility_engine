import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { combineSpeed, speedOf } from './standing.js';
import { conditionState } from './conditions.js';
import { resolveSpell, resolveTest, resolveTurn, type TurnResolution } from './commands.js';

/**
 * SRD Haste and SRD Slow, the two halves of one arithmetic.
 *
 * > Haste: "the target's Speed is doubled, it gains a +2 bonus to Armor Class,
 * > it has Advantage on Dexterity saving throws, and it gains an additional
 * > action on each of its turns. That action can be used to take only the
 * > Attack (one attack only), Dash, Disengage, Hide, or Utilize action."
 * > Slow: "An affected target's Speed is halved, it takes a −2 penalty to AC
 * > and Dexterity saving throws ... An affected target repeats the save at the
 * > end of each of its turns, ending the spell on itself on a success."
 *
 * The doubling and the halving meet in {@link combineSpeed}, in the order that
 * function fixes; the −2 on Dexterity saves is a bonus narrowed by ability;
 * and the repeat save is hosted by the casting on **one target**, because
 * Slow's failure imposes no condition to file it on and the spell catches six.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const SORCERER = id('sorcerer');
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');
const HOBGOBLIN = id('hobgoblin');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 16, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
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
  maxHp: 400,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map((level) => ({
    type: 'resource-pool-declared',
    id: who,
    pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
  }));

const FIELD: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(SORCERER, 'party'),
  added(FIGHTER, 'party'),
  added(GOBLIN, 'foes'),
  added(HOBGOBLIN, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['haste'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: SORCERER,
    spellcasting: declaredCasting({ ability: 'cha', classId: 'sorcerer', prepared: ['slow'] }),
  },
  ...slots(WIZARD),
  ...slots(SORCERER),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the door', at: { x: 200, y: 200, z: 0 } },
  { type: 'landmark-added', name: 'the arch', at: { x: 200, y: 180, z: 0 } },
  { type: 'landmark-added', name: 'the pit', at: { x: 200, y: 160, z: 0 } },
  { type: 'landmark-added', name: 'the well', at: { x: 205, y: 160, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the door' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: SORCERER,
    placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 },
  },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the arch' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the pit' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: HOBGOBLIN,
    placement: { from: { landmark: 'the well' }, feet: 0 },
  },
  ...[FIGHTER, GOBLIN, HOBGOBLIN].flatMap((who): readonly GameEvent[] =>
    [WIZARD, SORCERER].flatMap((caster): readonly GameEvent[] => [
      { type: 'sight-declared', from: caster, to: who, seen: true },
      { type: 'sight-declared', from: who, to: caster, seen: true },
    ]),
  ),
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: SORCERER, initiative: 18, speed: 30 },
      { id: FIGHTER, initiative: 15, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: HOBGOBLIN, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (state: GameState, flat?: number) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('time') : restoreRng(state.rng)) as Rng,
  ...(flat === undefined ? {} : { bonuses: [{ source: 'the test insists', flat }] }),
  content: SRD_CONTENT,
});

/** A save nobody could make, and one nobody could miss. */
const DOOMED = -40;
const SPARED = 40;

class Game {
  readonly events: GameEvent[] = [...FIELD];

  get state(): GameState {
    return fold('time', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(
    caster: CharacterId,
    spellId: string,
    targets: readonly CharacterId[],
    flat?: number,
    extra: Record<string, unknown> = {},
  ): this {
    const out = unwrap(
      resolveSpell(
        this.state,
        caster,
        { spellId, targets: [...targets], ...extra },
        supply(this.state, flat),
      ),
      spellId,
    );
    return this.push(out.events);
  }

  /** Haste, on a target who has said they are willing. */
  haste(target: CharacterId): this {
    return this.until(WIZARD).cast(WIZARD, 'haste', [target], undefined, { willing: [target] });
  }

  /** Slow, centred on the point the goblins are standing around. */
  slow(targets: readonly CharacterId[], flat?: number): this {
    return this.until(SORCERER).cast(SORCERER, 'slow', targets, flat, {
      at: { x: 200, y: 200, z: 0 },
      towards: { x: 200, y: 160, z: 0 },
    });
  }

  turn(flat?: number): TurnResolution {
    const out = unwrap(resolveTurn(this.state, supply(this.state, flat)), 'turn');
    this.push(out.events);
    return out;
  }

  /** Advance the order until it is this creature's turn to act. */
  until(who: CharacterId, flat?: number): this {
    for (let guard = 0; guard < 12; guard += 1) {
      const combat = this.state.combat;
      if (combat !== null && combat.order[combat.turnIndex]?.id === who) return this;
      this.turn(flat);
    }
    throw new Error(`the order never reached ${who}`);
  }

  /** A saving throw the creature makes, and what was added to the face. */
  save(who: CharacterId, ability: 'dex' | 'wis'): number {
    const out = unwrap(
      resolveTest(
        this.state,
        who,
        {
          kind: 'saving-throw',
          ability,
          dc: 10,
          commandId: `save:${who}:${ability}:${this.events.length}`,
        },
        supply(this.state),
      ),
      `${ability} save`,
    );
    this.push(out.events);
    return out.test!.roll.total - out.test!.roll.natural;
  }

  speed(who: CharacterId): number {
    return speedOf(this.state, who);
  }

  sourcesOn(who: CharacterId): readonly string[] {
    return (this.state.creatures[who]?.speedModifiers ?? []).map((held) => held.source);
  }
}

describe('a Speed an effect multiplies', () => {
  const none = conditionState();

  it('doubles once however many doublings apply, and does it before the halving', () => {
    expect(combineSpeed(30, 0, 0, false, none, 1)).toBe(60);
    expect(combineSpeed(30, 0, 0, false, none, 2)).toBe(60);
    // Doubled and then halved is the walk again, which is the order this fixes.
    expect(combineSpeed(30, 0, 1, false, none, 1)).toBe(30);
    // And the zero still wins.
    expect(combineSpeed(30, 0, 0, true, none, 1)).toBe(0);
  });

  it('doubles the flat changes with the base, because they are one Speed', () => {
    expect(combineSpeed(30, 10, 0, false, none, 1)).toBe(80);
  });

  it('is refused a mode, because the SRD writes it about the creature', () => {
    const written = checkSpellDefinitionValue({
      id: 'homebrew-quickening',
      name: 'Homebrew Quickening',
      level: 3,
      school: 'transmutation',
      castingTime: 'action',
      concentration: true,
      range: { kind: 'ranged', feet: 30 },
      targets: { count: 1 },
      durationSeconds: 60,
      effects: [{ kind: 'speed', change: 'double', mode: 'fly' }],
    });
    expect(written.map((problem) => problem.code)).toContain('bad_speed_change');
  });

  it('carries no feet, because the operation is the whole of the sentence', () => {
    const written = checkSpellDefinitionValue({
      id: 'homebrew-quickening-2',
      name: 'Homebrew Quickening',
      level: 3,
      school: 'transmutation',
      castingTime: 'action',
      concentration: true,
      range: { kind: 'ranged', feet: 30 },
      targets: { count: 1 },
      durationSeconds: 60,
      effects: [{ kind: 'speed', change: 'double', feet: 10 }],
    });
    expect(written.map((problem) => problem.code)).toContain('bad_speed_change');
  });
});

describe('SRD Haste, and SRD Slow over the top of it', () => {
  it('moves a hasted fighter at sixty feet, and at thirty once Slow lands too', () => {
    const game = new Game();
    expect(game.speed(FIGHTER)).toBe(30);

    game.haste(FIGHTER);
    expect(game.speed(FIGHTER)).toBe(60);

    game.slow([FIGHTER], DOOMED);
    expect(game.speed(FIGHTER)).toBe(30);
  });
});

describe('SRD Slow’s −2, which reaches the Armour Class and one ability’s saves', () => {
  it('takes two off a Dexterity save and nothing off a Wisdom save', () => {
    const bare = new Game();
    expect(bare.save(GOBLIN, 'dex')).toBe(2);
    expect(bare.save(GOBLIN, 'wis')).toBe(0);

    const game = new Game();
    game.slow([GOBLIN], DOOMED);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(game.state.creatures[GOBLIN]?.bonuses));
    expect(game.save(GOBLIN, 'dex')).toBe(0);
    expect(game.save(GOBLIN, 'wis')).toBe(0);
  });
});

describe('SRD Slow’s repeat save, which the casting hosts once per creature', () => {
  it('frees the goblin that makes it and leaves the hobgoblin slowed', () => {
    const game = new Game();
    game.slow([GOBLIN, HOBGOBLIN], DOOMED);
    expect(game.sourcesOn(GOBLIN)).toHaveLength(1);
    expect(game.sourcesOn(HOBGOBLIN)).toHaveLength(1);

    // The goblin's own turn ends; it repeats the save and makes it.
    game.until(GOBLIN).turn(SPARED);
    expect(game.sourcesOn(GOBLIN)).toHaveLength(0);
    expect(game.sourcesOn(HOBGOBLIN)).toHaveLength(1);
    expect(game.state.ongoing).not.toEqual({});
  });
});
