/**
 * The printed traits the engine **spends**, as against the ones it merely
 * reads.
 *
 * `MonsterTraitSchema` has typed ten sentences for some time and two of them
 * had a reader: Pack Tactics, gathered on the attack, and the two sunlight
 * sentences, compiled onto the sheet as standing effects. The rest reached
 * `CharacterSheet.stated.traits`, satisfied `hasPrintedTrait`, and were asked
 * for by nobody — which the ledger counted, correctly, as parsed and unpaid.
 *
 * This file is those readers. Every one of them is the pattern
 * `printedSunlight` set — a printed sentence compiled into a mechanic the
 * engine already has — or a question an existing rule already asked and was
 * answering without the block's own trait in hand:
 *
 * | Sentence | What spends it |
 * |---|---|
 * | SRD Flyby | `provokedBy`: a flier holding it leaves a reach for free |
 * | SRD Standing Leap | `checkJump`: the printed distances, running start or not |
 * | SRD Spider Climb | the climb's own handover, which the holder does not get |
 * | SRD Shadow Stealth | an `action-rule` gated on `in-dim-light-or-darkness` |
 * | SRD Nimble Escape and its two siblings | the `action-rule`s Cunning Action is written as |
 * | SRD Bloodied Fury | a `roll-mode` gated on `while-bloodied` |
 *
 * **What is not here is `sheds-light`**, and it is absent on purpose: a patch
 * of light anchored to a creature and moving with it is a real addition to
 * `positioning.ts`, where a patch is declared and never derived. It is the one
 * parsed kind still waiting.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, type CharacterId, isErr, expect as unwrap } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  declareCreatureSide,
  declareLight,
  placeCreatureInScene,
  resolveMove,
  setScene,
  takeDash,
  takeDisengage,
  takeHide,
  type MoveResolution,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { actionRulesOn, rollModesFor } from './standing.js';

const id = (s: string) => asCharacterId(s);
const SEED = 'trait-readers';
const WATCHER = id('watcher');

const supply = (seed = SEED) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * Two stat blocks a stated distance apart, each on a declared side, in a fight.
 *
 * Sides are declared because an Opportunity Attack is withheld between
 * creatures nobody has taken sides for — `provokedBy` reports that rather than
 * swinging — so a test that left them out would prove nothing about any trait.
 */
function field(moverId: string, who: CharacterId, apart = 5): GameEvent[] {
  const log: GameEvent[] = [];
  const state = (): GameState => fold(SEED, log);
  const step = (what: string, produce: () => ReturnType<typeof declareCreatureSide>): void => {
    log.push(...unwrap(produce(), what));
  };

  log.push(...unwrap(addCreature(state(), SRD_CONTENT, who, moverId), 'the mover').events);
  log.push(
    ...unwrap(addCreature(state(), SRD_CONTENT, WATCHER, 'goblin-warrior'), 'the watcher').events,
  );
  step('the mover takes a side', () => declareCreatureSide(state(), who, 'monsters'));
  step('the watcher takes the other', () => declareCreatureSide(state(), WATCHER, 'party'));
  step('the field', () => setScene(state(), { width: 400, depth: 400, height: 200 }));
  step('a stone on it', () => addSceneLandmark(state(), 'the stone', { x: 100, y: 100, z: 0 }));
  step('the mover on the stone', () =>
    placeCreatureInScene(state(), who, { from: { landmark: 'the stone' }, feet: 0 }),
  );
  step('the watcher beside it', () =>
    placeCreatureInScene(state(), WATCHER, { from: { creature: who }, feet: apart, bearing: 90 }),
  );
  log.push({
    type: 'combat-started',
    combatants: [
      { id: who, initiative: 20, speed: 30 },
      { id: WATCHER, initiative: 5, speed: 30 },
    ],
  });
  return log;
}

/** The state that log folds to, plus whatever a test declared on top of it. */
const at = (log: readonly GameEvent[]): GameState => fold(SEED, log);

/** Who was offered a swing, read off the event the move actually wrote. */
const provokedIn = (moved: MoveResolution): readonly string[] => {
  const declared = moved.events.find((event) => event.type === 'movement-declared');
  return declared === undefined
    ? []
    : (declared as { readonly move: { readonly provoked: readonly { readonly reactor: string }[] } })
        .move.provoked.map((one) => one.reactor);
};

/** The move itself, west of where it started, in the mode named. */
const away = (mode: 'walk' | 'fly' | 'climb', feet = 30) => ({
  placement: { from: { landmark: 'the stone' }, feet, bearing: 270 },
  mode,
});

/** The named actions a creature may pay for out of something cheaper. */
const allowances = (state: GameState, who: CharacterId): readonly string[] =>
  actionRulesOn(state, who)
    .map((granted) => (granted.rule.kind === 'allows' ? granted.rule.action : granted.rule.kind))
    .sort();

describe('SRD Flyby: an Opportunity Attack a flier does not provoke', () => {
  /**
   * "The gargoyle doesn't provoke an Opportunity Attack when it flies out of
   * an enemy's reach." The reach is left; the Reaction is not offered.
   */
  it('offers nobody a swing when the holder flies out of reach', () => {
    const log = field('gargoyle', id('gargoyle'));
    const moved = unwrap(resolveMove(at(log), id('gargoyle'), away('fly'), supply()), 'flying');
    expect(provokedIn(moved)).toEqual([]);
  });

  /**
   * The other half, and the half a reader that simply returned nothing would
   * fail: the sentence says **flies**, so the same creature walking out of the
   * same reach provokes exactly as it always did.
   */
  it('offers the swing when the same creature walks out of the same reach', () => {
    const log = field('gargoyle', id('gargoyle'));
    const moved = unwrap(resolveMove(at(log), id('gargoyle'), away('walk'), supply()), 'walking');
    expect(provokedIn(moved)).toEqual([WATCHER]);
  });

  /** And a flier whose block prints no such sentence provokes on the wing. */
  it('offers the swing to a flier that prints no such trait', () => {
    const log = field('cockatrice', id('cockatrice'));
    const moved = unwrap(resolveMove(at(log), id('cockatrice'), away('fly'), supply()), 'flying');
    expect(provokedIn(moved)).toEqual([WATCHER]);
  });
});

describe('SRD Standing Leap: the printed jump, running start or not', () => {
  /**
   * "The frog's Long Jump is up to 10 feet and its High Jump is up to 5 feet
   * with or without a running start." A frog has Strength 1, so the jump the
   * sheet would compute is nothing at all — `longJumpDistance` halves the
   * score for a standing jump and floors it.
   */
  it('lets the frog clear the ten feet its block prints, standing', () => {
    const log = field('frog', id('frog'));
    const jumped = unwrap(
      resolveMove(at(log), id('frog'), { ...away('walk', 10), jump: { kind: 'long' } }, supply()),
      'the leap',
    );
    expect(jumped.feet).toBe(10);
  });

  it('still refuses a leap past the printed distance', () => {
    const log = field('frog', id('frog'));
    const over = resolveMove(
      at(log),
      id('frog'),
      { ...away('walk', 15), jump: { kind: 'long' } },
      supply(),
    );
    expect(isErr(over) && over.code).toBe('jump_too_far');
  });

  /**
   * And the running start is no longer required of the holder — which is the
   * whole of what the sentence adds. A goblin declaring one on a turn it has
   * not moved is refused; the frog is not.
   */
  it('asks the holder for no running start, and everyone else for one', () => {
    const goblin = field('goblin-boss', id('goblin'));
    const refused = resolveMove(
      at(goblin),
      id('goblin'),
      { ...away('walk', 5), jump: { kind: 'long', running: true } },
      supply(),
    );
    expect(isErr(refused) && refused.code).toBe('no_running_start');

    const log = field('frog', id('frog'));
    const jumped = resolveMove(
      at(log),
      id('frog'),
      { ...away('walk', 10), jump: { kind: 'long', running: true } },
      supply(),
    );
    expect(jumped.ok).toBe(true);
  });
});

describe('SRD Spider Climb: the check the holder is never asked for', () => {
  /**
   * The engine asks no ability check to climb, because whether a surface is
   * "slippery … or one with few handholds" is the table's fact and the SRD
   * hands the DC 15 Strength (Athletics) check to the GM as an option. So a
   * climb reports it as a decision nobody has made.
   */
  it('hands the climb check to the table for a creature without the trait', () => {
    const log = field('bandit', id('climber'));
    const climbed = unwrap(
      resolveMove(at(log), id('climber'), away('climb', 10), supply()),
      'the climb',
    );
    expect(climbed.unverified.some((note) => note.includes('Athletics'))).toBe(true);
  });

  /** And not for one whose block says it needs no such check. */
  it('asks nothing of a creature whose block prints Spider Climb', () => {
    const log = field('giant-spider', id('spider'), 15);
    const climbed = unwrap(
      resolveMove(at(log), id('spider'), away('climb', 10), supply()),
      'the climb',
    );
    expect(climbed.unverified.some((note) => note.includes('Athletics'))).toBe(false);
  });

  /**
   * **And the surcharge is untouched**, which is the rule rather than an
   * omission. SRD's climb costs "1 extra foot … unless the creature has a
   * Climb Speed", and Spider Climb is not a Climb Speed: the book gives the
   * Vampire Spawn the trait and no Climb Speed, so it climbs at half rate and
   * the Giant Spider, which prints Climb 30, does not.
   */
  it('still charges the surcharge to a holder the book gave no Climb Speed', () => {
    const spawn = field('vampire-spawn', id('spawn'));
    const paid = unwrap(
      resolveMove(at(spawn), id('spawn'), away('climb', 10), supply()),
      'the climb',
    );
    expect(paid.cost).toBe(20);

    const spider = field('giant-spider', id('spider'), 15);
    const free = unwrap(
      resolveMove(at(spider), id('spider'), away('climb', 10), supply()),
      'the climb',
    );
    expect(free.cost).toBe(10);
  });
});

describe('SRD Nimble Escape and its two siblings: a named action out of a Bonus Action', () => {
  /** One rule under three headings, and the goblin's menu is two of the three. */
  it('lets the Goblin Minion Disengage out of its Bonus Action', () => {
    const log = field('goblin-minion', id('minion'));
    const took = unwrap(
      takeDisengage(at(log), id('minion'), {}, { from: 'bonus-action' }),
      'the Disengage',
    );
    expect(took.some((event) => event.type === 'disengage-taken')).toBe(true);
  });

  it('refuses the goblin the Dash its sentence does not print', () => {
    const log = field('goblin-minion', id('minion'));
    const refused = takeDash(at(log), id('minion'), {}, { from: 'bonus-action' });
    expect(isErr(refused) && refused.code).toBe('action_not_allowed');
  });

  /** The Vampire Spawn's Deathless Agility prints the other two of the three. */
  it('gives each holder the menu its own sentence prints', () => {
    expect(allowances(at(field('vampire-spawn', id('spawn'))), id('spawn'))).toEqual([
      'dash',
      'disengage',
    ]);
    expect(allowances(at(field('spy', id('spy'))), id('spy'))).toEqual([
      'dash',
      'disengage',
      'hide',
    ]);
  });

  /** And a block printing no such sentence holds no such rule. */
  it('gives a block that prints no such sentence nothing at all', () => {
    expect(allowances(at(field('bandit', id('plain'))), id('plain'))).toEqual([]);
  });
});

describe('SRD Shadow Stealth: the Hide the dark buys', () => {
  const inLight = (level: 'bright' | 'dim' | 'darkness'): GameState => {
    const log = field('shadow', id('shadow'));
    log.push(
      ...unwrap(
        declareLight(fold(SEED, log), 'the crypt', {
          region: { origin: { creature: id('shadow') }, shape: { kind: 'sphere', radius: 30 } },
          level,
        }),
        'the light',
      ),
    );
    return fold(SEED, log);
  };

  /**
   * "While in Dim Light or Darkness, the shadow takes the Hide action." The
   * same `allows` rule, with the clause the sentence opens with as the
   * requirement — read at the holder's own space on every question, exactly as
   * `in-sunlight` is.
   */
  it('holds no rule where nobody has said what the light is', () => {
    expect(allowances(at(field('shadow', id('shadow'))), id('shadow'))).toEqual([]);
  });

  it('holds the rule in Darkness, and drops it in Bright Light', () => {
    expect(allowances(inLight('darkness'), id('shadow'))).toEqual(['hide']);
    expect(allowances(inLight('bright'), id('shadow'))).toEqual([]);
  });

  it('holds it in Dim Light too, which is the other half of the clause', () => {
    expect(allowances(inLight('dim'), id('shadow'))).toEqual(['hide']);
  });

  /** And the Hide itself is payable out of the Bonus Action in the dark. */
  it('lets the shadow pay for a Hide out of its Bonus Action in the dark', () => {
    const hid = takeHide(
      inLight('darkness'),
      id('shadow'),
      { from: 'bonus-action', obscured: true },
      supply(),
    );
    // Whether the die beat the watcher is the engine's business; what this
    // asserts is that the price was not the refusal.
    expect(isErr(hid) && hid.code).not.toBe('action_not_allowed');
  });
});

describe('SRD Bloodied Fury: Advantage while at half Hit Points or fewer', () => {
  const modes = (
    state: GameState,
    roller: CharacterId,
    family: 'attack' | 'ability-check' | 'saving-throw',
  ): readonly string[] =>
    rollModesFor(state, {
      roller,
      ...(family === 'attack' ? { against: WATCHER } : {}),
      family,
    }).modes.map((mode) => mode.source);

  /** Half the printed maximum, rounded up, which is one point past Bloodied. */
  const bloodied = (log: GameEvent[], who: CharacterId): GameState => {
    const creature = fold(SEED, log).creatures[who]!;
    log.push({
      type: 'damage-taken',
      id: who,
      amount: Math.ceil(creature.vitals.hpMax / 2),
      source: 'the fixture',
    });
    return fold(SEED, log);
  };

  it('gives the boar nothing while it has more than half its Hit Points', () => {
    expect(modes(at(field('boar', id('boar'))), id('boar'), 'attack')).toEqual([]);
  });

  it('gives it Advantage on attack rolls once it is Bloodied', () => {
    const state = bloodied(field('boar', id('boar')), id('boar'));
    expect(modes(state, id('boar'), 'attack')).toEqual(['Bloodied Fury']);
    // The sentence names one roll, so a saving throw is not one of them.
    expect(modes(state, id('boar'), 'saving-throw')).toEqual([]);
  });

  /** SRD Bloodied Frenzy is the same rule over the wider list it prints. */
  it('gives the Berserker both of the rolls its own sentence names', () => {
    const state = bloodied(field('berserker', id('berserker')), id('berserker'));
    expect(modes(state, id('berserker'), 'attack')).toEqual(['Bloodied Frenzy']);
    expect(modes(state, id('berserker'), 'saving-throw')).toEqual(['Bloodied Frenzy']);
    expect(modes(state, id('berserker'), 'ability-check')).toEqual([]);
  });
});
