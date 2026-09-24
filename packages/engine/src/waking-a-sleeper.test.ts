/**
 * One creature spending an action to shake another out of a sleep.
 *
 * > SRD Sleep: "The spell ends on a target if it takes damage or **someone
 * > within 5 feet of it takes an action to shake it out of the spell's
 * > effect**."
 * > SRD Hypnotic Pattern: "The spell ends for an affected creature if it takes
 * > damage or if **someone else uses an action to shake the creature out of
 * > its stupor**."
 *
 * The half of that sentence the engine could not spend. The damage half has
 * been a `target-takes-damage` trigger since the cause was written;
 * `repeat-save-deepens.test.ts` drives it and this file leaves it alone except
 * to prove the two doors reach the same place. What is new is `wakeCreature`:
 * an **onlooker's** Action, five feet, and no die anywhere â€” the book asks for
 * no check here, and one invented would be a DC nobody printed.
 *
 * Four properties, and the last is the one that pays for the command existing:
 * the reach is measured rather than assumed, the sleeper beside the woken one
 * goes on sleeping, the spend is a real Action out of a real budget, and a
 * creature holding nothing wakeable is **refused** rather than charged.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import {
  ongoingSpellOf,
  resolveDamage,
  resolveSpell,
  resolveTurn,
  takeDodge,
  wakeableOn,
  wakeCreature,
} from './commands.js';
import { spellOn } from './fold/release.js';

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
/** The sleeper. */
const FOE = id('foe');
/** A second sleeper, five feet from the first, so one waking is one waking. */
const MOB = id('mob');
/** Standing beside the sleepers, awake, with an Action of its own. */
const ALLY = id('ally');
/** Ten feet off: the same action, out of reach. */
const AFAR = id('afar');

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

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: (state.rng === null ? createRng('wake') : restoreRng(state.rng)) as Rng,
  content: SRD_CONTENT,
});

/**
 * Two sleepers on the mound, an ally beside them and one ten feet off, with
 * the wizard opening the order.
 *
 * The two spells this is about catch an **area**, so the fixture puts the
 * waker inside it too and the casting names only the two it is meant to
 * catch: SRD Sleep says "each creature **of your choice**", and Hypnotic
 * Pattern's Cube is laid where the ally is not.
 */
const field = (): GameEvent[] => [
  added(WIZ, 'party'),
  added(FOE, 'foes', DOZY),
  added(MOB, 'foes', DOZY),
  added(ALLY, 'foes'),
  added(AFAR, 'foes'),
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({
      ability: 'int',
      prepared: ['sleep', 'hypnotic-pattern'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZ,
    pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: WIZ,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 200, y: 200, z: 0 } },
  { type: 'landmark-added', name: 'the mound', at: { x: 200, y: 250, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { landmark: 'the mound' }, feet: 0 } },
  { type: 'creature-placed', id: MOB, placement: { from: { creature: FOE }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: FOE }, feet: 5, bearing: 270 } },
  { type: 'creature-placed', id: AFAR, placement: { from: { creature: FOE }, feet: 10, bearing: 270 } },
  { type: 'sight-declared', from: WIZ, to: FOE, seen: true },
  { type: 'sight-declared', from: WIZ, to: MOB, seen: true },
  { type: 'sight-declared', from: WIZ, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZ, to: AFAR, seen: true },
  { type: 'sight-declared', from: FOE, to: WIZ, seen: true },
  { type: 'sight-declared', from: MOB, to: WIZ, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WIZ, initiative: 30, speed: 30 },
      { id: ALLY, initiative: 25, speed: 30 },
      { id: AFAR, initiative: 22, speed: 30 },
      { id: FOE, initiative: 20, speed: 30 },
      { id: MOB, initiative: 10, speed: 30 },
    ],
  },
];

/** Where the Sphere is centred. A sphere takes no direction. */
const ON_THE_MOUND = { x: 200, y: 250, z: 0 } as const;
/**
 * Where the Cube is laid, and which way it is pointed: short of the mound and
 * aimed over both sleepers.
 *
 * A Cube runs *forward* from the point it is laid on, which is why the origin
 * is west of the pair rather than on them.
 */
const SHORT_OF_THE_MOUND = { x: 190, y: 250, z: 0 } as const;
const AWAY = { x: 300, y: 250, z: 0 } as const;

/**
 * The waker, with a faceful of sand.
 *
 * SRD Hypnotic Pattern catches "each creature in the area **who can see the
 * pattern**", and a Cube thirty feet on a side laid close enough to catch two
 * creatures five feet apart catches everything else standing with them. So the
 * waker is excused by the spell's own clause rather than by a geometry the
 * fixture would have to keep working: Blinded is a creature that cannot see
 * the pattern, and a Blinded creature still has its Action.
 */
const BLINDED: GameEvent = {
  type: 'condition-applied',
  id: ALLY,
  condition: 'blinded',
  source: 'a faceful of sand',
};

class Game {
  constructor(readonly events: GameEvent[]) {}

  get state(): GameState {
    return fold('wake', this.events);
  }

  push(more: readonly GameEvent[]): this {
    this.events.push(...more);
    return this;
  }

  cast(spellId: string, targets: readonly CharacterId[]): string {
    const out = unwrap(
      resolveSpell(
        this.state,
        WIZ,
        spellId === 'sleep'
          ? { spellId, targets, slotLevel: 1, at: ON_THE_MOUND }
          : { spellId, targets, slotLevel: 3, at: SHORT_OF_THE_MOUND, towards: AWAY },
        supply(this.state),
      ),
      `casting ${spellId}`,
    );
    this.push(out.events);
    return out.castingId!;
  }

  /** End the current turn, rolling whatever the boundary owes. */
  turn(): this {
    const out = unwrap(resolveTurn(this.state, supply(this.state)), 'turn');
    return this.push(out.events);
  }

  hit(target: CharacterId, amount = 5): this {
    const out = unwrap(
      resolveDamage(this.state, target, { amount, source: 'a falling rock' }, supply(this.state)),
      `damaging ${target}`,
    );
    return this.push(out.events);
  }

  wake(who: CharacterId, target: CharacterId, commandId?: string): Result<readonly GameEvent[]> {
    return wakeCreature(
      this.state,
      who,
      { target },
      commandId === undefined ? {} : { commandId },
    );
  }

  shake(who: CharacterId, target: CharacterId, commandId?: string): this {
    return this.push(unwrap(this.wake(who, target, commandId), `${who} shakes ${target}`));
  }

  conditions(who: CharacterId): readonly string[] {
    return this.state.creatures[who]?.conditions.conditions ?? [];
  }

  on(castingId: string): readonly string[] {
    const record = ongoingSpellOf(this.state, castingId);
    return record === null ? [] : spellOn(this.state, record);
  }

  /** Whether the fight still knows about this casting at all. */
  running(castingId: string): boolean {
    return ongoingSpellOf(this.state, castingId) !== null;
  }
}

describe('SRD Sleep: someone within 5 feet spends an action', () => {
  it('ends the spell on the sleeper they shook, and on no other', () => {
    const game = new Game(field());
    const casting = game.cast('sleep', [FOE, MOB]);
    expect(game.conditions(FOE)).toContain('incapacitated');
    expect(game.conditions(MOB)).toContain('incapacitated');

    // The wizard's turn ends, the ally's begins, and the ally spends it.
    game.turn();
    game.shake(ALLY, FOE);

    expect(game.conditions(FOE)).not.toContain('incapacitated');
    // The one beside them goes on sleeping: "the spell ends **on a target**".
    expect(game.conditions(MOB)).toContain('incapacitated');
    expect(game.on(casting)).toEqual([MOB]);
  });

  it('costs the shaker their Action', () => {
    const game = new Game(field());
    game.cast('sleep', [FOE, MOB]);
    game.turn();

    const woken = unwrap(game.wake(ALLY, FOE), 'shaking');
    expect(woken.some((event) => event.type === 'action-spent')).toBe(true);
    game.push(woken);

    // And it is really gone: a Dodge afterwards finds no Action to take.
    const dodge = takeDodge(game.state, ALLY, { commandId: 'dodge-after' });
    expect(dodge.ok).toBe(false);
    if (!dodge.ok) expect(dodge.code).toBe('no_action');
  });

  it('refuses a shaker who is ten feet away, and spends nothing', () => {
    const game = new Game(field());
    game.cast('sleep', [FOE, MOB]);
    game.turn().turn();

    const reached = game.wake(AFAR, FOE);
    expect(reached.ok).toBe(false);
    if (!reached.ok) expect(reached.code).toBe('out_of_reach');
    expect(game.conditions(FOE)).toContain('incapacitated');
    // Nothing was written, so the Action is still there to spend.
    expect(takeDodge(game.state, AFAR, { commandId: 'dodge-instead' }).ok).toBe(true);
  });

  it('refuses a creature holding nothing a shake would end', () => {
    const game = new Game(field());
    // Nobody has been put to sleep at all, so the ally's action would buy
    // nothing — and an Action spent on nothing is the one thing the book does
    // not let a table do by accident.
    expect(wakeableOn(game.state, FOE)).toEqual([]);
    game.turn();

    const nothing = game.wake(ALLY, FOE);
    expect(nothing.ok).toBe(false);
    if (!nothing.ok) expect(nothing.code).toBe('nothing_to_wake');
    // Nothing was spent: the Action is still the ally's.
    expect(takeDodge(game.state, ALLY, { commandId: 'dodge-instead' }).ok).toBe(true);

    // And a creature merely Unconscious at 0 Hit Points is not shaken awake
    // either: the book says what ends that, and it is hit points.
    const felled = new Game([
      ...field(),
      { type: 'condition-applied', id: FOE, condition: 'unconscious', source: 'zero hit points' },
    ]);
    felled.turn();
    const down = felled.wake(ALLY, FOE);
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.code).toBe('nothing_to_wake');
  });

  it('refuses a creature shaking itself', () => {
    const game = new Game(field());
    game.cast('sleep', [FOE, MOB]);
    game.turn().turn().turn();

    const alone = game.wake(FOE, FOE);
    expect(alone.ok).toBe(false);
    if (!alone.ok) expect(alone.code).toBe('cannot_wake_yourself');
  });

  it('is the same ending a blow is', () => {
    const woken = new Game(field());
    const one = woken.cast('sleep', [FOE, MOB]);
    woken.turn();
    woken.shake(ALLY, FOE);

    const struck = new Game(field());
    const two = struck.cast('sleep', [FOE, MOB]);
    struck.hit(FOE);

    // Both sentences say "on a target", so both release that one and leave
    // the casting standing for the sleeper beside them — the same door,
    // reached by an Action instead of by a blow.
    expect(woken.on(one)).toEqual(struck.on(two));
    expect(woken.on(one)).toEqual([MOB]);
    expect(woken.conditions(FOE)).toEqual(struck.conditions(FOE));
    expect(woken.running(one)).toBe(true);
  });

  it('does nothing twice under one command id', () => {
    const game = new Game(field());
    game.cast('sleep', [FOE, MOB]);
    game.turn();
    game.shake(ALLY, FOE, 'one-shake');

    const again = unwrap(game.wake(ALLY, FOE, 'one-shake'), 'the retry');
    expect(again).toEqual([]);
  });
});

describe('SRD Hypnotic Pattern: someone else uses an action', () => {
  it('ends the stupor on the creature shaken and leaves the rest staring', () => {
    const game = new Game([...field(), BLINDED]);
    // The Cube is laid short of the mound and catches whoever can see the
    // pattern; the two dozy ones fail and the casting keeps them.
    const casting = game.cast('hypnotic-pattern', []);
    expect(game.conditions(FOE)).toContain('charmed');
    expect(game.conditions(MOB)).toContain('charmed');

    game.turn();
    game.shake(ALLY, FOE);

    expect(game.conditions(FOE)).not.toContain('charmed');
    expect(game.conditions(MOB)).toContain('charmed');
    expect(game.on(casting)).toEqual([MOB]);
  });

  it('gives the freed creature its Speed back', () => {
    const game = new Game([...field(), BLINDED]);
    game.cast('hypnotic-pattern', []);
    game.turn();
    const before = game.state;
    game.shake(ALLY, FOE);

    // "While Charmed, the creature has ... a Speed of 0": a grant sourced to
    // the casting, so the ending that lifts the condition lifts it too.
    expect(before.creatures[FOE]!.speedModifiers).not.toEqual([]);
    expect(game.state.creatures[FOE]!.speedModifiers).toEqual([]);
  });
});

describe('the fold finds it, whoever assembled the log', () => {
  it('ends the spell on a hand-written `creature-woken` with no command at all', () => {
    const game = new Game(field());
    const casting = game.cast('sleep', [FOE, MOB]);

    // No command, no Action, no reach check â€” a log is a log, and what the
    // event *means* is the fold's to decide.
    const after = applyEvent(game.state, { type: 'creature-woken', id: FOE, by: ALLY });
    expect(after.creatures[FOE]!.conditions.conditions).not.toContain('incapacitated');
    expect(after.creatures[MOB]!.conditions.conditions).toContain('incapacitated');
    expect(ongoingSpellOf(after, casting)).not.toBeNull();
  });
});
