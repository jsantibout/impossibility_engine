import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  contextRequestsOf,
  expect as unwrap,
  isErr,
  isNeedsContext,
  type CharacterId,
  type Result,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import type { Placement } from './positioning.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { declaredCasting } from './spellcasting.js';
import {
  advanceTime,
  commandSummons,
  declareBones,
  pendingCastingsOf,
  resolveDeclaredCast,
  resolveSpell,
} from './commands.js';

/**
 * The two sentences of SRD Animate Dead that stood as debts.
 *
 * > "Choose a **pile of bones** or a corpse of a Medium or Small Humanoid within
 * > range." / "On each of your turns, you can take a **Bonus Action** to
 * > mentally command any creature you made with this spell if the creature is
 * > **within 60 feet** of you (if you control multiple creatures, you can
 * > command any of them at the same time, issuing the same command to each
 * > one)."
 *
 * **A pile of bones is the table's to have said.** The DM lays one in the room
 * (`declareBones`); a Skeleton rises only where a pile lies, asked about before
 * the slot or the rite where none was said, and the pile goes with it.
 *
 * **An order costs a Bonus Action and reaches sixty feet**, pinned on each
 * controlled bond and charged by `commandSummons`: once for every creature
 * given the same order together, each within the feet. What the order says is
 * reported and never performed.
 */

const id = (s: string) => asCharacterId(s);
const WIZ = id('wiz');
const FOE = id('foe');

const sheet = (): CharacterSheet => ({
  level: 9,
  abilities: { str: 10, dex: 14, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const SETUP: readonly GameEvent[] = [
  { type: 'creature-added', id: WIZ, name: WIZ, sheet: sheet(), maxHp: 80, diesAtZero: false, creatureType: 'Humanoid', side: 'party' },
  { type: 'creature-added', id: FOE, name: FOE, sheet: sheet(), maxHp: 80, diesAtZero: false, creatureType: 'Humanoid', side: 'foes' },
  {
    type: 'spellcasting-declared',
    id: WIZ,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['animate-dead'] }),
  },
  ...[3, 4].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: WIZ,
      pool: { key: `spell-slot:${level}`, label: `level ${level}`, max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the crypt', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: WIZ, placement: { from: { landmark: 'the crypt' }, feet: 0 } },
  { type: 'creature-placed', id: FOE, placement: { from: { creature: WIZ }, feet: 30, bearing: 270 } },
];

const supply = (seed = 'rite') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);
const codeOf = (result: Result<unknown>): string | null => (isErr(result) ? result.code : null);
const step = (state: GameState, events: readonly GameEvent[]): GameState => events.reduce(applyEvent, state);

const pile = (bearing: number): Placement => ({ from: { creature: WIZ }, feet: 5, bearing });

/** The DM lays a pile of bones where this placement points. */
const laid = (state: GameState, name: string, where: Placement): GameState =>
  step(state, must(declareBones(state, name, where), 'bones'));

/** The minute's rite over the piles named, waited out and settled. */
const rite = (state: GameState, bonesAt: readonly Placement[], slotLevel = 3): Result<GameState> => {
  const declared = resolveSpell(state, WIZ, { spellId: 'animate-dead', targets: [], slotLevel, bonesAt }, supply());
  if (!declared.ok) return declared;
  let current = step(state, declared.value.events);
  current = step(current, must(advanceTime(current, 60, 'the rite'), 'minute'));
  const castingId = pendingCastingsOf(current)[0]!.castingId;
  const settled = resolveDeclaredCast(current, castingId, supply('settle'));
  if (!settled.ok) return settled;
  return { ok: true, value: step(current, settled.value.events) };
};

const raised = (state: GameState): readonly CharacterId[] =>
  (Object.keys(state.creatures) as CharacterId[]).filter((key) => key !== WIZ && key !== FOE).sort();

describe('"a pile of bones" is the table’s to have said', () => {
  it('raises a Skeleton out of a pile the DM laid, and takes the pile', () => {
    const state = must(rite(laid(fold('seed', SETUP), 'the ossuary', pile(45)), [pile(45)]), 'the rite');
    expect(raised(state).map((who) => state.creatures[who]!.name)).toEqual(['Skeleton']);
    expect(state.scene?.bones?.['the ossuary']).toBeUndefined();
  });

  it('asks where nobody has said bones lie, before the slot or the rite', () => {
    const before = fold('seed', SETUP);
    const out = rite(before, [pile(45)]);
    expect(codeOf(out)).toBe('bones_unstated');
    expect(isNeedsContext(out)).toBe(true);
    expect(contextRequestsOf(out)[0]?.satisfyWith).toContain('declareBones');
    expect(pendingCastingsOf(before)).toEqual([]);
  });

  it('asks about every pile it is pointed at, not only the first', () => {
    const state = laid(fold('seed', SETUP), 'the ossuary', pile(45));
    const out = rite(state, [pile(45), pile(135)], 4);
    expect(codeOf(out)).toBe('bones_unstated');
  });

  it('leaves a pile it was not pointed at lying where it was', () => {
    const state = must(
      rite(laid(laid(fold('seed', SETUP), 'east', pile(90)), 'west', pile(270)), [pile(90)]),
      'the rite',
    );
    expect(Object.keys(state.scene?.bones ?? {})).toEqual(['west']);
  });

  it('asks at the raising too, where the pile was taken away during the minute', () => {
    let state = laid(fold('seed', SETUP), 'the ossuary', pile(45));
    const declared = must(
      resolveSpell(state, WIZ, { spellId: 'animate-dead', targets: [], slotLevel: 3, bonesAt: [pile(45)] }, supply()),
      'declare',
    );
    state = step(state, declared.events);
    state = step(state, must(declareBones(state, 'the ossuary', null), 'cleared'));
    state = step(state, must(advanceTime(state, 60, 'the rite'), 'minute'));
    const out = resolveDeclaredCast(state, pendingCastingsOf(state)[0]!.castingId, supply('settle'));
    expect(codeOf(out)).toBe('bones_unstated');
    expect(isNeedsContext(out)).toBe(true);
  });

  it('is refused a pile outside the scene', () => {
    const out = declareBones(fold('seed', SETUP), 'the void', { from: { creature: WIZ }, feet: 9000, bearing: 0 });
    expect(isErr(out) && out.code).toBe('outside_scene');
  });
});

describe('the order and what it costs', () => {
  /** Two Skeletons raised out of two piles, and then a fight with the wizard's turn first. */
  const twoInAFight = (): { state: GameState; skeletons: readonly CharacterId[] } => {
    let state = laid(laid(fold('seed', SETUP), 'east', pile(90)), 'west', pile(270));
    state = must(rite(state, [pile(90), pile(270)], 4), 'the rite');
    const skeletons = raised(state);
    state = step(state, [
      {
        type: 'combat-started',
        combatants: [
          { id: WIZ, initiative: 20, speed: 30 },
          ...skeletons.map((who, i) => ({ id: who, initiative: 15 - i, speed: 30 })),
          { id: FOE, initiative: 5, speed: 30 },
        ],
      },
    ]);
    return { state, skeletons };
  };

  it('pins the Bonus Action and the sixty feet on each controlled bond', () => {
    const { state, skeletons } = twoInAFight();
    for (const who of skeletons) {
      expect(state.creatures[who]?.summonedBy?.controlled?.commanded).toEqual({ costs: 'bonus-action', within: 60 });
    }
  });

  it('spends the Bonus Action once for every creature given the same order', () => {
    const { state, skeletons } = twoInAFight();
    const out = must(
      commandSummons(state, WIZ, { who: skeletons[0]!, also: [skeletons[1]!], order: 'guard the stair' }, supply()),
      'the order',
    );
    expect(out.events.filter((event) => event.type === 'bonus-action-spent')).toHaveLength(1);
    expect(out.unverified.some((line) => line.includes('guard the stair'))).toBe(true);

    const again = commandSummons(step(state, out.events), WIZ, { who: skeletons[0]! }, supply());
    expect(isErr(again)).toBe(true);
  });

  it('reaches only a creature within sixty feet', () => {
    const { state, skeletons } = twoInAFight();
    const far = step(state, [
      { type: 'creature-moved', id: skeletons[0]!, placement: { from: { creature: WIZ }, feet: 65, bearing: 90 }, forced: true },
    ]);
    const out = commandSummons(far, WIZ, { who: skeletons[0]! }, supply());
    expect(isErr(out) && out.code).toBe('out_of_command_range');
  });

  it('moves nothing now: the order is for the creature’s own turn', () => {
    const { state, skeletons } = twoInAFight();
    const out = commandSummons(
      state,
      WIZ,
      { who: skeletons[0]!, to: { from: { creature: WIZ }, feet: 10, bearing: 0 } },
      supply(),
    );
    expect(isErr(out) && out.code).toBe('order_moves_nothing');
  });

  it('costs nothing outside a fight, where there is no economy to spend', () => {
    let state = laid(fold('seed', SETUP), 'east', pile(90));
    state = must(rite(state, [pile(90)]), 'the rite');
    const out = must(commandSummons(state, WIZ, { who: raised(state)[0]!, order: 'stand still' }, supply()), 'order');
    expect(out.events).toEqual([]);
  });
});

describe('what a definition may say about the order', () => {
  const codes = (commandedWith: unknown): readonly string[] =>
    checkSpellDefinitionValue({
      ...SRD_CONTENT.spell('animate-dead')!,
      effects: [{ ...SRD_CONTENT.spell('animate-dead')!.effects[0]!, commandedWith }],
    }).map((one) => one.code);

  it('takes the book as written', () => {
    expect(codes({ costs: 'bonus-action', within: 60 })).toEqual([]);
  });

  it('refuses another price, or feet off the lattice', () => {
    expect(codes({ costs: 'action', within: 60 })).toContain('bad_summon_command');
    expect(codes({ costs: 'bonus-action', within: 62 })).toContain('bad_summon_command');
  });
});
