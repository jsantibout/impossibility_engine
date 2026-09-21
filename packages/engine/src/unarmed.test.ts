import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, isNeedsContext, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import {
  availableChecks,
  escapeGrapple,
  grappleSource,
  grappleTarget,
  lapsedGrapples,
  liftConditionFrom,
  resolveEffectCheck,
  shoveTarget,
  UNARMED_REACH,
  whyCondition,
} from './commands.js';
import { conditionInstanceId, hasCondition } from './conditions.js';
import { distanceBetween } from './positioning.js';

/**
 * The Unarmed Strike's other two options.
 *
 * SRD 2024 prints three under one heading — Damage, Grapple, Shove — and only
 * the first of them was modelled. The two here are **not** attack rolls: each
 * is a saving throw the target makes against a fixed DC, which is the 2024
 * change that matters most, because the 2014 version was an opposed check and
 * porting that would put a roll on the grappler's side of the table that the
 * book does not give them.
 *
 * What they share with the Damage option is the *action*: all three are the
 * Attack action's one attack, so a Fighter with Extra Attack may grapple and
 * then punch. What they do not share is the roll — see the last block for the
 * decision that follows from that, and for the test that pins it.
 */

const id = (s: string) => asCharacterId(s);
const BRAM = id('bram'); // str 18, level 5: a DC of 8 + 4 + 3
const GOBLIN = id('goblin');
const OGRE = id('ogre'); // Large, one size up from Bram: grappleable
const GIANT = id('giant'); // Huge, two sizes up: not

/** SRD Unarmed Strike: "8 plus your Strength modifier and Proficiency Bonus". */
const DC = 15;

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const feeble = {
  abilities: { str: 8, dex: 10, con: 8, int: 10, wis: 8, cha: 8 },
};

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
  size?: 'small' | 'medium' | 'large' | 'huge',
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  ...(size === undefined ? {} : { size }),
});

const at = (
  who: CharacterId,
  from: CharacterId,
  feet: number,
  bearing: number,
  size?: 'small' | 'medium' | 'large' | 'huge',
): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: from }, feet, bearing, ...(size === undefined ? {} : { size }) },
});

const table = (): readonly GameEvent[] => [
  added(BRAM, 'party'),
  added(GOBLIN, 'goblins', feeble, 'small'),
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 500, y: 500, z: 0 } },
  { type: 'creature-placed', id: BRAM, placement: { from: { landmark: 'the road' }, feet: 0 } },
  at(GOBLIN, BRAM, 5, 90, 'small'),
];

const fighting = (): readonly GameEvent[] => [
  ...table(),
  {
    type: 'combat-started',
    combatants: [
      { id: BRAM, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

/** Bram, and one creature of a stated size standing in his reach. */
const facing = (who: CharacterId, size: 'large' | 'huge'): readonly GameEvent[] => [
  added(BRAM, 'party'),
  added(who, 'giants', feeble, size),
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 500, y: 500, z: 0 } },
  { type: 'creature-placed', id: BRAM, placement: { from: { landmark: 'the road' }, feet: 0 } },
  at(who, BRAM, 5, 90, size),
  {
    type: 'combat-started',
    combatants: [
      { id: BRAM, initiative: 20, speed: 30 },
      { id: who, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'grab') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * The first seed in a fixed sweep whose save lands the way this test is about.
 *
 * The engine rolls the die and the test finds a seed that produced the case it
 * is about; what is asserted afterwards is the consequence, which is static.
 * Asserting the face itself would be asserting the generator.
 */
const seedThat = (
  want: 'failed' | 'saved',
  log: readonly GameEvent[],
  run: (state: GameState, supplied: ReturnType<typeof supply>) => { readonly save: { readonly success: boolean } | null },
): string => {
  for (let n = 0; n < 80; n += 1) {
    const seed = `grab-${n}`;
    const out = run(fold('seed', log), supply(seed));
    if (out.save !== null && out.save.success === (want === 'saved')) return seed;
  }
  throw new Error(`no seed in the sweep produced a ${want} save`);
};

const grabbing = (log: readonly GameEvent[], seed: string, target = GOBLIN) =>
  unwrap(grappleTarget(fold('seed', log), BRAM, { target, save: 'dex' }, supply(seed)), 'grapple');

/** The log with the goblin grappled, and the state that follows from it. */
const grappled = (log: readonly GameEvent[] = fighting()) => {
  const seed = seedThat('failed', log, (state, supplied) =>
    unwrap(grappleTarget(state, BRAM, { target: GOBLIN, save: 'dex' }, supplied), 'probe'),
  );
  const out = grabbing(log, seed);
  const next = [...log, ...out.events];
  return { seed, out, log: next, state: fold('seed', next) };
};

// ——— Grapple ————————————————————————————————————————————————————————————————

describe('Grapple', () => {
  it('applies Grappled from a source naming the grappler when the save fails', () => {
    const { out, state } = grappled();

    expect(out.save?.success).toBe(false);
    expect(out.dc).toBe(DC);
    expect(out.applied).toBe(true);
    expect(hasCondition(state.creatures[GOBLIN]!.conditions, 'grappled')).toBe(true);
    expect(whyCondition(state, GOBLIN, 'grappled')).toEqual([grappleSource(BRAM)]);
  });

  it('applies nothing at all when the save succeeds', () => {
    const log = fighting();
    const seed = seedThat('saved', log, (state, supplied) =>
      unwrap(grappleTarget(state, BRAM, { target: GOBLIN, save: 'dex' }, supplied), 'probe'),
    );
    const out = grabbing(log, seed);
    const state = fold('seed', [...log, ...out.events]);

    expect(out.save?.success).toBe(true);
    expect(out.applied).toBe(false);
    expect(hasCondition(state.creatures[GOBLIN]!.conditions, 'grappled')).toBe(false);
    expect(out.events.some((e) => e.type === 'condition-applied')).toBe(false);
  });

  /**
   * SRD: "a Strength **or** Dexterity saving throw (it chooses which)" — the
   * target's choice, so the command takes it. Both reach the same DC.
   */
  it('lets the target choose which of the two saves it makes', () => {
    const log = fighting();
    const withStr = unwrap(
      grappleTarget(fold('seed', log), BRAM, { target: GOBLIN, save: 'str' }, supply('s')),
      'str save',
    );
    const withDex = unwrap(
      grappleTarget(fold('seed', log), BRAM, { target: GOBLIN, save: 'dex' }, supply('s')),
      'dex save',
    );
    expect(withStr.dc).toBe(DC);
    expect(withDex.dc).toBe(DC);
    // The goblin is feeble and nimble: the same die is a different total.
    expect(withStr.save!.total).toBeLessThan(withDex.save!.total);
  });

  it('spends the Attack action, and leaves a second attack to a fighter who has one', () => {
    const { state } = grappled();
    expect(state.combat!.budgets[BRAM]!.action).toBe(false);
    expect(state.combat!.budgets[BRAM]!.attacksRemaining).toBe(0);
  });

  it('is idempotent under a repeated command id', () => {
    const log = fighting();
    const command = { target: GOBLIN, save: 'dex' as const, commandId: 'grab-1' };
    const first = unwrap(grappleTarget(fold('seed', log), BRAM, command, supply('a')), 'first');
    const after = fold('seed', [...log, ...first.events]);

    const repeat = unwrap(grappleTarget(after, BRAM, command, supply('b')), 'repeat');
    expect(repeat.duplicate).toBe(true);
    expect(repeat.events).toEqual([]);
    // And the second run threw nothing: a retry must not move the generator.
    expect(fold('seed', [...log, ...first.events, ...repeat.events])).toEqual(after);
  });
});

// ——— the size rule ——————————————————————————————————————————————————————————

describe('the size rule', () => {
  it('permits a target one size larger', () => {
    const out = grappleTarget(
      fold('seed', facing(OGRE, 'large')),
      BRAM,
      { target: OGRE, save: 'dex' },
      supply('o'),
    );
    expect(out.ok).toBe(true);
  });

  it('refuses a target two sizes larger', () => {
    const out = grappleTarget(
      fold('seed', facing(GIANT, 'huge')),
      BRAM,
      { target: GIANT, save: 'dex' },
      supply('g'),
    );
    expect(isErr(out) && out.code).toBe('too_large');
  });

  it('refuses a shove against the same target for the same reason', () => {
    const out = shoveTarget(
      fold('seed', facing(GIANT, 'huge')),
      BRAM,
      { target: GIANT, save: 'dex', outcome: 'prone' },
      supply('g'),
    );
    expect(isErr(out) && out.code).toBe('too_large');
  });
});

// ——— reach ——————————————————————————————————————————————————————————————————

describe('reach', () => {
  it('reaches five feet and no further', () => {
    const log = [
      ...fighting(),
      { type: 'creature-moved' as const, id: GOBLIN, placement: { from: { creature: BRAM }, feet: 15, bearing: 90 }, forced: true },
    ];
    const out = grappleTarget(fold('seed', log), BRAM, { target: GOBLIN, save: 'dex' }, supply('far'));
    expect(isErr(out) && out.code).toBe('out_of_reach');
    expect(UNARMED_REACH).toBe(5);
  });

  it('asks where somebody is standing rather than refusing', () => {
    const log = [...fighting()].filter(
      (event) => !(event.type === 'creature-placed' && event.id === GOBLIN),
    );
    const out = grappleTarget(fold('seed', log), BRAM, { target: GOBLIN, save: 'dex' }, supply('who'));
    expect(isNeedsContext(out)).toBe(true);
  });
});

// ——— Shove ——————————————————————————————————————————————————————————————————

describe('Shove', () => {
  const shoving = (log: readonly GameEvent[], seed: string, outcome: 'prone' | 'push') =>
    unwrap(
      shoveTarget(fold('seed', log), BRAM, { target: GOBLIN, save: 'dex', outcome }, supply(seed)),
      'shove',
    );

  const shovedSeed = (log: readonly GameEvent[], outcome: 'prone' | 'push') =>
    seedThat('failed', log, (state, supplied) =>
      unwrap(shoveTarget(state, BRAM, { target: GOBLIN, save: 'dex', outcome }, supplied), 'probe'),
    );

  it('knocks the target Prone when that is the outcome chosen', () => {
    const log = fighting();
    const out = shoving(log, shovedSeed(log, 'prone'), 'prone');
    const state = fold('seed', [...log, ...out.events]);

    expect(out.save?.success).toBe(false);
    expect(out.dc).toBe(DC);
    expect(hasCondition(state.creatures[GOBLIN]!.conditions, 'prone')).toBe(true);
  });

  it('pushes the target five feet, measured on the lattice', () => {
    const log = fighting();
    const before = fold('seed', log);
    expect(unwrap(distanceBetween(before.scene!, BRAM, GOBLIN), 'before')).toBe(5);

    const out = shoving(log, shovedSeed(log, 'push'), 'push');
    const state = fold('seed', [...log, ...out.events]);

    expect(unwrap(distanceBetween(state.scene!, BRAM, GOBLIN), 'after')).toBe(10);
    // Pushed, not walked: nobody spent Speed and nobody provoked anything.
    const moved = out.events.find((e) => e.type === 'creature-moved');
    expect(moved && 'forced' in moved && moved.forced).toBe(true);
    expect(hasCondition(state.creatures[GOBLIN]!.conditions, 'prone')).toBe(false);
  });

  it('does neither when the save succeeds', () => {
    const log = fighting();
    const seed = seedThat('saved', log, (state, supplied) =>
      unwrap(shoveTarget(state, BRAM, { target: GOBLIN, save: 'dex', outcome: 'prone' }, supplied), 'probe'),
    );
    const out = shoving(log, seed, 'prone');
    const state = fold('seed', [...log, ...out.events]);
    expect(hasCondition(state.creatures[GOBLIN]!.conditions, 'prone')).toBe(false);
    expect(unwrap(distanceBetween(state.scene!, BRAM, GOBLIN), 'after')).toBe(5);
  });

  it('is idempotent under a repeated command id', () => {
    const log = fighting();
    const seed = shovedSeed(log, 'prone');
    const first = unwrap(
      shoveTarget(
        fold('seed', log),
        BRAM,
        { target: GOBLIN, save: 'dex', outcome: 'prone', commandId: 'shove-1' },
        supply(seed),
      ),
      'first',
    );
    const after = fold('seed', [...log, ...first.events]);
    const repeat = unwrap(
      shoveTarget(
        after,
        BRAM,
        { target: GOBLIN, save: 'dex', outcome: 'prone', commandId: 'shove-1' },
        supply('x'),
      ),
      'repeat',
    );
    expect(repeat.duplicate).toBe(true);
    expect(repeat.events).toEqual([]);
  });
});

// ——— the escape, and the other endings ———————————————————————————————————————

describe('ending a grapple', () => {
  /**
   * The grapple, with the turn passed to the creature caught in it.
   *
   * SRD: "A Grappled creature can use **its action**" — so the escape is
   * attempted on the goblin's own turn, which is also where the Action it
   * costs exists to be spent.
   */
  const held = () => {
    const { log } = grappled();
    const next = [...log, { type: 'turn-advanced' as const }];
    return { log: next, state: fold('seed', next) };
  };

  /**
   * SRD Grappling: "A Grappled creature can use its action to make a Strength
   * (Athletics) or Dexterity (Acrobatics) check against the grapple's escape
   * DC." The DC is the one the grapple was made at, pinned when it landed.
   */
  it('escapes on a check against the pinned escape DC, with either ability', () => {
    const { log, state } = held();
    const offered = availableChecks(state, GOBLIN);
    expect(offered.map((check) => check.dc)).toEqual([DC]);

    const tries = (seed: string, ability: 'str' | 'dex') =>
      unwrap(escapeGrapple(state, GOBLIN, { ability }, supply(seed)), 'escape');

    // Both abilities are offered, and both are checked against the one DC.
    expect(tries('a', 'str').check!.total).not.toBe(tries('a', 'dex').check!.total);

    let freed: ReturnType<typeof tries> | null = null;
    for (let n = 0; n < 80 && freed === null; n += 1) {
      const out = tries(`out-${n}`, 'dex');
      if (out.success) freed = out;
    }
    expect(freed).not.toBeNull();
    const after = fold('seed', [...log, ...freed!.events]);
    expect(hasCondition(after.creatures[GOBLIN]!.conditions, 'grappled')).toBe(false);
  });

  it('costs the escaping creature its Action', () => {
    const { log, state } = held();
    const out = unwrap(escapeGrapple(state, GOBLIN, { ability: 'str' }, supply('a')), 'escape');
    const after = fold('seed', [...log, ...out.events]);
    expect(after.combat!.budgets[GOBLIN]!.action).toBe(false);
  });

  it('is idempotent under a repeated command id', () => {
    const { log, state } = held();
    const first = unwrap(
      escapeGrapple(state, GOBLIN, { ability: 'str', commandId: 'out-1' }, supply('e')),
      'first',
    );
    const after = fold('seed', [...log, ...first.events]);
    const repeat = unwrap(
      escapeGrapple(after, GOBLIN, { ability: 'str', commandId: 'out-1' }, supply('e')),
      'repeat',
    );
    expect(repeat.duplicate).toBe(true);
    expect(repeat.events).toEqual([]);
  });

  /** SRD: "the grappler can release the target at any time (no action required)". */
  it('ends when the grappler lets go, and costs the grappler nothing', () => {
    const { log, state } = grappled();
    const released = unwrap(
      liftConditionFrom(state, GOBLIN, 'grappled', grappleSource(BRAM)),
      'release',
    );
    const after = fold('seed', [...log, ...released]);
    expect(hasCondition(after.creatures[GOBLIN]!.conditions, 'grappled')).toBe(false);
    // And the timer that held the escape DC went with the instance.
    expect(availableChecks(after, GOBLIN)).toEqual([]);
  });

  /**
   * SRD: "The condition also ends if the grappler has the Incapacitated
   * condition or if the distance between the Grappled target and the grappler
   * exceeds the grapple's range."
   */
  it('reports a grapple whose grappler is Incapacitated as lapsed', () => {
    const { log } = grappled();
    const state = fold('seed', [
      ...log,
      { type: 'condition-applied', id: BRAM, condition: 'stunned', source: 'a spell' },
    ]);
    expect(lapsedGrapples(state)).toEqual([
      { grappler: BRAM, target: GOBLIN, source: grappleSource(BRAM), reason: 'incapacitated' },
    ]);
  });

  it('reports a grapple stretched past its range as lapsed', () => {
    const { log } = grappled();
    const state = fold('seed', [
      ...log,
      {
        type: 'creature-moved',
        id: GOBLIN,
        placement: { from: { creature: BRAM }, feet: 20, bearing: 90 },
        forced: true,
      },
    ]);
    expect(lapsedGrapples(state)).toEqual([
      { grappler: BRAM, target: GOBLIN, source: grappleSource(BRAM), reason: 'out-of-range' },
    ]);
  });

  it('reports nothing while the grapple holds', () => {
    const { state } = grappled();
    expect(lapsedGrapples(state)).toEqual([]);
  });

  /** The generic door still answers, for the half of the escape it can express. */
  it('is escapable through the check the timer publishes', () => {
    const { log, state } = held();
    const key = availableChecks(state, GOBLIN)[0]!.effectKey;
    let freed = false;
    for (let n = 0; n < 80 && !freed; n += 1) {
      const out = unwrap(resolveEffectCheck(state, GOBLIN, { effectKey: key }, supply(`g-${n}`)), 'check');
      if (out.success) {
        const after = fold('seed', [...log, ...out.events]);
        freed = !hasCondition(after.creatures[GOBLIN]!.conditions, 'grappled');
      }
    }
    expect(freed).toBe(true);
  });
});

// ——— what each command refuses ———————————————————————————————————————————————

describe('refusals', () => {
  it('refuses a creature grabbing itself', () => {
    const out = grappleTarget(
      fold('seed', fighting()),
      BRAM,
      { target: BRAM, save: 'dex' },
      supply('me'),
    );
    expect(isErr(out) && out.code).toBe('self_target');
  });

  /**
   * SRD Grappling: "One Grapple per Hand ... it can grapple only one creature
   * at a time with that part." The engine holds no record of hands, so the one
   * case it *can* answer is the same grappler twice on the same creature.
   */
  it('refuses a second grapple by the same grappler on the same creature', () => {
    const { state } = grappled();
    const out = grappleTarget(state, BRAM, { target: GOBLIN, save: 'dex' }, supply('again'));
    expect(isErr(out) && out.code).toBe('already_grappled');
  });

  it('says the hand it cannot see is a fact it did not check', () => {
    const { out } = grappled();
    expect(out.unverified.join(' ')).toMatch(/hand free/);
  });

  it('refuses an escape by a creature nothing is holding', () => {
    const out = escapeGrapple(
      fold('seed', fighting()),
      GOBLIN,
      { ability: 'str' },
      supply('free'),
    );
    expect(isErr(out) && out.code).toBe('not_grappled');
  });

  it('asks which grapple, where two creatures are holding on', () => {
    const { log } = grappled();
    const other = id('thug');
    const state = fold('seed', [
      ...log,
      added(other, 'goblins'),
      { type: 'condition-applied', id: GOBLIN, condition: 'grappled', source: grappleSource(other) },
      { type: 'turn-advanced' },
    ]);
    const out = escapeGrapple(state, GOBLIN, { ability: 'str' }, supply('which'));
    expect(isErr(out) && out.code).toBe('several_grapples');

    // And naming one of them is the answer.
    expect(escapeGrapple(state, GOBLIN, { ability: 'str', grappler: BRAM }, supply('w')).ok).toBe(
      true,
    );
  });

  /**
   * A grapple somebody declared by hand, with no DC pinned beside it. The
   * escape has nothing to be a check against, and saying so is better than
   * inventing a number.
   */
  it('refuses an escape from a grapple with no escape DC pinned', () => {
    const state = fold('seed', [
      ...fighting(),
      { type: 'condition-applied', id: GOBLIN, condition: 'grappled', source: grappleSource(BRAM) },
      { type: 'turn-advanced' },
    ]);
    const out = escapeGrapple(state, GOBLIN, { ability: 'str' }, supply('dc'));
    expect(isErr(out) && out.code).toBe('no_escape_dc');
  });
});

// ——— is it an attack? ————————————————————————————————————————————————————————

/**
 * **It is the Attack action, and it is not an attack roll**, and the engine
 * has to say both at once.
 *
 * SRD Hide ends the Invisible condition when "you make an attack roll", and
 * SRD Invisibility ends "immediately after you make an attack roll". The
 * Grapple and Shove options make none — ever — so neither sentence fires.
 * `attack-made` is the event both of those clauses are read off in this
 * engine, and it is also the only event that spends an attack of the Attack
 * action, so these two commands emit `unarmed-strike-made` instead: the same
 * spend, and no claim that a d20 was thrown at anybody's Armour Class.
 */
describe('whether it is an attack', () => {
  const hidden = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    { type: 'condition-applied', id: BRAM, condition: 'invisible', source: 'action:hide' },
  ];

  /**
   * The other half of the same decision, and the half with teeth.
   *
   * SRD Potion of Invisibility: "The effect ends early if you make an attack
   * roll, deal damage, or cast a spell." The engine reads the first of those
   * off `attack-made` — so a grapple that spent its attack through that event
   * would end the potion here, silently, on a d20 nobody threw.
   */
  const potioned = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    { type: 'condition-applied', id: BRAM, condition: 'invisible', source: 'item:potion' },
    {
      type: 'effect-scheduled',
      target: {
        kind: 'condition',
        on: BRAM,
        instance: conditionInstanceId('invisible', 'item:potion'),
      },
      deadline: { kind: 'indefinite' },
      endsEarly: ['target-attacks', 'target-deals-damage', 'target-casts'],
    },
  ];

  it('leaves a potion that ends on an attack roll running', () => {
    const log = potioned(fighting());
    const { state } = grappled(log);
    expect(hasCondition(state.creatures[BRAM]!.conditions, 'invisible')).toBe(true);
  });

  it('spends the attack without claiming an attack roll was made', () => {
    const { out } = grappled();
    expect(out.events.some((e) => e.type === 'attack-made')).toBe(false);
    expect(out.events.filter((e) => e.type === 'unarmed-strike-made')).toEqual([
      { type: 'unarmed-strike-made', id: BRAM, option: 'grapple' },
    ]);
  });

  it('leaves a Hide standing, because no attack roll was made', () => {
    const log = hidden(fighting());
    const { state } = grappled(log);
    expect(hasCondition(state.creatures[BRAM]!.conditions, 'invisible')).toBe(true);
  });

  it('says the same of a Shove', () => {
    const log = hidden(fighting());
    const out = unwrap(
      shoveTarget(
        fold('seed', log),
        BRAM,
        { target: GOBLIN, save: 'dex', outcome: 'prone' },
        supply(
          seedThat('failed', log, (state, supplied) =>
            unwrap(shoveTarget(state, BRAM, { target: GOBLIN, save: 'dex', outcome: 'prone' }, supplied), 'probe'),
          ),
        ),
      ),
      'shove',
    );
    const state = fold('seed', [...log, ...out.events]);
    expect(hasCondition(state.creatures[BRAM]!.conditions, 'invisible')).toBe(true);
    expect(out.events.filter((e) => e.type === 'unarmed-strike-made')).toEqual([
      { type: 'unarmed-strike-made', id: BRAM, option: 'shove' },
    ]);
  });
});
