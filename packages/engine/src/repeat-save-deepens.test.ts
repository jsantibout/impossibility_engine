import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { Bonus } from './bonuses.js';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { ongoingSpellOf, resolveDamage, resolveSpell, resolveTurn } from './commands.js';
import { spellOn } from './fold/release.js';

/**
 * A repeat save whose **failure** deepens the effect, and then stops asking.
 *
 * SRD Sleep: "must succeed on a Wisdom saving throw or have the Incapacitated
 * condition until the end of its next turn, at which point it must repeat the
 * save. If the target fails the second save, the target has the Unconscious
 * condition for the duration."
 *
 * Two sentences the hook could not say before. `RepeatSave.onSuccess` released
 * an effect and a failure did nothing at all, so the deepening had nowhere to
 * go; and a hook that only ever released went on asking for ever, where the
 * SRD asks exactly once. `RepeatSave.onFailure` says both: the deeper
 * condition lands under the same source, and the timer that raised the save
 * ends with it, so the boundary owes nothing further.
 *
 * The Cockatrice writes the same shape — "_First Failure:_ Restrained and
 * repeats the save ... _Second Failure:_ Petrified" — which is why nothing in
 * the object names a spell.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const FOE = id('foe');
const MOB = id('mob');
/** Out of the Sphere, so a blow that frees one sleeper does not free them. */
const FAR = id('far');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
  abilities: { str: 14, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

/** A Wisdom no save makes, so the fixture is about what the failure buys. */
const DOZY: Partial<CharacterSheet> = {
  abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 1, cha: 10 },
};

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const supply = (state: GameState, bonuses: readonly Bonus[] = []) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('sleep') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
  ...(bonuses.length === 0 ? {} : { bonuses }),
});

/** The test insists on a repeat that lands, and on one that does not. */
const SHAKEN_OFF: readonly Bonus[] = [{ source: 'the test insists', flat: 40 }];
const STILL_ASLEEP: readonly Bonus[] = [{ source: 'the test insists', flat: -40 }];

/**
 * Two creatures inside a five-foot Sphere and one well outside it, in an
 * Initiative order the wizard opens.
 */
const field = (): GameEvent[] => [
  added(WIZ, 'party'),
  added(FOE, 'foes', DOZY),
  added(MOB, 'foes', DOZY),
  added(FAR, 'foes', DOZY),
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['sleep'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZ,
    pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 200, y: 200, z: 0 } },
  { type: 'landmark-added', name: 'the mound', at: { x: 200, y: 250, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { landmark: 'the mound' }, feet: 0 } },
  { type: 'creature-placed', id: MOB, placement: { from: { creature: FOE }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: FAR, placement: { from: { creature: FOE }, feet: 60, bearing: 90 } },
  { type: 'sight-declared', from: WIZ, to: FOE, seen: true },
  { type: 'sight-declared', from: WIZ, to: MOB, seen: true },
  { type: 'sight-declared', from: WIZ, to: FAR, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZ, initiative: 30, speed: 30 },
      { id: FOE, initiative: 20, speed: 30 },
      { id: MOB, initiative: 10, speed: 30 },
      { id: FAR, initiative: 5, speed: 30 },
    ],
  },
];

/** Where the Sphere is centred. A sphere takes no direction. */
const ON_THE_MOUND = { x: 200, y: 250, z: 0 } as const;

class Game {
  constructor(readonly events: GameEvent[]) {}

  get state(): GameState {
    return fold('sleep', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  /** Sleep, dropped on the mound. */
  sleep(): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        WIZ,
        { spellId: 'sleep', targets: [], slotLevel: 1, at: ON_THE_MOUND },
        supply(this.state),
      ),
      'casting Sleep',
    );
    this.push(out.events);
    return out.castingId!;
  }

  /** End the current turn, rolling whatever the boundary owes. */
  turn(bonuses: readonly Bonus[] = STILL_ASLEEP): this {
    const out = unwrap(resolveTurn(this.state, supply(this.state, bonuses)), 'turn');
    return this.push(out.events);
  }

  hit(target: CharacterId, amount = 5): this {
    const out = unwrap(
      resolveDamage(this.state, target, { amount, source: 'a falling rock' }, supply(this.state)),
      `damaging ${target}`,
    );
    return this.push(out.events);
  }

  conditions(who: CharacterId): readonly string[] {
    return this.state.creatures[who]?.conditions.conditions ?? [];
  }

  on(castingId: string): readonly string[] {
    const record = ongoingSpellOf(this.state, castingId);
    return record === null ? [] : spellOn(this.state, record);
  }

  /** The repeat saves this boundary raised, by the creature they are against. */
  savesOwed(): readonly string[] {
    return Object.values(this.state.pendingSaves).map((pending) => pending.target);
  }

  /** Every timer still standing over a condition on this creature. */
  timersOn(who: CharacterId): readonly string[] {
    return Object.entries(this.state.timers)
      .filter(([, timer]) => timer.target.kind === 'condition' && timer.target.on === who)
      .map(([key]) => key)
      .sort();
  }
}

describe('SRD Sleep: the save, the condition, and the repeat that deepens', () => {
  it('catches everyone in the Sphere and leaves them Incapacitated', () => {
    const game = new Game(field());
    const casting = game.sleep();

    expect(game.conditions(FOE)).toContain('incapacitated');
    expect(game.conditions(MOB)).toContain('incapacitated');
    expect(game.conditions(FAR)).not.toContain('incapacitated');
    expect(game.on(casting)).toEqual([FOE, MOB]);
  });

  /**
   * "until the end of its next turn, at which point it must repeat the save" —
   * the sleeper's own turn, so the wizard's ending owes nothing.
   */
  it('repeats the save at the end of the sleeper own next turn', () => {
    const game = new Game(field());
    game.sleep();

    // The wizard's turn ends; nothing is owed and nothing was rolled for it.
    expect(game.savesOwed()).toEqual([]);
    game.turn();
    expect(game.conditions(FOE)).toContain('incapacitated');

    // The first sleeper's turn ends: its save is raised, rolled and failed.
    game.turn();
    expect(game.conditions(FOE)).toContain('unconscious');
  });

  it('deepens to Unconscious on a second failure and asks no further save', () => {
    const game = new Game(field());
    const casting = game.sleep();
    game.turn().turn();

    expect(game.conditions(FOE)).toContain('unconscious');
    // Unconscious carries Incapacitated and Prone with it, so the sleeper is
    // not left holding a separate Incapacitated the deepening did not replace.
    expect(game.timersOn(FOE)).toEqual([]);
    // Still the casting's, so the minute it runs for still ends it.
    expect(game.on(casting)).toContain(FOE);

    // A full round later the sleeper's turn ends again and owes nothing: the
    // SRD repeats the save once, and the timer that raised it is gone.
    game.turn().turn().turn().turn();
    expect(game.savesOwed()).toEqual([]);
    expect(game.conditions(FOE)).toContain('unconscious');
  });

  it('frees the sleeper whose repeat succeeds, and leaves the other asleep', () => {
    const game = new Game(field());
    game.sleep();
    game.turn().turn(SHAKEN_OFF);

    expect(game.conditions(FOE)).not.toContain('incapacitated');
    expect(game.conditions(FOE)).not.toContain('unconscious');
    expect(game.conditions(MOB)).toContain('incapacitated');
  });

  /**
   * "The spell ends on a target if it takes damage" — **any** damage, from
   * anybody or from nobody at all, and on that target alone.
   */
  it('ends on a sleeper that takes damage, and on no other', () => {
    const game = new Game(field());
    const casting = game.sleep();
    game.hit(FOE);

    expect(game.conditions(FOE)).not.toContain('incapacitated');
    expect(game.conditions(MOB)).toContain('incapacitated');
    expect(game.on(casting)).toEqual([MOB]);
    expect(ongoingSpellOf(game.state, casting)).not.toBeNull();
  });

  /** And the deepened sleeper is woken by a blow exactly as the shallow one is. */
  it('ends on a sleeper a blow reaches after the deepening', () => {
    const game = new Game(field());
    game.sleep();
    game.turn().turn();
    expect(game.conditions(FOE)).toContain('unconscious');

    game.hit(FOE);
    expect(game.conditions(FOE)).not.toContain('unconscious');
    expect(game.conditions(MOB)).toContain('incapacitated');
  });
});
