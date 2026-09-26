import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import {
  availableChecks,
  resolveEffectCheck,
  resolveSpell,
  resolveTurn,
  settleAreaEffects,
} from './commands.js';

/**
 * SRD Phantasmal Force, and the third moment nothing scheduled.
 *
 * > "You attempt to craft an illusion in the mind of a creature you can see
 * > within range. The target makes an Intelligence saving throw. On a failed
 * > save, you create a phantasmal object, creature, or other phenomenon that is
 * > no larger than a 10-foot Cube and that is perceivable only to the target for
 * > the duration." / "The target can take a Study action to examine the phantasm
 * > with an Intelligence (Investigation) check against your spell save DC. If
 * > the check succeeds, the target realizes that the phantasm is an illusion,
 * > and the spell ends." / "On each of your turns, such a phantasm can deal 2d8
 * > Psychic damage to the target if it is in the phantasm's area or within 5 feet
 * > of the phantasm."
 *
 * Three filed blockers and only one of them was real. `SpellCheck.onSuccess:
 * 'end-casting'` had been built for Ensnaring Strike and `AreaTrigger.within` for
 * Flaming Sphere; what nothing could say was **a payout owed at the caster's own
 * boundary**. `AreaTrigger.at: 'start-of-casters-turn'` is that moment, read
 * against the pinned target's position rather than against whoever is standing
 * there — `onlyTarget`, because the phantasm is perceivable only to the one mind
 * it is in.
 *
 * **The phantasm is a place and the Cube is what it looks like.** The book never
 * puts the Cube anywhere and never makes it catch anybody; what reaches a creature
 * is "in the phantasm's area **or within 5 feet of the phantasm**", so the template
 * is the space the illusion occupies and the five feet is the whole clause.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BARD = id('bard');
const GOBLIN = id('goblin');
const ALLY = id('ally');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 8, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'cha',
  ...over,
});

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The space the phantasm takes: the goblin's own, thirty feet from the bard. */
const CUBE = { x: 130, y: 100, z: 0 };

const HALL: readonly GameEvent[] = [
  added(BARD, 'party', { abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 18 } }),
  added(GOBLIN, 'goblins'),
  added(ALLY, 'goblins'),
  {
    type: 'spellcasting-declared',
    id: BARD,
    spellcasting: declaredCasting({
      ability: 'cha',
      classId: 'bard',
      prepared: ['phantasmal-force'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: BARD,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: BARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { point: CUBE }, feet: 0 } },
  // **Five feet from the phantasm, which is inside its reach.** That is what makes
  // `onlyTarget` observable: the geometry catches this creature and the clause does
  // not, because the illusion is in one mind.
  {
    type: 'creature-placed',
    id: ALLY,
    placement: { from: { point: { x: 135, y: 100, z: 0 } }, feet: 0 },
  },
  { type: 'sight-declared', from: BARD, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: GOBLIN, to: BARD, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: BARD, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: ALLY, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const crafted = (seed: string) => {
  const out = must(
    resolveSpell(
      fold('seed', HALL),
      BARD,
      {
        spellId: 'phantasmal-force',
        targets: [GOBLIN],
        slotLevel: 2,
        at: CUBE,
      },
      supply(seed),
    ),
    'Phantasmal Force',
  );
  const log = [...HALL, ...out.events];
  return { out, log, state: fold('seed', log) as GameState, castingId: out.castingId! };
};

const seedWhere = (success: boolean): string => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n']) {
    const { out } = crafted(seed);
    if (out.outcomes[0]?.save?.success === success) return seed;
  }
  throw new Error(`no seed makes the goblin's save ${success ? 'hold' : 'fail'}`);
};

/** Round the table once, back to the bard's own turn, settling what it owes. */
const roundTo = (log: readonly GameEvent[], seed: string) => {
  let current = [...log];
  for (let i = 0; i < 3; i += 1) {
    const turn = must(resolveTurn(fold('seed', current) as GameState, supply(seed)), 'the turn');
    current = [...current, ...turn.events];
    const settled = must(
      settleAreaEffects(fold('seed', current) as GameState, supply(seed)),
      'the settlement',
    );
    current = [...current, ...settled.events];
  }
  return { log: current, state: fold('seed', current) as GameState };
};

describe('Phantasmal Force', () => {
  it('asks the target for an Intelligence save and ends on a success', () => {
    const resisted = crafted(seedWhere(true));
    expect(resisted.out.outcomes.map((one) => one.target)).toEqual([GOBLIN]);
    expect(resisted.state.ongoing[resisted.castingId]).toBeUndefined();
    expect(resisted.out.events.find((event) => event.type === 'spell-ended')).toMatchObject({
      reason: 'resisted',
    });
  });

  it('crafts the phantasm on a failure, and singles the target out', () => {
    const held = crafted(seedWhere(false));
    const record = held.state.ongoing[held.castingId]!;
    expect(record.singledOut).toBe(GOBLIN);
    expect(record.area).toEqual({ kind: 'sphere', radius: 0, origin: 'point' });
    expect(record.origin).toEqual(CUBE);
  });

  it('deals 2d8 Psychic to the target at the start of the caster’s turn', () => {
    const held = crafted(seedWhere(false));
    const round = roundTo(held.log, 'turns');
    const dice = round.log.filter((event) => event.type === 'damage-dice-recorded');
    expect(dice.length).toBeGreaterThan(0);
    for (const rolled of dice) {
      if (rolled.type !== 'damage-dice-recorded') throw new Error('filtered');
      expect(rolled.target).toBe(GOBLIN);
      expect(rolled.components.map((part) => part.type)).toEqual(['psychic']);
      expect(rolled.components[0]!.dice.length).toBe(2);
    }
    // **And nobody else, though the geometry caught them.** The ally stands five
    // feet from the phantasm — inside the reach the sentence prints — and takes
    // nothing, because the illusion is perceivable only to the one mind it is in.
    // This is what `onlyTarget` is, and without it this line fails.
    const hurt = round.log.filter((event) => event.type === 'damage-taken');
    expect(hurt.length).toBeGreaterThan(0);
    expect(hurt.every((blow) => blow.type === 'damage-taken' && blow.id === GOBLIN)).toBe(true);
  });

  it('deals nothing to a target that has walked out of the phantasm’s reach', () => {
    const held = crafted(seedWhere(false));
    const away: readonly GameEvent[] = [
      ...held.log,
      // Ten feet past the Cube's far face, which is more than the five the
      // sentence reaches.
      {
        type: 'creature-moved',
        id: GOBLIN,
        placement: { from: { point: { x: 165, y: 100, z: 0 } }, feet: 0 },
        forced: true,
      } satisfies GameEvent,
    ];
    const round = roundTo(away, 'turns');
    expect(round.log.filter((event) => event.type === 'damage-dice-recorded')).toEqual([]);
  });

  it('ends when the target sees through it with a Study-action Investigation check', () => {
    const crafting = crafted(seedWhere(false));
    // The Study is an action, so it is taken on the goblin's own turn.
    const turn = must(resolveTurn(crafting.state, supply('turn')), 'the bard finishing');
    const held = {
      log: [...crafting.log, ...turn.events],
      castingId: crafting.castingId,
      state: fold('seed', [...crafting.log, ...turn.events]) as GameState,
    };
    const offered = availableChecks(held.state, GOBLIN);
    expect(offered.map((one) => one.skill)).toEqual(['investigation']);
    expect(offered[0]!.onSuccess).toBe('end-casting');
    // The bard's own DC, and nobody else's check.
    expect(offered[0]!.dc).toBe(15);
    expect(availableChecks(held.state, ALLY)).toEqual([]);

    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
      const out = must(
        resolveEffectCheck(held.state, GOBLIN, { effectKey: offered[0]!.effectKey }, supply(seed)),
        'the Study',
      );
      if (!out.success) continue;
      const after = fold('seed', [...held.log, ...out.events]) as GameState;
      expect(after.ongoing[held.castingId]).toBeUndefined();
      return;
    }
    throw new Error('no seed makes the goblin see through it');
  });

  it('refuses a creature the phantasm’s own space does not hold', () => {
    const refused = resolveSpell(
      fold('seed', HALL),
      BARD,
      { spellId: 'phantasmal-force', targets: [ALLY], slotLevel: 2, at: CUBE },
      supply('elsewhere'),
    );
    expect(isErr(refused) && refused.code).toBe('not_in_the_area');
  });
});
