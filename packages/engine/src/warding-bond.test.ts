import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { checkSpellDefinition, checkSpellDefinitionValue } from './spell-schema.js';
import { armorClassOf, defensesOf, requirementsHold } from './standing.js';
import { savingSupport } from './commands/rolls.js';
import { dealSpellDamage } from './commands/damage.js';
import { resolveDamage, resolveSpell } from './commands.js';
import { extendContent } from './content.js';
import type { SpellDefinition } from './spell-definitions.js';

/**
 * SRD Warding Bond:
 *
 * > "You touch another creature that is willing and create a mystic connection
 * > between you and the target until the spell ends. **While the target is
 * > within 60 feet of you**, it gains a +1 bonus to AC and saving throws, and
 * > it has Resistance to all damage. Also, **each time it takes damage, you
 * > take the same amount of damage**. The spell ends **if you drop to 0 Hit
 * > Points or if you and the target become separated by more than 60 feet**.
 * > It also ends if the spell is cast again on **either** of the connected
 * > creatures."
 *
 * Three ordinary grants fenced by a distance two creatures are apart — a
 * `StandingRequirement` the grants carry and the readers ask at every read —
 * damage the caster takes because the target did, dealt where every blow
 * settles, and three endings: the caster falling, the pair drifting apart,
 * and a recast on either end of the bond.
 */

const id = (s: string) => asCharacterId(s);
const CLERIC = id('cleric');
const FIGHTER = id('fighter');
const ROGUE = id('rogue');
const GOBLIN = id('goblin');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: who === GOBLIN ? 'foes' : 'party',
});

const SETUP: readonly GameEvent[] = [
  added(CLERIC),
  added(FIGHTER),
  added(ROGUE),
  added(GOBLIN),
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({ ability: 'wis', prepared: ['warding-bond'] }),
  },
  {
    type: 'resource-pool-declared',
    id: CLERIC,
    pool: { key: spellSlotKey(2), label: 'level 2', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the chapel', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { landmark: 'the chapel' }, feet: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { creature: CLERIC }, feet: 5, bearing: 90 } },
  { type: 'creature-placed', id: ROGUE, placement: { from: { creature: CLERIC }, feet: 5, bearing: 270 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: CLERIC }, feet: 10, bearing: 0 } },
];

const supply = (seed = 'bond') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** The bond laid on the fighter, standing beside the cleric. */
const bonded = (target: CharacterId = FIGHTER, log: readonly GameEvent[] = SETUP) => {
  const cast = unwrap(
    resolveSpell(
      state(log),
      CLERIC,
      { spellId: 'warding-bond', targets: [target], slotLevel: 2, willing: [target] },
      supply(),
    ),
    'Warding Bond',
  );
  return { log: [...log, ...cast.events], casting: cast.castingId! };
};

/** The fighter walked to `feet` from the cleric, due east, by a move nobody spent Speed on. */
const apartBy = (feet: number): GameEvent => ({
  type: 'creature-moved',
  id: FIGHTER,
  placement: { from: { creature: CLERIC }, feet, bearing: 90 },
  forced: true,
});

const fire = (world: GameState, target: CharacterId, amount: number) =>
  unwrap(
    dealSpellDamage(
      world,
      target,
      [{ source: 'a torch', type: 'fire', roll: null, flat: amount, total: amount }],
      'a torch',
      supply('torch'),
      { by: GOBLIN },
    ),
    'the torch',
  );

const hp = (world: GameState, who: CharacterId): number => world.creatures[who]!.vitals.hp;

describe('the definition is written to the book', () => {
  const definition = () => SPELL_DEFINITIONS.find((one) => one.id === 'warding-bond')!;

  it('fences its three grants inside sixty feet of the caster, shares damage, and prints its endings', () => {
    const within = { kind: 'within-feet-of', creature: 'caster', feet: 60 };
    const effects = definition().effects;
    expect(effects.some((one) => one.kind === 'buff' && one.applies.includes('ac') && one.applies.includes('save'))).toBe(true);
    expect(effects.some((one) => one.kind === 'damage-defense' && one.defense === 'resistant' && one.damageTypes.length === 13)).toBe(true);
    for (const effect of effects) {
      expect((effect as { requires?: unknown }).requires).toEqual([within]);
    }
    expect(definition().sharesDamage).toEqual({ with: 'caster', withinFeet: 60 });
    expect(definition().endsEarly).toEqual([
      { on: 'caster-drops-to-0', ends: 'casting' },
      { on: 'separated-beyond', feet: 60, ends: 'casting' },
    ]);
    expect(definition().replacesPriorCasting).toBe(true);
    expect(definition().replacesPriorCastingOn).toBe('either');
    expect(definition().unmodelled).toBeUndefined();
    expect(checkSpellDefinitionValue(definition())).toEqual([]);
  });

  it('refuses the vocabulary written wrongly', () => {
    const codes = (over: Record<string, unknown>): readonly string[] =>
      checkSpellDefinitionValue({ ...definition(), ...over }).map((one) => one.code);
    // A distance ending needs its feet, and nothing else may carry them.
    expect(codes({ endsEarly: [{ on: 'separated-beyond', ends: 'casting' }] })).toContain('bad_end_trigger_feet');
    expect(codes({ endsEarly: [{ on: 'caster-drops-to-0', feet: 60, ends: 'casting' }] })).toContain('bad_end_trigger_feet');
    // The caster holds nothing of the casting, so neither cause may end it on a target.
    expect(codes({ endsEarly: [{ on: 'caster-drops-to-0', ends: 'target' }] })).toContain('inert_end_scope');
    // "Either" widens a recast rule, so it needs one to widen.
    expect(codes({ replacesPriorCasting: undefined })).toContain('recast_on_either_without_recast');
    // Shared damage reaches a target from a casting that runs: no target, no bond.
    expect(codes({ targets: { count: 0 } })).toContain('shared_damage_with_nobody');
    // A requirement on a grant names the caster and a distance the lattice can measure.
    const buff = definition().effects.find((one) => one.kind === 'buff')!;
    expect(
      codes({ effects: [{ ...buff, requires: [{ kind: 'within-feet-of', creature: 'target', feet: 60 }] }] }),
    ).toContain('bad_grant_requirement');
    expect(
      codes({ effects: [{ ...buff, requires: [{ kind: 'not-incapacitated' }] }] }),
    ).toContain('bad_grant_requirement');
    // And only on the two families the readers ask the requirement of.
    expect(
      codes({ effects: [{ ...buff, applies: ['attack'] }] }),
    ).toContain('unreadable_grant_requirement');
  });
});

describe('the three benefits, while within sixty feet', () => {
  it('holds the +1 to AC, the +1 to saves and the Resistance at fifty feet', () => {
    const { log } = bonded();
    const near = state([...log, apartBy(50)]);
    expect(armorClassOf(near, FIGHTER)).toBe(armorClassOf(state(SETUP), FIGHTER) + 1);
    const support = savingSupport(near, FIGHTER, near.creatures[FIGHTER]!, 'dex', {});
    expect(support.bonuses.some((bonus) => bonus.source === 'Warding Bond' && bonus.flat === 1)).toBe(true);
    expect(defensesOf(near, FIGHTER)['fire']?.resistant).toBe(true);
    expect(defensesOf(near, FIGHTER)['psychic']?.resistant).toBe(true);
    // The cleric holds none of it: the sentence is about the target.
    expect(armorClassOf(near, CLERIC)).toBe(armorClassOf(state(SETUP), CLERIC));
    expect(defensesOf(near, CLERIC)['fire']?.resistant).toBeUndefined();
  });

  /**
   * The requirement itself, read at the seam every grant is read at, and
   * withholding where nobody can measure: a caster nobody has placed is at no
   * distance, and a grant fenced by one is not held.
   */
  it('is a requirement the standing reader asks, and withholds where the distance is unknown', () => {
    const { log, casting } = bonded();
    const source = `Warding Bond#${casting}`;
    const within = [{ kind: 'within-feet-of', creature: 'caster', feet: 60 } as const];
    expect(requirementsHold(state(log), FIGHTER, within, source)).toBe(true);
    expect(requirementsHold(state([...log, apartBy(60)]), FIGHTER, within, source)).toBe(true);
    // A casting that is not running fences nothing in.
    expect(requirementsHold(state(log), FIGHTER, within, 'Warding Bond#cast:99')).toBe(false);
    // Nobody has placed the cleric: no distance, no benefit.
    const unplaced = state([...log, { type: 'creature-unplaced', id: CLERIC }]);
    expect(requirementsHold(unplaced, FIGHTER, within, source)).toBe(false);
  });
});

describe('damage the two creatures share', () => {
  it('costs the cleric what the fighter actually took — 8 Fire is 4 after Resistance, and 4 to the cleric', () => {
    const { log } = bonded();
    const before = state(log);
    const burned = fire(before, FIGHTER, 8);
    const after = state([...log, ...burned.events]);
    expect(hp(after, FIGHTER)).toBe(hp(before, FIGHTER) - 4);
    expect(hp(after, CLERIC)).toBe(hp(before, CLERIC) - 4);

    const taken = burned.events.filter((event) => event.type === 'damage-taken');
    expect(taken.map((event) => event.type === 'damage-taken' && event.id)).toEqual([FIGHTER, CLERIC]);
    if (taken[1]?.type !== 'damage-taken') throw new Error('unreachable');
    // With the casting as its source and the goblin still the dealer.
    expect(taken[1].amount).toBe(4);
    expect(taken[1].source).toContain('Warding Bond');
    expect(taken[1].by).toBe(GOBLIN);
  });

  it('runs the shared damage through the cleric’s own defences', () => {
    const { log } = bonded();
    const resistant = state([
      ...log,
      {
        type: 'damage-defense-granted',
        id: CLERIC,
        defense: { source: 'a ring', damageTypes: ['fire'], defense: 'resistant' },
      },
    ]);
    const burned = fire(resistant, FIGHTER, 8);
    const after = state([...log, ...burned.events]);
    // Four to the fighter; the cleric halves the four again.
    expect(hp(after, CLERIC)).toBe(hp(resistant, CLERIC) - 2);
  });

  it('never runs the other way, and never past sixty feet', () => {
    const { log } = bonded();
    const before = state(log);
    const clericHit = fire(before, CLERIC, 8);
    const afterCleric = state([...log, ...clericHit.events]);
    expect(hp(afterCleric, CLERIC)).toBe(hp(before, CLERIC) - 8);
    expect(hp(afterCleric, FIGHTER)).toBe(hp(before, FIGHTER));

    // At sixty-five feet the spell has ended, and a blow on the fighter is the fighter's alone.
    const apart = state([...log, apartBy(65)]);
    const burned = fire(apart, FIGHTER, 8);
    const after = state([...log, apartBy(65), ...burned.events]);
    expect(hp(after, FIGHTER)).toBe(hp(apart, FIGHTER) - 8);
    expect(hp(after, CLERIC)).toBe(hp(apart, CLERIC));
  });

  /**
   * **A pair nobody can measure gets neither half of the sentence.** "While the
   * target is within 60 feet of you" fences the three benefits and the shared
   * blow alike, and a cleric who has stepped onto the Ethereal Plane is at no
   * distance at all — not sixty feet, not sixty-one. `separated-beyond` does
   * not end the casting for the same reason (a pair nobody can measure has not
   * been separated), so this is the one live case of the fence's withholding
   * arm: the benefits are not held, the blow is reported rather than dealt, and
   * the bond goes on running. (W7-S19R)
   */
  it('withholds the benefits and reports the shared blow when the two cannot be measured', () => {
    const { log, casting } = bonded();
    const away: readonly GameEvent[] = [
      ...log,
      {
        type: 'creature-sent-elsewhere',
        id: CLERIC,
        kind: 'ethereal',
        source: 'the Ethereal Plane',
        returns: { within: 0 },
      },
    ];
    const before = state(away);
    // Still running: nobody can say the two are more than sixty feet apart.
    expect(before.ongoing[casting]).toBeDefined();
    // And none of the three benefits is held.
    expect(armorClassOf(before, FIGHTER)).toBe(armorClassOf(state(SETUP), FIGHTER));
    expect(defensesOf(before, FIGHTER)['fire']?.resistant).toBeUndefined();
    expect(
      savingSupport(before, FIGHTER, before.creatures[FIGHTER]!, 'dex', {}).bonuses.some(
        (bonus) => bonus.source === 'Warding Bond',
      ),
    ).toBe(false);

    const burned = fire(before, FIGHTER, 8);
    const after = state([...away, ...burned.events]);
    // The whole eight, because the Resistance is withheld with the rest.
    expect(hp(after, FIGHTER)).toBe(hp(before, FIGHTER) - 8);
    // And the cleric takes none of it, with the reason said rather than guessed.
    expect(hp(after, CLERIC)).toBe(hp(before, CLERIC));
    expect(
      burned.unverified.some(
        (line) => line.includes('Warding Bond') && line.includes('nobody has placed one of them'),
      ),
    ).toBe(true);
  });

  /** The DM's own door shares too: the funnel is one. */
  it('shares an adjudicated amount, and says when the cleric’s defences could not be read', () => {
    const { log } = bonded();
    const before = state(log);
    const struck = unwrap(
      resolveDamage(before, FIGHTER, { amount: 6, source: 'a falling beam' }, supply('beam')),
      'the beam',
    );
    const after = state([...log, ...struck.events]);
    expect(hp(after, FIGHTER)).toBe(hp(before, FIGHTER) - 6);
    expect(hp(after, CLERIC)).toBe(hp(before, CLERIC) - 6);
    expect(struck.unverified.some((line) => line.includes('Warding Bond'))).toBe(true);
  });
});

/**
 * **The chain guard, and why it takes homebrew to reach.** SRD's own bond
 * cannot be chained: "It also ends if the spell is cast again on either of the
 * connected creatures" ends the first bond the moment a second one touches
 * either end, whoever casts it — so two mutually bonded clerics, and every
 * longer chain, are a state `replacedCastings` refuses to build. The guard in
 * `bondSharedDamage` is therefore about the door the engine promises
 * *homebrew*: a spell that shares damage and prints no recast clause, loaded
 * through `createContent` like any other, may be laid both ways round, and one
 * blow must not bounce between two records for ever.
 *
 * The ruling the guard makes is **one hop**: a blow shared onto a creature is
 * not shared on to whoever bonded *them*. That is wider than either printed
 * sentence — it stops a three-deep chain that is not a loop as well as the loop
 * — and it is the conservative direction, because the alternative is a walk
 * whose length is the number of bonds in play. (W7-S19R)
 */
describe('a blow travels one hop and no further', () => {
  /** A bond with the recast clause left off, which is the only way to lay two. */
  const TWINNED: SpellDefinition = {
    id: 'twinned-hurt',
    name: 'Twinned Hurt',
    level: 2,
    school: 'abjuration',
    castingTime: 'action',
    concentration: false,
    range: { kind: 'ranged', feet: 60 },
    targets: { count: 1, willing: true },
    effects: [],
    sharesDamage: { with: 'caster' },
    durationSeconds: 600,
    // A fixture bond rather than a printed spell: the shared damage is the
    // whole of what it does, and the validator asks a spell that resolves
    // nothing to say so.
    unmodelled: ['whatever the connection is besides the damage it passes on is the DM’s'],
  };

  const content = unwrap(extendContent(SRD_CONTENT, { spells: [TWINNED] }), 'the homebrew bond');
  const homebrew = (seed: string) => ({
    issuer: createRollIssuer('r'),
    rng: createRng(seed) as Rng,
    content,
  });

  /** Both clerics know it and both have a slot. */
  const CHAIN: readonly GameEvent[] = [
    ...SETUP,
    {
      type: 'spellcasting-declared',
      id: CLERIC,
      spellcasting: declaredCasting({ ability: 'wis', prepared: ['warding-bond', 'twinned-hurt'] }),
    },
    {
      type: 'spellcasting-declared',
      id: ROGUE,
      spellcasting: declaredCasting({ ability: 'wis', prepared: ['twinned-hurt'] }),
    },
    {
      type: 'resource-pool-declared',
      id: ROGUE,
      pool: { key: spellSlotKey(2), label: 'level 2', max: 4, recovers: 'long-rest' },
    },
  ];

  /** The cleric bonds the rogue, and the rogue bonds the cleric back. */
  const bothWays = (): readonly GameEvent[] => {
    const first = unwrap(
      resolveSpell(
        state(CHAIN),
        CLERIC,
        { spellId: 'twinned-hurt', targets: [ROGUE], slotLevel: 2, willing: [ROGUE] },
        homebrew('first'),
      ),
      'the cleric’s bond',
    );
    const log = [...CHAIN, ...first.events];
    const second = unwrap(
      resolveSpell(
        state(log),
        ROGUE,
        { spellId: 'twinned-hurt', targets: [CLERIC], slotLevel: 2, willing: [CLERIC] },
        homebrew('second'),
      ),
      'the rogue’s bond',
    );
    return [...log, ...second.events];
  };

  const burn = (world: GameState, target: CharacterId, seed: string) =>
    unwrap(
      dealSpellDamage(
        world,
        target,
        [{ source: 'a torch', type: 'fire', roll: null, flat: 8, total: 8 }],
        'a torch',
        { ...homebrew(seed), issuer: createRollIssuer('r') },
        { by: GOBLIN },
      ),
      'the torch',
    );

  it('is a shape the validator accepts and SRD’s own bond refuses to be chained into', () => {
    expect(checkSpellDefinition(TWINNED)).toEqual([]);
    // Two of SRD's own cannot coexist: the second ends the first outright.
    const first = bonded(FIGHTER);
    const second = bonded(ROGUE, first.log);
    expect(state(second.log).ongoing[first.casting]).toBeUndefined();
  });

  it('lays two homebrew bonds the other way round without ending either', () => {
    const both = state(bothWays());
    expect(Object.values(both.ongoing).filter((one) => one.spellId === 'twinned-hurt')).toHaveLength(2);
  });

  it('costs the other creature the same once, and costs nobody a second time', () => {
    const log = bothWays();
    const before = state(log);

    // A blow on the rogue: the cleric's bond passes it to the cleric, and the
    // cleric's own share is not passed back down the rogue's bond.
    const onRogue = burn(before, ROGUE, 'rogue');
    const afterRogue = state([...log, ...onRogue.events]);
    expect(hp(afterRogue, ROGUE)).toBe(hp(before, ROGUE) - 8);
    expect(hp(afterRogue, CLERIC)).toBe(hp(before, CLERIC) - 8);
    expect(onRogue.events.filter((event) => event.type === 'damage-taken')).toHaveLength(2);

    // And the other way round, which is the same sentence read from the other
    // end: a blow on the cleric costs the rogue and stops there.
    const onCleric = burn(before, CLERIC, 'cleric');
    const afterCleric = state([...log, ...onCleric.events]);
    expect(hp(afterCleric, CLERIC)).toBe(hp(before, CLERIC) - 8);
    expect(hp(afterCleric, ROGUE)).toBe(hp(before, ROGUE) - 8);
    expect(onCleric.events.filter((event) => event.type === 'damage-taken')).toHaveLength(2);
  });
});

describe('what ends the bond', () => {
  it('ends when the cleric drops to 0 Hit Points', () => {
    const { log, casting } = bonded();
    const before = state(log);
    expect(before.ongoing[casting]).toBeDefined();
    const felled = fire(before, CLERIC, 100);
    const after = state([...log, ...felled.events]);
    expect(hp(after, CLERIC)).toBe(0);
    expect(after.ongoing[casting]).toBeUndefined();
    expect(defensesOf(after, FIGHTER)['fire']?.resistant).toBeUndefined();
  });

  it('ends when the two drift more than sixty feet apart, and not at sixty', () => {
    const { log, casting } = bonded();
    expect(state([...log, apartBy(60)]).ongoing[casting]).toBeDefined();
    const after = state([...log, apartBy(65)]);
    expect(after.ongoing[casting]).toBeUndefined();
    expect(armorClassOf(after, FIGHTER)).toBe(armorClassOf(state(SETUP), FIGHTER));
    // The caster walking away ends it too: the fact is the distance, not who moved.
    const clericWalks: GameEvent = {
      type: 'creature-moved',
      id: CLERIC,
      placement: { from: { creature: FIGHTER }, feet: 65, bearing: 270 },
      forced: true,
    };
    expect(state([...log, clericWalks]).ongoing[casting]).toBeUndefined();
  });

  it('ends when the cleric casts it again on somebody else', () => {
    const first = bonded(FIGHTER);
    const second = bonded(ROGUE, first.log);
    const after = state(second.log);
    expect(after.ongoing[first.casting]).toBeUndefined();
    expect(after.ongoing[second.casting]).toBeDefined();
    expect(defensesOf(after, FIGHTER)['fire']?.resistant).toBeUndefined();
    expect(defensesOf(after, ROGUE)['fire']?.resistant).toBe(true);
  });
});
