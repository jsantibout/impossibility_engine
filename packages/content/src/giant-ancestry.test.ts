import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  createCharacter,
  createRollIssuer,
  fold,
  currentCombatant,
  remaining,
  resolveAttack,
  resolveAttackDamage,
  resolveDamage,
  resolveTurn,
  settleDamage,
  speedOf,
  takeDamageReaction,
  takeDamageResponse,
  usePoolOption,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type GameState,
  type Rng,
  type RngState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * **SRD Giant Ancestry, all six boons, and the mechanism the last of them
 * waited on.**
 *
 * > You are descended from Giants. Choose one of the following benefits; you
 * > can use it a number of times equal to your Proficiency Bonus, and you
 * > regain all expended uses when you finish a Long Rest.
 *
 * The trait was the only feature in the book whose note named four different
 * absences, and one of them was load-bearing across the whole rider
 * vocabulary: **a rider that adds damage to the blow**. An `on-hit` grant
 * bought an effect list, and that list is resolved *after* the damage has been
 * rolled, offered to the defender's Reaction and landed — so a die thrown
 * there would be a second `damage-rolled` while the first was still waiting,
 * which the fold refuses. `rider_deals_damage` said so at the authoring door
 * and named these two sentences as its price.
 *
 * What lifts it is not a second roll but a **component**: `extraDamage` beside
 * the effect list, gathered by the attack path where a smite's dice and a
 * Cantrip Upgrade's are gathered, before the blow's own roll. So a critical
 * doubles it, the target's Resistance meets it by its own type, and one
 * `damage-rolled` carries the whole.
 *
 * The other three were a teleport a Bonus Action buys, a Speed a rider takes
 * away, and a Reaction that deals damage **back** rather than reducing it.
 */

const id = (s: string) => asCharacterId(s);
const KOTH = id('koth');
const THUG = id('thug');
const OGRE = id('ogre');
const KAEL = id('kael');

/** Which boon this Goliath took. One trait, six characters. */
type Boon =
  | "Cloud's Jaunt"
  | "Fire's Burn"
  | "Frost's Chill"
  | "Hill's Tumble"
  | "Stone's Endurance"
  | "Storm's Thunder";

const ANCESTRY = 'goliath:giant-ancestry';

const choices = (boon: Boon): CharacterChoices => ({
  name: 'Koth',
  classId: 'fighter',
  level: 5,
  speciesId: 'goliath',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'champion',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'fighter:weapon-mastery': [], [ANCESTRY]: [boon] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'fighter:fighting-style': { featId: 'defense' },
    'fighter:ability-score-improvement': { featId: 'two-weapon-fighting' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

/** A Warlock of the Fiend, for the one test about what the funnel pays out. */
const warlock = (): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  subclassId: 'fiend-patron',
  cantrips: ['eldritch-blast', 'chill-touch', 'poison-spray'],
  spellbook: [],
  preparedSpells: ['hex', 'charm-person', 'hold-person', 'hypnotic-pattern', 'mind-spike', 'fear'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'warlock:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const plain = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 3,
  abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

/**
 * A boon, a thug five feet away, an Ogre ten feet away, and a fight running.
 *
 * The Ogre is `size: 'large'` in the bestiary and is declared **Huge** here on
 * purpose: SRD Hill's Tumble reaches "a Large or smaller creature", so the
 * refusal needs something the clause genuinely cannot reach.
 */
const table = (boon: Boon, over: Partial<{ readonly thugHp: number }> = {}): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices(boon), KOTH), 'goliath') as GameEvent[]),
  { type: 'creature-side-declared', id: KOTH, side: 'party' },
  {
    type: 'creature-added',
    id: THUG,
    name: 'thug',
    sheet: plain(),
    maxHp: over.thugHp ?? 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'thugs',
  },
  {
    type: 'creature-added',
    id: OGRE,
    name: 'ogre',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Giant',
    size: 'huge',
    side: 'thugs',
  },
  {
    type: 'items-gained',
    id: KOTH,
    items: [{ id: 'greatsword', quantity: 1 }],
    source: 'loot',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: KOTH, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: KOTH }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: KOTH }, feet: 5, bearing: 90 } },
  {
    type: 'combat-started',
    combatants: [
      { id: KOTH, initiative: 20, speed: 35 },
      { id: THUG, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 5, speed: 40 },
    ],
  },
];

/** A generator with a script in it, so a 1d10 is a number this file chose. */
const scripted = (faces: Readonly<Record<number, readonly number[]>>): Rng => {
  const queues = new Map<number, number[]>(
    Object.entries(faces).map(([sides, values]) => [Number(sides), [...values]]),
  );
  return {
    int: (sides: number): number => {
      const queue = queues.get(sides);
      if (queue === undefined || queue.length === 0) {
        throw new Error(`the script has no d${sides} left to throw`);
      }
      return queue.shift()!;
    },
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (rng: Rng) => ({ issuer: createRollIssuer('r'), rng, content: SRD_CONTENT });

/**
 * Swing with the attack roll forced to land, so the test is about the boon.
 *
 * The same forced bonus the Monk's riders are tested with, and for the same
 * reason: a miss answers nothing about a rule that fires on a hit.
 */
const swing = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveAttack>[2],
  rng: Rng,
) => {
  const out = unwrap(
    resolveAttack(
      fold('seed', log),
      KOTH,
      { ...request, attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply(rng),
    ),
    'attack',
  );
  return { ...out, log: [...log, ...out.events], state: fold('seed', [...log, ...out.events]) };
};

/** The refusal a swing came back with, for the paths that must cost nothing. */
const refusedSwing = (log: readonly GameEvent[], request: Parameters<typeof resolveAttack>[2]) => {
  const out = resolveAttack(
    fold('seed', log),
    KOTH,
    { ...request, attackBonuses: [{ source: 'forced', flat: 40 }] },
    supply(scripted({})),
  );
  if (!isErr(out)) throw new Error('the fixture meant this swing to be refused');
  return out;
};

/**
 * Every slice of the one damage roll the blow made.
 *
 * `damage-dice-recorded` is what the dice *showed*, beside the `damage-taken`
 * that says what landed — and asserting there is exactly one of them is half
 * the claim this whole track makes: a rider that rolled again would write a
 * second.
 */
const componentsOf = (events: readonly GameEvent[]) => {
  const rolled = events.filter((e) => e.type === 'damage-dice-recorded');
  expect(rolled).toHaveLength(1);
  const one = rolled[0]!;
  if (one.type !== 'damage-dice-recorded') throw new Error('unreachable');
  return one.components;
};

/** Advance the turn until it is this creature's, so their swing is legal. */
const turnOf = (log: readonly GameEvent[], who: CharacterId): readonly GameEvent[] => {
  let current = log;
  for (let n = 0; n < 6 && currentCombatant(fold('seed', current).combat!).id !== who; n += 1) {
    current = [
      ...current,
      ...unwrap(resolveTurn(fold('seed', current), supply(scripted({}))), 'turn').events,
    ];
  }
  expect(currentCombatant(fold('seed', current).combat!).id).toBe(who);
  return current;
};

const uses = (state: GameState) => remaining(state.creatures.koth!.resources, ANCESTRY);

/** How much a creature has lost, which is the honest reading of "took". */
const lost = (state: GameState, who: CharacterId) => {
  const vitals = state.creatures[who]!.vitals;
  return vitals.hpMax - vitals.hp;
};

const where = (state: GameState, who: CharacterId) =>
  state.scene!.positions[who] ?? null;

// — the pool all six spend ——————————————————————————————————————————————————

describe('the pool the trait prints once for all six boons', () => {
  /**
   * SRD: "you can use it a number of times equal to your Proficiency Bonus,
   * and you regain all expended uses when you finish a Long Rest." A level 5
   * character's Proficiency Bonus is 3.
   */
  it('is the Proficiency Bonus, whichever boon was chosen', () => {
    for (const boon of [
      "Cloud's Jaunt",
      "Fire's Burn",
      "Frost's Chill",
      "Hill's Tumble",
      "Stone's Endurance",
      "Storm's Thunder",
    ] as const) {
      expect(uses(fold('seed', table(boon)))).toBe(3);
    }
  });

  /**
   * "**Choose one** of the following benefits": a Goliath who took Fire's Burn
   * has no Frost's Chill to ask for, which is what the gate on each grant is
   * for.
   */
  it('gives a Goliath the one boon they chose and none of the other five', () => {
    const fire = fold('seed', table("Fire's Burn")).creatures.koth!.sheet;
    expect((fire.hitOptions ?? []).map((one) => one.option)).toEqual(['fires-burn']);
    expect(fire.poolOptions ?? []).toEqual([]);
    // The Fighter's own Tactical Mind is on this sheet too; what must not be
    // is a Reaction the trait grants.
    expect((fire.reactions ?? []).map((one) => one.feature)).not.toContain(ANCESTRY);

    const jaunt = fold('seed', table("Cloud's Jaunt")).creatures.koth!.sheet;
    expect((jaunt.poolOptions ?? []).map((one) => one.option)).toEqual(['clouds-jaunt']);
    expect(jaunt.hitOptions ?? []).toEqual([]);
  });
});

// — Cloud's Jaunt —————————————————————————————————————————————————————————

/**
 * SRD: "**Cloud's Jaunt.** As a Bonus Action, you magically teleport up to 30
 * feet to an unoccupied space you can see."
 */
describe("Cloud's Jaunt teleports its holder as a Bonus Action", () => {
  const JAUNT = { feature: ANCESTRY, option: 'clouds-jaunt' } as const;

  /** Thirty feet from the thug, measured from a creature the Goliath can see. */
  const seen: readonly GameEvent[] = [
    ...table("Cloud's Jaunt"),
    { type: 'sight-declared', from: KOTH, to: THUG, seen: true },
  ];

  it('moves the Goliath, spends a use and spends the Bonus Action', () => {
    const before = fold('seed', seen);
    const out = unwrap(
      usePoolOption(
        before,
        KOTH,
        { ...JAUNT, teleportTo: { from: { creature: THUG }, feet: 25, bearing: 0 } },
        supply(scripted({})),
      ),
      'jaunt',
    );
    const after = fold('seed', [...seen, ...out.events]);
    expect(where(after, KOTH)).not.toEqual(where(before, KOTH));
    expect(uses(after)).toBe(2);
    expect(after.combat!.budgets.koth!.bonusAction).toBe(false);
    // Nothing was rolled: a teleport throws no dice at all.
    expect(out.events.some((e) => e.type === 'damage-rolled')).toBe(false);
  });

  /** "up to **30 feet**", measured on the lattice from where they stand. */
  it('refuses a space further than thirty feet', () => {
    const out = usePoolOption(
      fold('seed', seen),
      KOTH,
      { ...JAUNT, teleportTo: { from: { creature: THUG }, feet: 60, bearing: 0 } },
      supply(scripted({})),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('teleport_too_far');
    // And the refusal cost nothing: the use and the Bonus Action are both left.
    expect(uses(fold('seed', seen))).toBe(3);
  });

  /**
   * "an **unoccupied** space" — the Ogre's own, five feet away and well inside
   * the thirty, named by a bearing so the geometry reports it taken rather
   * than sweeping outwards for somewhere near it.
   */
  it('refuses a space somebody is standing in', () => {
    const out = usePoolOption(
      fold('seed', seen),
      KOTH,
      { ...JAUNT, teleportTo: { from: { creature: KOTH }, feet: 5, bearing: 90 } },
      supply(scripted({})),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('occupied');
  });

  /**
   * "a space **you can see**", answered through the anchor the placement is
   * measured from — and a Goliath who cannot see the thug cannot use the thug
   * to describe where they are going.
   */
  it('refuses a space measured from a creature the Goliath cannot see', () => {
    const blind: readonly GameEvent[] = [
      ...table("Cloud's Jaunt"),
      { type: 'sight-declared', from: KOTH, to: THUG, seen: false },
    ];
    const out = usePoolOption(
      fold('seed', blind),
      KOTH,
      { ...JAUNT, teleportTo: { from: { creature: THUG }, feet: 25, bearing: 0 } },
      supply(scripted({})),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('cannot_see_destination');
  });

  /**
   * And the Blinded condition reaches the same question through the same
   * helper, which is what "the sight question the teleport resolver already
   * asks" buys: nobody had to teach this boon about Blinded.
   */
  it('refuses a Blinded Goliath the space they cannot see', () => {
    const blinded: readonly GameEvent[] = [
      ...table("Cloud's Jaunt"),
      {
        type: 'condition-applied',
        id: KOTH,
        condition: 'blinded',
        source: 'the dark',
      },
    ];
    const out = usePoolOption(
      fold('seed', blinded),
      KOTH,
      { ...JAUNT, teleportTo: { from: { creature: THUG }, feet: 25, bearing: 0 } },
      supply(scripted({})),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('cannot_see_destination');
  });

  /** A destination nobody stated is asked for rather than invented. */
  it('refuses a use that names nowhere to go', () => {
    const out = usePoolOption(fold('seed', seen), KOTH, JAUNT, supply(scripted({})));
    expect(isErr(out) ? out.code : 'ok').toBe('destination_required');
  });

  /** And an empty pool is refused, with the Bonus Action still in hand. */
  it('refuses a use with no boon left', () => {
    const empty: readonly GameEvent[] = [
      ...seen,
      { type: 'resource-spent', id: KOTH, key: ANCESTRY, amount: 3 },
    ];
    const out = usePoolOption(
      fold('seed', empty),
      KOTH,
      { ...JAUNT, teleportTo: { from: { creature: THUG }, feet: 25, bearing: 0 } },
      supply(scripted({})),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('exhausted');
    expect(fold('seed', empty).combat!.budgets.koth!.bonusAction).toBe(true);
  });
});

// — Fire's Burn ———————————————————————————————————————————————————————————

/**
 * SRD: "**Fire's Burn.** When you hit a target with an attack roll and deal
 * damage to it, you can also deal 1d10 Fire damage to that target."
 *
 * The sentence the whole of Part 1 was written for. What is asserted is not
 * "ten more damage happened" but **where** it happened: one `damage-rolled`,
 * the die in it, doubled by a critical, and halved by a Resistance the rest of
 * the blow does not meet.
 */
describe("Fire's Burn is a component of the blow rather than a roll after it", () => {
  const BURN = { feature: ANCESTRY, option: 'fires-burn' } as const;

  /** A Greatsword is 2d6; the boon adds one d10 of its own type. */
  it('adds 1d10 Fire to the one damage roll the swing makes', () => {
    const out = swing(
      table("Fire's Burn"),
      { target: THUG, weapon: 'greatsword', twoHanded: true, onHit: BURN },
      scripted({ 20: [10], 6: [3, 4], 10: [7] }),
    );
    expect(out.attack!.hit).toBe(true);
    const components = componentsOf(out.events);
    const fire = components.filter((one) => one.type === 'fire');
    expect(fire).toHaveLength(1);
    expect(fire[0]!.total).toBe(7);
    expect(fire[0]!.source).toBe("Fire's Burn");
    // And the weapon's own half is untouched and still slashing.
    expect(components.filter((one) => one.type === 'slashing')).toHaveLength(1);
  });

  it('spends a use, and a swing that asks for nothing spends none', () => {
    const took = swing(
      table("Fire's Burn"),
      { target: THUG, weapon: 'greatsword', twoHanded: true, onHit: BURN },
      scripted({ 20: [10], 6: [3, 4], 10: [7] }),
    );
    expect(uses(took.state)).toBe(2);

    const quiet = swing(
      table("Fire's Burn"),
      { target: THUG, weapon: 'greatsword', twoHanded: true },
      scripted({ 20: [10], 6: [3, 4] }),
    );
    expect(componentsOf(quiet.events).some((one) => one.type === 'fire')).toBe(false);
    expect(uses(quiet.state)).toBe(3);
  });

  /**
   * **A critical doubles it**, which is the whole claim that the dice are part
   * of the blow: an effect resolved after the damage could not be doubled by
   * anything, because the critical is a property of the attack roll.
   */
  it('is doubled by a Critical Hit', () => {
    const out = swing(
      table("Fire's Burn"),
      { target: THUG, weapon: 'greatsword', twoHanded: true, onHit: BURN },
      // A natural 20, then four weapon dice and two Fire dice, because a
      // critical doubles the notation rather than the total.
      scripted({ 20: [20], 6: [3, 4, 5, 6], 10: [7, 2] }),
    );
    expect(out.attack!.critical).toBe(true);
    const fire = componentsOf(out.events).filter((one) => one.type === 'fire');
    expect(fire).toHaveLength(1);
    expect(fire[0]!.total).toBe(9);
  });

  /**
   * **And the target's own defences meet it, by its own type.** A thug
   * Resistant to Fire takes half the boon's dice and all of the sword's, which
   * is what a component means and what a flat addition to the total could not
   * have said.
   */
  it('is met by the target’s Fire Resistance and nothing else is', () => {
    const resistant = table("Fire's Burn").map((event) =>
      event.type === 'creature-added' && event.id === THUG
        ? { ...event, defenses: { fire: { resistant: true } } }
        : event,
    );
    const out = swing(
      resistant,
      { target: THUG, weapon: 'greatsword', twoHanded: true, onHit: BURN },
      scripted({ 20: [10], 6: [3, 4], 10: [8] }),
    );
    // 2d6 = 7 and +2 Strength is 9 slashing, all of it; 8 Fire halved to 4.
    expect(lost(out.state, THUG)).toBe(13);

    // The same blow against a thug who resists nothing takes the whole 17,
    // which is what makes the four above a *halving of the boon's dice* rather
    // than of anything else.
    const bare = swing(
      table("Fire's Burn"),
      { target: THUG, weapon: 'greatsword', twoHanded: true, onHit: BURN },
      scripted({ 20: [10], 6: [3, 4], 10: [8] }),
    );
    expect(lost(bare.state, THUG)).toBe(17);
  });

  /**
   * **And the other road to the same dice.** A swing may be *held* — SRD
   * Divine Smite is taken "immediately after hitting a target" — so the blow's
   * damage is rolled by a second command, and the rider the hold pinned has to
   * ride on that roll too. A gather written at one of the two sites would be a
   * boon that worked or did not depending on whether anybody held the blow.
   */
  it('rides on a held blow, rolled a command later', () => {
    const start = table("Fire's Burn");
    const held = unwrap(
      resolveAttack(
        fold('seed', start),
        KOTH,
        {
          target: THUG,
          weapon: 'greatsword',
          twoHanded: true,
          onHit: BURN,
          hold: true,
          attackBonuses: [{ source: 'forced', flat: 40 }],
        },
        supply(scripted({ 20: [10] })),
      ),
      'held swing',
    );
    const waiting = [...start, ...held.events];
    expect(fold('seed', waiting).pendingAttack).not.toBeNull();

    const settled = unwrap(
      resolveAttackDamage(
        fold('seed', waiting),
        KOTH,
        {},
        supply(scripted({ 6: [3, 4], 10: [7] })),
      ),
      'held damage',
    );
    const fire = componentsOf(settled.events).filter((one) => one.type === 'fire');
    expect(fire).toHaveLength(1);
    expect(fire[0]!.total).toBe(7);
    expect(uses(fold('seed', [...waiting, ...settled.events]))).toBe(2);
  });

  /** A swing that missed buys nothing and rolls no Fire at all. */
  it('spends nothing and rolls nothing on a miss', () => {
    const missed = unwrap(
      resolveAttack(
        fold('seed', table("Fire's Burn")),
        KOTH,
        {
          target: THUG,
          weapon: 'greatsword',
          twoHanded: true,
          onHit: BURN,
          attackBonuses: [{ source: 'forced', flat: -40 }],
        },
        supply(scripted({ 20: [3] })),
      ),
      'attack',
    );
    expect(missed.attack!.hit).toBe(false);
    const after = fold('seed', [...table("Fire's Burn"), ...missed.events]);
    expect(uses(after)).toBe(3);
    expect(missed.events.some((e) => e.type === 'damage-rolled')).toBe(false);
  });

  /** An empty pool is refused at the swing, with the Action still in hand. */
  it('is refused with no uses left, before the Action is spent', () => {
    const empty: readonly GameEvent[] = [
      ...table("Fire's Burn"),
      { type: 'resource-spent', id: KOTH, key: ANCESTRY, amount: 3 },
    ];
    const out = refusedSwing(empty, {
      target: THUG,
      weapon: 'greatsword',
      twoHanded: true,
      onHit: BURN,
    });
    expect(out.code).toBe('exhausted');
    expect(fold('seed', empty).combat!.budgets.koth!.action).toBe(true);
  });
});

// — Frost's Chill —————————————————————————————————————————————————————————

/**
 * SRD: "**Frost's Chill.** When you hit a target with an attack roll and deal
 * damage to it, you can also deal 1d6 Cold damage to that target and reduce
 * its Speed by 10 feet until the start of your next turn."
 */
describe("Frost's Chill chills and slows in the same breath", () => {
  const CHILL = { feature: ANCESTRY, option: 'frosts-chill' } as const;

  const hit = (log: readonly GameEvent[] = table("Frost's Chill")) =>
    swing(
      log,
      { target: THUG, weapon: 'greatsword', twoHanded: true, onHit: CHILL },
      scripted({ 20: [10], 6: [3, 4, 5] }),
    );

  it('adds 1d6 Cold to the blow and spends a use', () => {
    const out = hit();
    const cold = componentsOf(out.events).filter((one) => one.type === 'cold');
    expect(cold).toHaveLength(1);
    expect(cold[0]!.source).toBe("Frost's Chill");
    expect(uses(out.state)).toBe(2);
  });

  /** "reduce its Speed by 10 feet" — a Speed of 30 becomes 20. */
  it('takes ten feet off the target’s Speed', () => {
    const before = fold('seed', table("Frost's Chill"));
    expect(speedOf(before, THUG)).toBe(30);
    expect(speedOf(hit().state, THUG)).toBe(20);
  });

  /**
   * "until the start of **your** next turn" — the Goliath's, which is a round
   * away from the thug's. The thug's own turn comes and goes with the Speed
   * still down; the Goliath's start is what lifts it.
   */
  it('lifts it at the start of the Goliath’s next turn and not the target’s', () => {
    let log = hit().log;
    expect(speedOf(fold('seed', log), THUG)).toBe(20);

    // The Goliath's turn ends and the thug's begins: still slowed.
    log = [...log, ...unwrap(resolveTurn(fold('seed', log), supply(scripted({}))), 'turn').events];
    expect(currentCombatant(fold('seed', log).combat!).id).toBe(THUG);
    expect(speedOf(fold('seed', log), THUG)).toBe(20);

    // The thug's ends, the Ogre's runs, and then the Goliath's starts.
    for (let n = 0; n < 2; n += 1) {
      log = [...log, ...unwrap(resolveTurn(fold('seed', log), supply(scripted({}))), 'turn').events];
    }
    expect(currentCombatant(fold('seed', log).combat!).id).toBe(KOTH);
    expect(speedOf(fold('seed', log), THUG)).toBe(30);
  });
});

// — Hill's Tumble —————————————————————————————————————————————————————————

/**
 * SRD: "**Hill's Tumble.** When you hit a Large or smaller creature with an
 * attack roll and deal damage to it, you can give that target the Prone
 * condition."
 */
describe("Hill's Tumble knocks down what it can reach and refuses what it cannot", () => {
  const TUMBLE = { feature: ANCESTRY, option: 'hills-tumble' } as const;

  it('gives a Medium target the Prone condition, with no saving throw', () => {
    const out = swing(
      table("Hill's Tumble"),
      { target: THUG, weapon: 'greatsword', twoHanded: true, onHit: TUMBLE },
      scripted({ 20: [10], 6: [3, 4] }),
    );
    expect(out.state.creatures.thug!.conditions.conditions).toContain('prone');
    expect(uses(out.state)).toBe(2);
    // No save was rolled: the sentence gives the condition outright.
    expect(out.events.filter((e) => e.type === 'roll-recorded' && e.who === THUG)).toHaveLength(0);
  });

  /**
   * "a **Large or smaller** creature" — a Huge one is refused at the swing,
   * with the Action, the use and the die all still unspent.
   */
  it('is refused against a Huge creature before anything is spent', () => {
    const out = refusedSwing(table("Hill's Tumble"), {
      target: OGRE,
      weapon: 'greatsword',
      twoHanded: true,
      onHit: TUMBLE,
    });
    expect(out.code).toBe('target_too_large');
    const before = fold('seed', table("Hill's Tumble"));
    expect(uses(before)).toBe(3);
    expect(before.combat!.budgets.koth!.action).toBe(true);
  });

  /**
   * And a creature nobody has measured is knocked down out loud rather than
   * quietly spared, which is the three-valued reading declared cover keeps.
   */
  it('takes an unmeasured creature for one it reaches, and says so', () => {
    const unmeasured: readonly GameEvent[] = [
      ...(unwrap(
        createCharacter(SRD_CONTENT, choices("Hill's Tumble"), KOTH),
        'goliath',
      ) as GameEvent[]),
      { type: 'creature-side-declared', id: KOTH, side: 'party' },
      {
        type: 'creature-added',
        id: THUG,
        name: 'thug',
        sheet: plain(),
        maxHp: 400,
        diesAtZero: false,
        creatureType: 'Humanoid',
        side: 'thugs',
      },
      { type: 'items-gained', id: KOTH, items: [{ id: 'greatsword', quantity: 1 }], source: 'loot' },
    ];
    const out = swing(
      unmeasured,
      { target: THUG, weapon: 'greatsword', twoHanded: true, onHit: TUMBLE },
      scripted({ 20: [10], 6: [3, 4] }),
    );
    expect(out.state.creatures.thug!.conditions.conditions).toContain('prone');
    expect(out.unverified.join(' ')).toContain('how big');
  });
});

// — Stone's Endurance ——————————————————————————————————————————————————————

/**
 * SRD: "**Stone's Endurance.** When you take damage, you can take a Reaction
 * to roll 1d12. Add your Constitution modifier to the number rolled and reduce
 * the damage by that total."
 */
describe("Stone's Endurance takes the blow down in the damage window", () => {
  /** The thug swings at the Goliath on its own turn, and the window opens. */
  const struck = (start: readonly GameEvent[] = table("Stone's Endurance")) => {
    const log = turnOf(start, THUG);
    const out = unwrap(
      resolveAttack(
        fold('seed', log),
        THUG,
        {
          target: KOTH,
          weapon: null,
          attackBonuses: [{ source: 'forced', flat: 40 }],
        },
        supply(scripted({ 20: [10] })),
      ),
      'thug swings',
    );
    return { ...out, log: [...log, ...out.events], state: fold('seed', [...log, ...out.events]) };
  };

  it('is offered against a blow that has been rolled and not applied', () => {
    const hit = struck();
    expect((hit.reactions ?? []).map((one) => one.feature)).toContain(ANCESTRY);
  });

  /**
   * An Unarmed Strike from a Strength 16 thug is 1 + 3 = 4. A 1d12 of 9 plus
   * the Goliath's Constitution modifier of +3 is 12, which is more than the
   * blow, so nothing at all lands.
   */
  it('rolls 1d12 plus Constitution and takes it off the total', () => {
    const hit = struck();
    const answered = unwrap(
      takeDamageReaction(hit.state, KOTH, { feature: ANCESTRY }, supply(scripted({ 12: [9] }))),
      'endurance',
    );
    expect(answered.reduction!.amount).toBe(12);
    const withIt = [...hit.log, ...answered.events];
    const settled = unwrap(settleDamage(fold('seed', withIt), supply(scripted({}))), 'settle');
    expect(settled.amount).toBe(0);

    // The same blow with nobody answering lands its four.
    const alone = unwrap(settleDamage(hit.state, supply(scripted({}))), 'settle');
    expect(alone.amount).toBe(4);
  });

  it('spends the Reaction and a use of the boon', () => {
    const hit = struck();
    const answered = unwrap(
      takeDamageReaction(hit.state, KOTH, { feature: ANCESTRY }, supply(scripted({ 12: [9] }))),
      'endurance',
    );
    const after = fold('seed', [...hit.log, ...answered.events]);
    expect(uses(after)).toBe(2);
    expect(after.combat!.budgets.koth!.reaction).toBe(false);
  });

  /**
   * A boon with no uses left is not offered at all, and the blow simply lands:
   * the window opens for creatures who can answer it and holds nothing open
   * for a creature who cannot.
   */
  it('offers nothing and holds nothing open with no uses left', () => {
    const empty: readonly GameEvent[] = [
      ...table("Stone's Endurance"),
      { type: 'resource-spent', id: KOTH, key: ANCESTRY, amount: 3 },
    ];
    const hit = struck(empty);
    expect(hit.reactions ?? []).toEqual([]);
    expect(hit.state.pendingDamage).toBeNull();
    expect(lost(hit.state, KOTH)).toBe(4);
  });
});

// — Storm's Thunder ————————————————————————————————————————————————————————

/**
 * SRD: "**Storm's Thunder.** When you take damage from a creature within 60
 * feet of you, you can take a Reaction to deal 1d8 Thunder damage to that
 * creature."
 *
 * The window SRD Hellish Rebuke is cast into, answered by a feature for the
 * first time: everything is settled, nothing is held open, and what the
 * Reaction does cannot change the blow that provoked it.
 */
describe("Storm's Thunder throws the damage back", () => {
  /**
   * Somebody damages the Goliath, and the window is open on the far side of
   * it.
   *
   * A DM's stated amount rather than a swing, for the one reason the test at
   * sixty-five feet needs: nothing in the book lets a creature sixty feet away
   * punch anybody, and the clause this boon prints is about the *dealer's*
   * distance rather than about how they did it. `resolveDamage` writes the
   * same `lastDamage` a blow writes, which is the whole of what the window is.
   */
  const hurtBy = (
    log: readonly GameEvent[],
    attacker: CharacterId,
    amount = 4,
  ): readonly GameEvent[] => {
    const dealt = unwrap(
      resolveDamage(
        fold('seed', log),
        KOTH,
        { amount, by: attacker, source: 'a hurled rock' },
        supply(scripted({})),
      ),
      'damage',
    );
    return [...log, ...dealt.events];
  };

  it('deals 1d8 Thunder to the creature that struck, and spends a use', () => {
    const log = hurtBy(table("Storm's Thunder"), THUG);
    const out = unwrap(
      takeDamageResponse(
        fold('seed', log),
        KOTH,
        { feature: ANCESTRY },
        supply(scripted({ 8: [6] })),
      ),
      'thunder',
    );
    const after = fold('seed', [...log, ...out.events]);
    expect(lost(after, THUG)).toBe(6);
    expect(uses(after)).toBe(2);
    expect(after.combat!.budgets.koth!.reaction).toBe(false);
    // No attack roll: the sentence prints none.
    expect(out.attack).toBeNull();
  });

  /** "within 60 feet of you" — and the Ogre is placed ten feet away. */
  it('reaches an attacker at sixty feet and refuses one at sixty-five', () => {
    const near: readonly GameEvent[] = [
      ...table("Storm's Thunder"),
      { type: 'creature-moved', id: OGRE, placement: { from: { creature: KOTH }, feet: 60, bearing: 90 } },
    ];
    const reached = takeDamageResponse(
      fold('seed', hurtBy(near, OGRE)),
      KOTH,
      { feature: ANCESTRY },
      supply(scripted({ 8: [6] })),
    );
    expect(isErr(reached)).toBe(false);

    const far: readonly GameEvent[] = [
      ...table("Storm's Thunder"),
      { type: 'creature-moved', id: OGRE, placement: { from: { creature: KOTH }, feet: 65, bearing: 90 } },
    ];
    const out = takeDamageResponse(
      fold('seed', hurtBy(far, OGRE)),
      KOTH,
      { feature: ANCESTRY },
      supply(scripted({ 8: [6] })),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('out_of_range');
  });

  /**
   * "damage **from a creature**": a ceiling that fell on the Goliath names
   * nobody, so there is nothing for the Thunder to be aimed at and the window
   * never opened. An amount with no dealer is exactly that — the fold leaves
   * `lastDamage` alone, which is the fact the window is.
   */
  it('refuses a blow no creature dealt', () => {
    const start = table("Storm's Thunder");
    const dealt = unwrap(
      resolveDamage(
        fold('seed', start),
        KOTH,
        { amount: 5, source: 'the ceiling' },
        supply(scripted({})),
      ),
      'ceiling',
    );
    const out = takeDamageResponse(
      fold('seed', [...start, ...dealt.events]),
      KOTH,
      { feature: ANCESTRY },
      supply(scripted({ 8: [6] })),
    );
    expect(isErr(out) ? out.code : 'ok').toBe('no_trigger');
  });

  /**
   * **It goes down the damage funnel, and the proof is what the funnel pays
   * out.** SRD Dark One's Blessing: "You also gain this benefit if someone
   * else reduces an enemy within 10 feet of you to 0 Hit Points." A Warlock
   * standing beside the fight is paid when the Thunder is what drops the thug
   * — which nothing outside `dealSpellDamage` could have caused.
   */
  it('pays a nearby Warlock when it is the damage that drops the attacker', () => {
    const party: readonly GameEvent[] = [
      ...table("Storm's Thunder", { thugHp: 6 }),
      ...(unwrap(createCharacter(SRD_CONTENT, warlock(), KAEL), 'warlock') as GameEvent[]),
      { type: 'creature-side-declared', id: KAEL, side: 'party' },
      { type: 'creature-placed', id: KAEL, placement: { from: { creature: KOTH }, feet: 5, bearing: 180 } },
    ];
    const log = hurtBy(party, THUG, 3);
    expect(fold('seed', log).creatures.kael!.vitals.temporaryHp).toBe(0);

    const out = unwrap(
      takeDamageResponse(
        fold('seed', log),
        KOTH,
        { feature: ANCESTRY },
        supply(scripted({ 8: [8] })),
      ),
      'thunder',
    );
    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures.thug!.vitals.hp).toBe(0);
    // Charisma modifier +2 plus Warlock level 5.
    expect(after.creatures.kael!.vitals.temporaryHp).toBe(7);
  });
});

// — what the catalogue says about itself ——————————————————————————————————

describe('the trait declares itself executed and says what the scene answers', () => {
  const trait = SRD_CONTENT.species
    .find((one) => one.id === 'goliath')!
    .features.find((one) => one.id === ANCESTRY)!;

  it('is marked engine now that all six boons apply', () => {
    expect(trait.automation).toBe('engine');
  });

  it('names what the scene still answers for the two that ask it', () => {
    expect(trait.note).toContain('scene');
  });

  it('folds and replays prefix by prefix with a boon spent', () => {
    const log = swing(
      table("Fire's Burn"),
      {
        target: THUG,
        weapon: 'greatsword',
        twoHanded: true,
        onHit: { feature: ANCESTRY, option: 'fires-burn' },
      },
      scripted({ 20: [10], 6: [3, 4], 10: [7] }),
    ).log;
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});
