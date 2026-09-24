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
  carryingCapacity,
  declareCreatureSide,
  declareLight,
  declareObject,
  placeCreatureInScene,
  resolveAttack,
  resolveMove,
  resolveTurn,
  setScene,
  settleDamage,
  takeDash,
  takeDisengage,
  takeHide,
  type MoveResolution,
} from './commands.js';
import { dealSpellDamage } from './commands/damage.js';
import { allowedActions } from './combat.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster } from './monster.js';
import { rowAt, slotsAt } from './progression.js';
import { createRollIssuer } from './rolls.js';
import { spellsForClass } from '@ie/srd';
import { actionRulesOn, rollModesFor, speedOf } from './standing.js';

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
    // An allowance says what it buys, and a bundle buys more than one — see
    // `allowedActions`, which is the one reader of the two spellings.
    .flatMap((granted) =>
      granted.rule.kind === 'allows' ? [...allowedActions(granted.rule)] : [granted.rule.kind],
    )
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

  /**
   * **Exactly half, which is the boundary the glossary names and no SRD block
   * can reach.**
   *
   * "A creature is Bloodied while it has half its Hit Points **or fewer**
   * remaining" — so a creature at exactly half is Bloodied, and the clause
   * `hp * 2 > hpMax` is what says so. The two blocks that print the sentence
   * have odd maxima (13 and 67), so neither can ever land on the boundary and
   * the wrong comparison would pass every test above. A constructed creature
   * with an even maximum is what closes it, which is the same thing
   * `light-and-sight.test.ts` did for `in-sunlight` before any block carried
   * that sentence either.
   */
  it('counts a creature at exactly half its maximum as Bloodied', () => {
    const FURIOUS = id('furious');
    const base: readonly GameEvent[] = [
      {
        type: 'creature-added',
        id: FURIOUS,
        name: 'furious',
        sheet: {
          level: 1,
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          skills: {},
          saveProficiencies: [],
          armor: null,
          shield: null,
          armorTraining: { light: true, medium: true, heavy: true, shields: true },
          baseSpeed: 30,
          spellcastingAbility: null,
          standing: [
            {
              feature: 'fixture:fury',
              name: 'Fixture Fury',
              reach: { kind: 'self' },
              grant: {
                kind: 'roll-mode',
                modifier: { mode: 'advantage', selector: { roll: 'attack', relation: 'roller' } },
              },
              requires: [{ kind: 'while-bloodied' }],
            },
          ],
        },
        maxHp: 30,
        diesAtZero: false,
        creatureType: 'Beast',
        side: 'monsters',
      },
    ];

    const after = (damage: number): GameState =>
      fold(SEED, [...base, { type: 'damage-taken', id: FURIOUS, amount: damage }]);

    // 16 of 30 is more than half, and 15 of 30 is exactly half.
    expect(modes(after(14), FURIOUS, 'attack')).toEqual([]);
    expect(modes(after(15), FURIOUS, 'attack')).toEqual(['Fixture Fury']);
  });
});

describe('a price is the one thing a heading says that a sentence does not', () => {
  /**
   * Every other reader here is applied to a line wherever it is printed,
   * because what a line says is not a property of its heading. This one is
   * the exception, and the exception is the rule working: the whole content
   * of "the goblin takes the Disengage or Hide action" is *which slot pays
   * for it*, and the sentence prints no slot. Under **Bonus Actions** it is a
   * Bonus Action; under **Actions** it would be a creature taking an action
   * as an action, and a free Bonus Action compiled out of it is a rule nobody
   * printed.
   */
  it('compiles nothing from the same sentence printed under Actions', () => {
    const goblin = SRD_CONTENT.monsters.find((one) => one.id === 'goblin-minion')!;
    const printed = goblin.bonusActions.find((line) => line.name === 'Nimble Escape')!;
    expect(printed.trait).toEqual({
      kind: 'takes-a-named-action-as-a-bonus-action',
      actions: ['disengage', 'hide'],
    });

    // The block it came from, with that one line moved to the other heading.
    const moved = adaptMonster(
      { ...goblin, bonusActions: [], actions: [...goblin.actions, printed] },
      id('misfiled'),
    );
    expect(moved.sheet.standing).toBeUndefined();

    // Not vacuous: the block as the book prints it does compile the rule.
    expect(adaptMonster(goblin, id('as-printed')).sheet.standing).toHaveLength(2);
  });
});

/**
 * The second batch of printed traits with a mechanic, and the same rule built
 * them: a sentence the parser typed, compiled into something the engine
 * already holds.
 *
 * | Sentence | What spends it |
 * |---|---|
 * | SRD Agile | `provokedBy`, the same reader SRD Flyby goes through |
 * | SRD Running Leap | `checkJump`, as a second bound on a running Long Jump |
 * | SRD Aura of Authority | `standingFor`'s aura reach, which Aura of Protection already walks |
 * | SRD Blood Frenzy | `rollModesFor`, against a target missing Hit Points |
 * | SRD Siege Monster | `dealSpellDamage`, as SRD's first-applied multiplier |
 * | SRD Aberrant Ground | `terrainAt`, as a patch derived from where the holder stands |
 */
describe('SRD Agile: an Opportunity Attack a walker does not provoke', () => {
  /**
   * "The deer doesn't provoke an Opportunity Attack when it moves out of an
   * enemy's reach." SRD Flyby with one word changed, and the word is the whole
   * rule: the gargoyle keeps its Reaction against a walker and the deer never
   * gives one.
   */
  it('offers nobody a swing when the holder walks out of reach', () => {
    const log = field('deer', id('deer'));
    const moved = unwrap(resolveMove(at(log), id('deer'), away('walk'), supply()), 'walking');
    expect(provokedIn(moved)).toEqual([]);
  });

  it('gives the same freedom to the other block that prints it', () => {
    const log = field('rat', id('rat'));
    const moved = unwrap(resolveMove(at(log), id('rat'), away('walk'), supply()), 'walking');
    expect(provokedIn(moved)).toEqual([]);
  });

  /**
   * And the narrower sentence stays narrow: a gargoyle's Flyby is about
   * flying, so the same creature on foot provokes exactly as it always did.
   * Without this the two kinds would have collapsed into one.
   */
  it('leaves SRD Flyby saying only what it says', () => {
    const log = field('gargoyle', id('gargoyle'));
    const moved = unwrap(resolveMove(at(log), id('gargoyle'), away('walk'), supply()), 'walking');
    expect(provokedIn(moved)).toEqual([WATCHER]);
  });
});

describe('SRD Running Leap: the jump the ten feet buys', () => {
  /**
   * A lion is Large, so the watcher stands clear of the space it fills — and
   * the fight is left out, because a Speed is not what is being measured here.
   * `field` pins every combatant at thirty feet, and a creature that has paid
   * ten for its run-up cannot then spend twenty-five: the refusal would be
   * `not_enough_movement` and would prove nothing about the jump. Outside
   * combat the running start is reported as unchecked and the distance is
   * still bounded, which is precisely the bound this sentence sets.
   */
  const lionsField = (): GameEvent[] =>
    field('lion', id('lion'), 15).filter((event) => event.type !== 'combat-started');

  const leaps = (feet: number, running: boolean) =>
    resolveMove(
      at(lionsField()),
      id('lion'),
      {
        placement: { from: { landmark: 'the stone' }, feet, bearing: 270 },
        jump: { kind: 'long', ...(running ? { running: true } : {}) },
      },
      supply(),
    );

  /**
   * "With a 10-foot running start, the lion can Long Jump up to 25 feet." A
   * lion has Strength 17, so the jump the sheet computes is seventeen feet and
   * the printed one is the longer of the two — which is what "up to 25 feet"
   * says.
   */
  it('lets the lion clear the twenty-five feet its block prints', () => {
    const jumped = unwrap(leaps(25, true), 'the leap');
    expect(jumped.feet).toBe(25);
  });

  it('still refuses a leap past the printed distance', () => {
    const over = leaps(30, true);
    expect(isErr(over) && over.code).toBe('jump_too_far');
  });

  /**
   * And the running start is still required, which is the half of the sentence
   * that is not the distance: the lion standing still is measured against its
   * own legs, which carry it eight feet and no further.
   */
  it('gives the standing lion nothing the sentence did not print', () => {
    expect(isErr(leaps(25, false)) && (leaps(25, false) as { code: string }).code).toBe(
      'jump_too_far',
    );
    expect(unwrap(leaps(5, false), 'a standing hop').feet).toBe(5);
  });
});

describe('SRD Aura of Authority: a printed aura worn by a stat block', () => {
  const CAPTAIN = id('captain');
  const NEAR = id('near');
  const FAR = id('far');

  /**
   * A captain with two of its own within ten feet and fifteen, and an enemy
   * beside it. Sides are declared because "its allies" is a declared fact and
   * an undeclared one is nobody's ally.
   */
  const warband = (): GameEvent[] => {
    const log: GameEvent[] = [];
    const state = (): GameState => fold(SEED, log);
    const add = (who: CharacterId, block: string): void => {
      log.push(...unwrap(addCreature(state(), SRD_CONTENT, who, block), block).events);
    };
    const step = (what: string, produce: () => ReturnType<typeof declareCreatureSide>): void => {
      log.push(...unwrap(produce(), what));
    };

    add(CAPTAIN, 'hobgoblin-captain');
    add(NEAR, 'hobgoblin-warrior');
    add(FAR, 'hobgoblin-warrior');
    add(WATCHER, 'goblin-warrior');
    for (const who of [CAPTAIN, NEAR, FAR]) {
      step(`${who} takes a side`, () => declareCreatureSide(state(), who, 'monsters'));
    }
    step('the watcher takes the other', () => declareCreatureSide(state(), WATCHER, 'party'));
    step('the field', () => setScene(state(), { width: 400, depth: 400, height: 200 }));
    step('a stone on it', () => addSceneLandmark(state(), 'the stone', { x: 100, y: 100, z: 0 }));
    step('the captain on the stone', () =>
      placeCreatureInScene(state(), CAPTAIN, { from: { landmark: 'the stone' }, feet: 0 }),
    );
    step('one of its own within the emanation', () =>
      placeCreatureInScene(state(), NEAR, { from: { creature: CAPTAIN }, feet: 10, bearing: 90 }),
    );
    step('and one outside it', () =>
      placeCreatureInScene(state(), FAR, { from: { creature: CAPTAIN }, feet: 15, bearing: 270 }),
    );
    step('the enemy beside the captain', () =>
      placeCreatureInScene(state(), WATCHER, { from: { creature: CAPTAIN }, feet: 5, bearing: 180 }),
    );
    return log;
  };

  const savesWith = (state: GameState, who: CharacterId): readonly string[] =>
    rollModesFor(state, { roller: who, family: 'saving-throw' }).modes.map((mode) => mode.source);

  /**
   * "While in a 10-foot Emanation originating from the hobgoblin, the
   * hobgoblin and its allies have Advantage on attack rolls and saving throws."
   * Ten feet is inside; fifteen is not.
   */
  it('reaches an ally inside the emanation and not one outside it', () => {
    const state = at(warband());
    expect(savesWith(state, NEAR)).toEqual(['Aura of Authority']);
    expect(savesWith(state, FAR)).toEqual([]);
  });

  /** "the hobgoblin **and** its allies" — the holder is inside its own aura. */
  it('reaches the captain itself', () => {
    expect(savesWith(at(warband()), CAPTAIN)).toEqual(['Aura of Authority']);
  });

  /** And never an enemy standing in it, however close. */
  it('reaches nobody on the other side', () => {
    expect(savesWith(at(warband()), WATCHER)).toEqual([]);
  });

  /**
   * "provided the hobgoblin doesn't have the Incapacitated condition" — the
   * clause the parser refuses to read away, and the requirement the engine
   * already had for it.
   */
  it('gives nobody anything while the captain is Incapacitated', () => {
    const log = warband();
    log.push({
      type: 'condition-applied',
      id: CAPTAIN,
      condition: 'incapacitated',
      source: 'the test',
    });
    const state = at(log);
    expect(savesWith(state, NEAR)).toEqual([]);
    expect(savesWith(state, CAPTAIN)).toEqual([]);
  });
});

describe('SRD Blood Frenzy: Advantage read off the creature being swung at', () => {
  const SAHUAGIN = id('sahuagin');

  const swingsWith = (state: GameState, at_: CharacterId): readonly string[] =>
    rollModesFor(state, { roller: SAHUAGIN, against: at_, family: 'attack' }).modes.map(
      (mode) => mode.source,
    );

  const hurt = (log: readonly GameEvent[], who: CharacterId, amount: number): GameState =>
    fold(SEED, [...log, { type: 'damage-taken', id: who, amount }]);

  /**
   * "The sahuagin has Advantage on attack rolls against any creature that
   * doesn't have all its Hit Points." One point short is enough — which is the
   * difference between this sentence and SRD Bloodied Fury, printed a page
   * apart.
   */
  it('gives Advantage against a creature one point short of its maximum', () => {
    const log = field('sahuagin-warrior', SAHUAGIN);
    expect(swingsWith(at(log), WATCHER)).toEqual([]);
    expect(swingsWith(hurt(log, WATCHER, 1), WATCHER)).toEqual(['Blood Frenzy']);
  });

  /**
   * And the Hit Points read are the **target's**. A wounded sahuagin swinging
   * at an unhurt goblin gets nothing, which is what tells this rule from the
   * one it shares nine words with.
   */
  it('reads the target and never the holder', () => {
    const log = field('sahuagin-warrior', SAHUAGIN);
    expect(swingsWith(hurt(log, SAHUAGIN, 5), WATCHER)).toEqual([]);
  });

  /** A block that prints no such sentence swings flat at a bleeding enemy. */
  it('gives a block that prints no such sentence nothing', () => {
    const log = field('bandit', id('bandit'));
    expect(
      rollModesFor(hurt(log, WATCHER, 1), {
        roller: id('bandit'),
        against: WATCHER,
        family: 'attack',
      }).modes,
    ).toEqual([]);
  });
});

describe('SRD Siege Monster: double damage to a thing that can be broken', () => {
  const ELEMENTAL = id('elemental');
  const DOOR = id('the oak door');

  /** The elemental, a goblin and a door, with nothing else in the room. */
  const quarry = (block = 'earth-elemental'): GameEvent[] => {
    const log: GameEvent[] = [];
    const state = (): GameState => fold(SEED, log);
    log.push(...unwrap(addCreature(state(), SRD_CONTENT, ELEMENTAL, block), block).events);
    log.push(
      ...unwrap(addCreature(state(), SRD_CONTENT, WATCHER, 'goblin-warrior'), 'a goblin').events,
    );
    log.push(
      ...unwrap(
        declareObject(state(), SRD_CONTENT, DOOR, {
          name: 'the oak door',
          material: 'wood',
          size: 'medium',
          build: 'resilient',
        }),
        'the door',
      ),
    );
    return log;
  };

  const hits = (state: GameState, victim: CharacterId, by: CharacterId): number =>
    unwrap(
      dealSpellDamage(
        state,
        victim,
        [{ source: 'a slam', type: 'bludgeoning', roll: null, flat: 10, total: 10 }],
        'a slam',
        supply(),
        { by },
      ),
      'the blow',
    ).amount;

  /**
   * "The elemental deals double damage to objects and structures." An
   * adjustment in SRD's own order — "multipliers are applied first" — so it is
   * the same seam a ward's reduction goes through.
   */
  it('doubles what the holder deals to a declared object', () => {
    expect(hits(at(quarry()), DOOR, ELEMENTAL)).toBe(20);
  });

  it('leaves what the holder deals to a creature alone', () => {
    expect(hits(at(quarry()), WATCHER, ELEMENTAL)).toBe(10);
  });

  /** And a block that prints no such sentence breaks a door at the usual rate. */
  it('gives a block that prints no such sentence nothing', () => {
    expect(hits(at(quarry('ogre')), DOOR, ELEMENTAL)).toBe(10);
  });

  /** A blow nobody dealt is nobody's doubling. */
  it('doubles nothing where no dealer was recorded', () => {
    const state = at(quarry());
    expect(
      unwrap(
        dealSpellDamage(
          state,
          DOOR,
          [{ source: 'a slam', type: 'bludgeoning', roll: null, flat: 10, total: 10 }],
          'a falling rock',
          supply(),
          {},
        ),
        'the rock',
      ).amount,
    ).toBe(10);
  });
});

describe('SRD Aberrant Ground: Difficult Terrain derived from where a creature stands', () => {
  const MOUTHER = id('mouther');
  const MOVER = id('mover');

  /**
   * The mouther on the stone and a walker beside it, both placed and on
   * opposite sides, in a fight so that the move has a budget to be charged
   * against.
   */
  const around = (block = 'gibbering-mouther'): GameEvent[] => {
    const log: GameEvent[] = [];
    const state = (): GameState => fold(SEED, log);
    const step = (what: string, produce: () => ReturnType<typeof declareCreatureSide>): void => {
      log.push(...unwrap(produce(), what));
    };

    log.push(...unwrap(addCreature(state(), SRD_CONTENT, MOUTHER, block), block).events);
    log.push(
      ...unwrap(addCreature(state(), SRD_CONTENT, MOVER, 'goblin-warrior'), 'the walker').events,
    );
    step('the mouther takes a side', () => declareCreatureSide(state(), MOUTHER, 'monsters'));
    step('the walker takes the other', () => declareCreatureSide(state(), MOVER, 'party'));
    step('the field', () => setScene(state(), { width: 400, depth: 400, height: 200 }));
    step('a stone on it', () => addSceneLandmark(state(), 'the stone', { x: 100, y: 100, z: 0 }));
    step('the mouther on the stone', () =>
      placeCreatureInScene(state(), MOUTHER, { from: { landmark: 'the stone' }, feet: 0 }),
    );
    // Measured from the stone rather than from the mouther, so that a variant
    // which never places the mouther still has somewhere to put the walker.
    step('the walker beside it', () =>
      placeCreatureInScene(state(), MOVER, { from: { landmark: 'the stone' }, feet: 5, bearing: 90 }),
    );
    log.push({
      type: 'combat-started',
      combatants: [
        { id: MOVER, initiative: 20, speed: 30 },
        { id: MOUTHER, initiative: 5, speed: 20 },
      ],
    });
    return log;
  };

  /** What five feet across the ground beside the mouther cost. */
  const stepsAside = (log: readonly GameEvent[]): number =>
    unwrap(
      resolveMove(
        at(log),
        MOVER,
        { placement: { from: { creature: MOVER }, feet: 5, bearing: 0 } },
        supply(),
      ),
      'the step',
    ).cost;

  /**
   * "The ground in a 10-foot Emanation originating from the mouther is
   * Difficult Terrain." Every foot in it costs an extra foot, and the space
   * the walker crosses is inside it.
   */
  it('charges an extra foot for every foot in the emanation', () => {
    expect(stepsAside(around())).toBe(10);
  });

  /**
   * And the emanation **moves when the creature does**, which is why it is
   * derived rather than declared: the same step over the same ground is
   * ordinary once the mouther has walked away. There is no event that took a
   * patch off, because there was never a patch to take.
   */
  it('stops charging where the holder has gone', () => {
    const log = around();
    log.push(
      ...unwrap(
        resolveMove(
          at(log),
          MOUTHER,
          // Shoved rather than walked, because it is not the mouther's turn
          // and whose turn it is has nothing to do with what the ground costs.
          { placement: { from: { creature: MOUTHER }, feet: 30, bearing: 180 }, forced: true },
          supply(),
        ),
        'the mouther leaving',
      ).events,
    );
    expect(stepsAside(log)).toBe(5);
  });

  /** And a block that prints no such sentence drags nothing behind it. */
  it('charges nothing extra around a block that prints no such sentence', () => {
    expect(stepsAside(around('bandit'))).toBe(5);
  });

  /** A creature nobody has placed has no ground to make difficult. */
  it('makes nothing difficult for a holder nobody has placed', () => {
    const log = around().filter(
      (event) => !(event.type === 'creature-placed' && event.id === MOUTHER),
    );
    expect(stepsAside(log)).toBe(5);
  });
});

describe('a trait a damage type sets off', () => {
  const GOLEM = id('golem');

  /** The golem, hurt enough that a heal has somewhere to go. */
  const golemAt = (missing: number, block = 'flesh-golem'): GameEvent[] => {
    const log = field(block, GOLEM, 15);
    return missing === 0 ? log : [...log, { type: 'damage-taken', id: GOLEM, amount: missing }];
  };

  const hp = (state: GameState): number => state.creatures[GOLEM]!.vitals.hp;

  const burn = (log: readonly GameEvent[], type: string, total: number) =>
    dealSpellDamage(
      at(log),
      GOLEM,
      [{ source: 'a bolt', type, roll: null, flat: total, total }],
      'a bolt',
      supply(),
      { by: WATCHER },
    );

  /**
   * SRD Lightning Absorption: "Whenever the golem is subjected to Lightning
   * damage, it regains a number of Hit Points equal to the Lightning damage
   * dealt." Both blocks that print it are **immune** to the type, so the
   * amount read after Immunity would always be nought and the trait would be
   * dead text — the amount is what was rolled at it, and none of it lands.
   */
  it('regains what the blow rolled and takes none of it', () => {
    const log = golemAt(20);
    const struck = unwrap(burn(log, 'lightning', 11), 'the bolt');
    expect(struck.amount).toBe(0);
    expect(hp(fold(SEED, [...log, ...struck.events]))).toBe(hp(at(log)) + 11);
  });

  /** And never past its maximum, which is what a heal has always done. */
  it('heals no further than the maximum', () => {
    const log = golemAt(3);
    const struck = unwrap(burn(log, 'lightning', 11), 'the bolt');
    const after = fold(SEED, [...log, ...struck.events]);
    expect(after.creatures[GOLEM]!.vitals.hp).toBe(after.creatures[GOLEM]!.vitals.hpMax);
  });

  /** A type the sentence does not name is an ordinary blow. */
  it('absorbs only the type its sentence names', () => {
    const log = golemAt(20);
    const struck = unwrap(burn(log, 'fire', 11), 'the flame');
    expect(struck.amount).toBe(11);
    expect(hp(fold(SEED, [...log, ...struck.events]))).toBe(hp(at(log)) - 11);
  });

  /**
   * SRD Aversion to Fire: "If the golem takes Fire damage, it has Disadvantage
   * on attack rolls and ability checks until the end of its next turn." The
   * same trigger with a penalty on the other end of it.
   */
  it('hangs the Disadvantage the fire buys', () => {
    const log = golemAt(20);
    const struck = unwrap(burn(log, 'fire', 11), 'the flame');
    const after = fold(SEED, [...log, ...struck.events]);
    // Named for the rule rather than for the heading, because a sheet's
    // `stated.traits` carries the shapes the parser read and not the headings
    // they were printed under — see `printedTypeTriggers`.
    const rule = `printed:${GOLEM}:Disadvantage after fire damage`;
    expect(
      rollModesFor(after, { roller: GOLEM, against: WATCHER, family: 'attack' }).modes,
    ).toEqual([{ source: rule, mode: 'disadvantage' }]);
    expect(
      rollModesFor(after, { roller: GOLEM, family: 'ability-check' }).modes.map((m) => m.source),
    ).toEqual([rule]);
    // The sentence names two rolls and not three.
    expect(rollModesFor(after, { roller: GOLEM, family: 'saving-throw' }).modes).toEqual([]);
  });

  /**
   * "until the end of its next turn" — a moment in the turn order, which the
   * timer beside the grant ends. The golem's turn ending once is not it: the
   * sentence says its **next** turn, so the Disadvantage survives the end of
   * the turn it was hung on and lapses at the end of the one after.
   */
  it('lifts the Disadvantage at the end of the golem’s next turn', () => {
    const log = golemAt(20);
    const struck = unwrap(burn(log, 'fire', 11), 'the flame');
    const hung = [...log, ...struck.events];
    const checks = (events: readonly GameEvent[]): number =>
      rollModesFor(fold(SEED, events), { roller: GOLEM, family: 'ability-check' }).modes.length;

    expect(checks(hung)).toBe(1);
    // Two turns pass — the watcher's and the golem's own — and the deadline is
    // the end of the second of them.
    const turned = [
      ...hung,
      { type: 'turn-advanced' as const, ended: GOLEM, begun: WATCHER },
      { type: 'turn-advanced' as const, ended: WATCHER, begun: GOLEM },
      { type: 'turn-advanced' as const, ended: GOLEM, begun: WATCHER },
    ];
    expect(checks(turned)).toBe(0);
  });

  /** And a type the sentence does not name hangs nothing. */
  it('hangs nothing for a type its sentence does not name', () => {
    const log = golemAt(20);
    const struck = unwrap(burn(log, 'cold', 11), 'the frost');
    const after = fold(SEED, [...log, ...struck.events]);
    expect(rollModesFor(after, { roller: GOLEM, family: 'ability-check' }).modes).toEqual([]);
  });

  /**
   * SRD Freeze: "If the elemental takes Cold damage, its Speed decreases by
   * 20 feet until the end of its next turn." The same trigger and the same
   * span with a Speed on the end of it.
   */
  it('cuts the Speed the cold costs, and gives it back', () => {
    const log = golemAt(0, 'water-elemental');
    const before = speedOf(at(log), GOLEM);
    const struck = unwrap(burn(log, 'cold', 7), 'the frost');
    const cut = [...log, ...struck.events];
    expect(speedOf(at(cut), GOLEM)).toBe(before - 20);

    const turned = [
      ...cut,
      { type: 'turn-advanced' as const, ended: GOLEM, begun: WATCHER },
      { type: 'turn-advanced' as const, ended: WATCHER, begun: GOLEM },
      { type: 'turn-advanced' as const, ended: GOLEM, begun: WATCHER },
    ];
    expect(speedOf(at(turned), GOLEM)).toBe(before);
  });

  it('cuts nothing for a type its sentence does not name', () => {
    const log = golemAt(0, 'water-elemental');
    const struck = unwrap(burn(log, 'fire', 7), 'the flame');
    expect(speedOf(at([...log, ...struck.events]), GOLEM)).toBe(speedOf(at(log), GOLEM));
  });

  /** A block that prints neither sentence is burnt and healed by nothing. */
  it('gives a block that prints neither sentence nothing', () => {
    const log = golemAt(20, 'ogre');
    const struck = unwrap(burn(log, 'lightning', 11), 'the bolt');
    expect(struck.amount).toBe(11);
    const after = fold(SEED, [...log, ...struck.events]);
    expect(rollModesFor(after, { roller: GOLEM, family: 'ability-check' }).modes).toEqual([]);
  });
});

describe('SRD Fire Aura and SRD Barbed Hide: what a stat block owes at a boundary', () => {
  const AZER = id('azer');
  const GOBLIN_A = id('goblin-a');
  const GOBLIN_B = id('goblin-b');
  const FRIEND = id('friend');

  /**
   * An azer with two goblins and a friend all within its five feet, and the
   * azer going first so that ending its turn is what the test does.
   */
  const around = (block = 'azer-sentinel'): GameEvent[] => {
    const log: GameEvent[] = [];
    const state = (): GameState => fold(SEED, log);
    const add = (who: CharacterId, id_: string): void => {
      log.push(...unwrap(addCreature(state(), SRD_CONTENT, who, id_), id_).events);
    };
    const step = (what: string, produce: () => ReturnType<typeof declareCreatureSide>): void => {
      log.push(...unwrap(produce(), what));
    };

    add(AZER, block);
    add(GOBLIN_A, 'goblin-warrior');
    add(GOBLIN_B, 'goblin-warrior');
    add(FRIEND, 'goblin-warrior');
    step('the azer takes a side', () => declareCreatureSide(state(), AZER, 'monsters'));
    for (const who of [GOBLIN_A, GOBLIN_B, FRIEND]) {
      step(`${who} takes the other`, () => declareCreatureSide(state(), who, 'party'));
    }
    step('the field', () => setScene(state(), { width: 400, depth: 400, height: 200 }));
    step('a stone on it', () => addSceneLandmark(state(), 'the stone', { x: 100, y: 100, z: 0 }));
    step('the azer on the stone', () =>
      placeCreatureInScene(state(), AZER, { from: { landmark: 'the stone' }, feet: 0 }),
    );
    const bearings = { [GOBLIN_A]: 0, [GOBLIN_B]: 90, [FRIEND]: 180 } as Record<string, number>;
    for (const who of [GOBLIN_A, GOBLIN_B, FRIEND]) {
      step(`${who} beside it`, () =>
        placeCreatureInScene(state(), who, {
          from: { landmark: 'the stone' },
          feet: 5,
          bearing: bearings[who]!,
        }),
      );
    }
    log.push({
      type: 'combat-started',
      combatants: [
        { id: AZER, initiative: 20, speed: 30 },
        { id: GOBLIN_A, initiative: 15, speed: 30 },
        { id: GOBLIN_B, initiative: 10, speed: 30 },
        { id: FRIEND, initiative: 5, speed: 30 },
      ],
    });
    return log;
  };

  /** How much each creature lost when the azer's turn ended. */
  const burnt = (log: readonly GameEvent[], burns?: readonly CharacterId[]): Record<string, number> => {
    const before = at(log);
    const turned = unwrap(
      resolveTurn(before, supply(), burns === undefined ? {} : { burns }),
      'the turn',
    );
    const after = fold(SEED, [...log, ...turned.events]);
    const lost: Record<string, number> = {};
    for (const who of [AZER, GOBLIN_A, GOBLIN_B, FRIEND]) {
      lost[who] = before.creatures[who]!.vitals.hp - after.creatures[who]!.vitals.hp;
    }
    return lost;
  };

  /**
   * "At the end of each of the azer's turns, each creature of the azer's
   * choice in a 5-foot Emanation originating from the azer takes 5 (1d10) Fire
   * damage." The choice is the DM's and the engine never makes it.
   */
  it('burns the creatures the table named and nobody else', () => {
    const lost = burnt(around(), [GOBLIN_A, GOBLIN_B]);
    expect(lost[GOBLIN_A]).toBeGreaterThan(0);
    expect(lost[GOBLIN_B]).toBeGreaterThan(0);
    expect(lost[FRIEND]).toBe(0);
    // SRD: an Emanation "ignores the creature it originates from".
    expect(lost[AZER]).toBe(0);
  });

  /**
   * **And an answer that names nobody burns nobody**, which is the only safe
   * default: picking for the DM would be the engine playing somebody's azer.
   */
  it('burns nobody where the table named nobody', () => {
    const lost = burnt(around());
    expect(lost[GOBLIN_A]).toBe(0);
    expect(lost[GOBLIN_B]).toBe(0);
  });

  /** "unless the azer has the Incapacitated condition." */
  it('burns nobody while the azer is Incapacitated', () => {
    const log = [
      ...around(),
      {
        type: 'condition-applied' as const,
        id: AZER,
        condition: 'incapacitated' as const,
        source: 'the test',
      },
    ];
    expect(burnt(log, [GOBLIN_A, GOBLIN_B])[GOBLIN_A]).toBe(0);
  });

  /** A block that prints no such sentence burns nobody however it is asked. */
  it('burns nobody for a block that prints no such sentence', () => {
    expect(burnt(around('bandit'), [GOBLIN_A, GOBLIN_B])[GOBLIN_A]).toBe(0);
  });

  /**
   * And a boundary asked to advance with no generator refuses rather than
   * skipping the aura — the fourth member of the family `payout_owed`,
   * `damage_owed`, `death_save_owed` and `recharge_owed` already belong to.
   * Forgetting a rule has to stop the game rather than quietly drop it.
   */
  it('refuses to advance without a generator to roll the aura', () => {
    const refused = resolveTurn(at(around()), undefined, { burns: [GOBLIN_A] });
    expect(isErr(refused) && refused.code).toBe('boundary_damage_owed');
  });
});

describe('SRD Barbed Hide: the damage a hold owes at the start of a turn', () => {
  const DEVIL = id('devil');
  const FIGHTER = id('fighter');

  /**
   * A devil grappling a fighter, with the fighter's turn about to end so that
   * the devil's is the one that begins.
   */
  const holding = (block = 'barbed-devil'): GameEvent[] => {
    const log: GameEvent[] = [];
    const state = (): GameState => fold(SEED, log);
    const add = (who: CharacterId, id_: string): void => {
      log.push(...unwrap(addCreature(state(), SRD_CONTENT, who, id_), id_).events);
    };

    add(DEVIL, block);
    add(FIGHTER, 'goblin-warrior');
    log.push(
      ...unwrap(declareCreatureSide(state(), DEVIL, 'monsters'), 'a side'),
      ...unwrap(declareCreatureSide(state(), FIGHTER, 'party'), 'the other'),
      {
        type: 'condition-applied',
        id: FIGHTER,
        condition: 'grappled',
        source: `grapple:${DEVIL}`,
      },
      {
        type: 'combat-started',
        combatants: [
          { id: FIGHTER, initiative: 20, speed: 30 },
          { id: DEVIL, initiative: 5, speed: 30 },
        ],
      },
    );
    return log;
  };

  const hurtAtTheStart = (log: readonly GameEvent[]): number => {
    const before = at(log);
    const turned = unwrap(resolveTurn(before, supply()), 'the turn');
    const after = fold(SEED, [...log, ...turned.events]);
    return before.creatures[FIGHTER]!.vitals.hp - after.creatures[FIGHTER]!.vitals.hp;
  };

  /**
   * "At the start of each of its turns, the devil deals 5 (1d10) Piercing
   * damage to any creature it is grappling or any creature grappling it." No
   * choice, no feet, and the hold is the whole of the reach.
   */
  it('hurts the creature it is holding when its turn begins', () => {
    expect(hurtAtTheStart(holding())).toBeGreaterThan(0);
  });

  /** And nobody at all where there is no hold. */
  it('hurts nobody where nothing is held', () => {
    const loose = holding().filter(
      (event) => !(event.type === 'condition-applied' && event.condition === 'grappled'),
    );
    expect(hurtAtTheStart(loose)).toBe(0);
  });

  /** And a block that prints no such sentence hurts nobody it is holding. */
  it('hurts nobody for a block that prints no such sentence', () => {
    expect(hurtAtTheStart(holding('bandit'))).toBe(0);
  });
});

describe('SRD Blurred Form: a mode on the rolls made against its holder', () => {
  const MEPHIT = id('mephit');

  const swungAt = (state: GameState): readonly string[] =>
    rollModesFor(state, { roller: WATCHER, against: MEPHIT, family: 'attack' }).modes.map(
      (mode) => mode.source,
    );

  /**
   * "Attack rolls against the mephit are made with Disadvantage unless the
   * mephit has the Incapacitated condition." The first printed trait whose
   * mode sits at the other end of the blow.
   */
  it('gives the attacker Disadvantage and the mephit nothing', () => {
    const log = field('steam-mephit', MEPHIT);
    expect(swungAt(at(log))).toEqual(['Blurred Form']);
    // And it is a rule about rolls *against* it, not about its own.
    expect(
      rollModesFor(at(log), { roller: MEPHIT, against: WATCHER, family: 'attack' }).modes,
    ).toEqual([]);
  });

  /** The gate is the sentence's last clause, and it is read on every roll. */
  it('gives nobody anything while the mephit is Incapacitated', () => {
    const log = [
      ...field('steam-mephit', MEPHIT),
      {
        type: 'condition-applied' as const,
        id: MEPHIT,
        condition: 'incapacitated' as const,
        source: 'the test',
      },
    ];
    expect(swungAt(at(log))).toEqual([]);
  });
});

describe('SRD Beast of Burden: SRD Powerful Build on a stat block', () => {
  const MULE = id('mule');

  /**
   * "The mule counts as one size larger for the purpose of determining its
   * carrying capacity." A Large row off a Medium creature, which is the grant
   * `capacitySizeOf` has read since the Goliath's own line landed.
   */
  it('reads the mule’s capacity a row up from the size it is', () => {
    const mule = at(field('mule', MULE));
    const strength = mule.creatures[MULE]!.sheet.abilities.str;

    // Still Medium: the sentence is about this table and about nothing else.
    expect(mule.creatures[MULE]!.size).toBe('medium');
    // SRD: a Medium creature carries 15 pounds per point of Strength and a
    // Large one twice that, so the step is the doubling and nothing else.
    expect(carryingCapacity(mule, MULE).carry).toBe(strength * 15 * 2);

    // Not vacuous: a Medium block that prints no such sentence reads its own
    // row. The pony is the same size and the same shape of creature.
    const pony = at(field('pony', id('pony')));
    const ponyStrength = pony.creatures[id('pony')]!.sheet.abilities.str;
    expect(carryingCapacity(pony, id('pony')).carry).toBe(ponyStrength * 15);
  });
});

/**
 * The same two sentences, on the road a Reaction held open.
 *
 * `siegeDoubling` and `printedTypeTriggers` were written into
 * `dealSpellDamage`, which is one road of two: the other is a blow somebody
 * may answer, which `landDamage` holds open at the `damage-rolled` window and
 * `settleDamage` closes. And the window is not offered off the *target's* own
 * Reactions — `offersForDamage` walks every creature — so a Bard sixty feet
 * away holding Cutting Words was enough to cost an Earth Elemental its
 * doubling and a Flesh Golem its absorption.
 *
 * So the Bard is the whole fixture. She answers nothing and is asked nothing;
 * her being in the room is what opens the window, and what these tests claim
 * is that a printed sentence reads the same on either road.
 */
describe('a printed sentence on the road a Reaction held open', () => {
  const GOLEM = id('golem');
  const WISP = id('wisp');
  const ELEMENTAL = id('elemental');
  const DOOR = id('the oak door');
  const ILVA = id('ilva');

  /**
   * A College of Lore Bard at 3rd level, the level Cutting Words is printed
   * at. Her cantrips and prepared spells are read off the class's own table
   * rather than transcribed, so the fixture does not break the day a row is
   * corrected.
   */
  const bard = (): CharacterChoices => {
    const definition = SRD_CONTENT.classes.find((c) => c.id === 'bard')!;
    const row = unwrap(rowAt(definition, 3), 'the bard’s third row');
    const cap = Math.max(...Object.keys(slotsAt(definition, 3)).map(Number));
    const list = spellsForClass('bard');
    const named = (from: number, to: number, howMany: number): string[] =>
      list
        .filter((sp) => sp.level >= from && sp.level <= to)
        .map((sp) => sp.id)
        .sort()
        .slice(0, howMany);

    return {
      name: 'Ilva',
      classId: 'bard',
      level: 3,
      subclassId: 'college-of-lore',
      speciesId: 'human',
      backgroundId: 'sage',
      abilities: {
        method: 'manual',
        assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 15 },
      },
      abilityIncreases: { con: 2, int: 1 },
      classSkills: ['persuasion', 'performance', 'deception'],
      languages: ['Dwarvish', 'Orc'],
      alignment: 'Neutral',
      cantrips: named(0, 0, row.cantripsKnown ?? 0),
      spellbook: [],
      preparedSpells: named(1, cap, row.preparedSpells ?? 0),
      classEquipment: 'A',
      backgroundEquipment: 'A',
      equipped: [],
      hitPoints: { method: 'fixed' },
      featureChoices: {
        'human:skillful': ['perception'],
        'college-of-lore:bonus-proficiencies': ['arcana', 'history', 'insight'],
        'bard:expertise': ['persuasion', 'performance'],
      },
      feats: {
        'sage:magic-initiate-wizard': {
          featId: 'magic-initiate',
          spellList: 'wizard',
          spellcastingAbility: 'int',
          cantrips: ['mage-hand', 'light'],
          levelOneSpell: 'ray-of-sickness',
        },
        'human:versatile': { featId: 'alert' },
      },
      dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    };
  };

  /**
   * The holder, what it is about to hit, and — where the test asks for her — a
   * Bard thirty feet away, all in one fight.
   *
   * The Bard is in the order because Cutting Words costs a Reaction and a
   * creature outside the order has no budget to spend one from: a window
   * nobody can afford is a window that never opens, which is what makes the
   * unheld control of each pair a control rather than a coincidence.
   */
  const room = (
    holder: CharacterId,
    block: string,
    victim: CharacterId,
    options: { readonly bard?: boolean; readonly object?: boolean } = {},
  ): GameEvent[] => {
    const log: GameEvent[] = [];
    const state = (): GameState => fold(SEED, log);
    const step = (what: string, produce: () => ReturnType<typeof declareCreatureSide>): void => {
      log.push(...unwrap(produce(), what));
    };

    log.push(...unwrap(addCreature(state(), SRD_CONTENT, holder, block), block).events);
    if (options.object === true) {
      step('the door', () =>
        declareObject(state(), SRD_CONTENT, victim, {
          name: 'the oak door',
          material: 'wood',
          size: 'medium',
          build: 'resilient',
        }),
      );
    } else {
      log.push(
        ...unwrap(addCreature(state(), SRD_CONTENT, victim, 'flesh-golem'), 'the golem').events,
      );
      step('the victim’s side', () => declareCreatureSide(state(), victim, 'party'));
    }
    if (options.bard === true) {
      step('Ilva arrives', () => createCharacter(SRD_CONTENT, bard(), ILVA));
    }

    step('the holder takes a side', () => declareCreatureSide(state(), holder, 'monsters'));
    step('the field', () => setScene(state(), { width: 400, depth: 400, height: 200 }));
    step('a stone on it', () => addSceneLandmark(state(), 'the stone', { x: 100, y: 100, z: 0 }));
    step('the holder on the stone', () =>
      placeCreatureInScene(state(), holder, { from: { landmark: 'the stone' }, feet: 0 }),
    );
    // Inside the reach the line prints, and — where the holder is Large and
    // its own space is ten feet across — outside the space it is standing in.
    step('the victim beside it', () =>
      placeCreatureInScene(state(), victim, {
        from: { landmark: 'the stone' },
        feet: options.object === true ? 10 : 5,
        bearing: 90,
      }),
    );
    if (options.bard === true) {
      step('Ilva’s side', () => declareCreatureSide(state(), ILVA, 'party'));
      step('Ilva across the room', () =>
        placeCreatureInScene(state(), ILVA, {
          from: { landmark: 'the stone' },
          feet: 30,
          bearing: 270,
        }),
      );
    }

    log.push({
      type: 'combat-started',
      combatants: [
        { id: holder, initiative: 20, speed: 30 },
        ...(options.object === true ? [] : [{ id: victim, initiative: 10, speed: 30 }]),
        ...(options.bard === true ? [{ id: ILVA, initiative: 5, speed: 30 }] : []),
      ],
    });
    return log;
  };

  /** Seeds enough that one of them lands the printed swing. */
  const SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  interface Blow {
    readonly before: GameState;
    readonly after: GameState;
    /** Whether somebody was offered the window, which is the road taken. */
    readonly held: boolean;
    /** What the blow rolled of each type, before anybody's defences. */
    readonly rolled: Readonly<Record<string, number>>;
    /**
     * What the blow dealt, off the event that recorded it.
     *
     * Read here rather than as a difference of Hit Points, because an object
     * with eighteen of them stops at nought: a door that took thirty-six is
     * eighteen points of Hit Points and a `damage-taken` of thirty-six, and it
     * is the second of those the doubling is a claim about.
     */
    readonly dealt: number;
  }

  /**
   * Swing a printed line until it connects, settle whatever window it opened,
   * and hand back the world on the far side of the blow.
   *
   * Both roads come out of here, which is the point: what the caller does
   * differs by one command and what the sentence is worth must not differ at
   * all.
   */
  const strike = (
    log: readonly GameEvent[],
    attacker: CharacterId,
    victim: CharacterId,
    line: string,
  ): Blow => {
    for (const seed of SEEDS) {
      const before = at(log);
      const swung = unwrap(
        resolveAttack(
          before,
          attacker,
          { target: victim, weapon: null, action: line, commandId: `swing-${seed}` },
          supply(seed),
        ),
        'the swing',
      );
      if (swung.attack?.hit !== true) continue;

      const world = fold(SEED, [...log, ...swung.events]);
      const pending = world.pendingDamage;
      // What the blow rolled, before anybody's defences: off the hold where
      // one was written, and off the dice the unheld road records otherwise.
      // The two are the same components by construction — see `landDamage`.
      const faces = swung.events.find((event) => event.type === 'damage-dice-recorded');
      const components =
        pending?.components ??
        (faces === undefined
          ? []
          : (faces as { readonly components: readonly { type: string; total: number }[] })
              .components);
      const rolled: Record<string, number> = {};
      for (const component of components) {
        rolled[component.type] = (rolled[component.type] ?? 0) + component.total;
      }
      const dealtIn = (events: readonly GameEvent[]): number =>
        events
          .filter((event) => event.type === 'damage-taken' && event.id === victim)
          .reduce((sum, event) => sum + (event as { readonly amount: number }).amount, 0);

      if (pending === null) {
        return { before, after: world, held: false, rolled, dealt: dealtIn(swung.events) };
      }

      const settled = unwrap(settleDamage(world, supply(`settle-${seed}`)), 'the settlement');
      return {
        before,
        after: fold(SEED, [...log, ...swung.events, ...settled.events]),
        held: true,
        rolled,
        dealt: dealtIn(settled.events),
      };
    }
    throw new Error(`no seed landed ${line}`);
  };

  const hp = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;

  /**
   * SRD Lightning Absorption on the held road. A Will-o'-Wisp's Shock is
   * Lightning and nothing else, and the golem is immune to it — so what the
   * sentence is worth is the whole of what the blow rolled, and a road that
   * skipped it would leave the golem exactly where it was.
   */
  it('heals the golem the lightning a blow the Bard held open rolled', () => {
    const hurt = [
      ...room(WISP, 'will-o-wisp', GOLEM, { bard: true }),
      { type: 'damage-taken' as const, id: GOLEM, amount: 30 },
    ];
    const struck = strike(hurt, WISP, GOLEM, 'Shock');

    // The Bard is what makes this the held road, and the claim below is
    // worthless without it.
    expect(struck.held).toBe(true);
    expect(struck.rolled['lightning']).toBeGreaterThan(0);
    expect(hp(struck.after, GOLEM)).toBe(hp(struck.before, GOLEM) + struck.rolled['lightning']!);
  });

  /** And the two roads agree: the same blow with nobody there to answer it. */
  it('heals the same lightning where nobody could hold the blow open', () => {
    const hurt = [
      ...room(WISP, 'will-o-wisp', GOLEM),
      { type: 'damage-taken' as const, id: GOLEM, amount: 30 },
    ];
    const struck = strike(hurt, WISP, GOLEM, 'Shock');
    expect(struck.held).toBe(false);
    expect(hp(struck.after, GOLEM)).toBe(hp(struck.before, GOLEM) + struck.rolled['lightning']!);
  });

  /**
   * SRD Siege Monster on the same road: "The elemental deals double damage to
   * objects and structures", which is an adjustment in SRD's own order and
   * therefore has to be made where the damage is applied — on either road.
   */
  it('doubles what the elemental deals a door through a window the Bard opened', () => {
    const log = room(ELEMENTAL, 'earth-elemental', DOOR, { bard: true, object: true });
    const struck = strike(log, ELEMENTAL, DOOR, 'Slam');
    expect(struck.held).toBe(true);
    expect(struck.dealt).toBe(struck.rolled['bludgeoning']! * 2);
  });

  /** And the unheld road, which has doubled it since the sentence was read. */
  it('doubles the same slam where nobody could hold it open', () => {
    const log = room(ELEMENTAL, 'earth-elemental', DOOR, { object: true });
    const struck = strike(log, ELEMENTAL, DOOR, 'Slam');
    expect(struck.held).toBe(false);
    expect(struck.dealt).toBe(struck.rolled['bludgeoning']! * 2);
  });
});
