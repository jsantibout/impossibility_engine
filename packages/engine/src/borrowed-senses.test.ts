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
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { canSee, sensesOf } from './standing.js';
import {
  advanceTime,
  borrowSenses,
  resolveDeclaredCast,
  resolveSpell,
  resolveTurn,
} from './commands.js';

/**
 * SRD Find Familiar, the third door on the kept bond.
 *
 * > "As a Bonus Action, you can see through the familiar's eyes and hear what
 * > it hears until the start of your next turn, gaining the benefits of any
 * > special senses it has."
 *
 * Find Familiar is Instantaneous and leaves no casting to activate through, so
 * this is a door on the bond beside `dismissKeptSummons` and
 * `recallKeptSummons`. The permission is the spell's — `KeptSummons.lends`,
 * which Find Familiar writes and Find Steed does not — and what the Bonus
 * Action leaves is a `senses-borrowed` record on the caster until the start of
 * their next turn, read in two places only: `canSee` (yes where the familiar
 * sees) and `sensesOf` (the familiar's senses for the caster). The declared
 * sight model stays three-valued: where the familiar's own answer is not yes,
 * the caster's is what it always was.
 *
 * **Which senses the familiar has is the engine's answer, not the stat
 * block's**, and the two differ today: a block's printed Senses line — the
 * Owl's "Darkvision 120 ft." — reaches no sheet (`adaptMonster` puts it
 * nowhere `sensesOf` reads), so the owl here is given its Darkvision the way
 * the engine does give one, by the Darkvision spell, and it is that sense the
 * wizard borrows. The printed line is the bestiary's gap, and it is recorded
 * on Find Familiar's own `unmodelled` rather than papered over here.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const GOBLIN = id('goblin');
const FIGHTER = id('fighter');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 18, wis: 10, cha: 16 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, side: string, creatureType = 'Humanoid'): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType,
  side,
});

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const TOWER: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(FIGHTER, 'party'),
  added(GOBLIN, 'goblins', 'Fey'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['find-familiar', 'darkvision'] }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:2', label: 'level 2', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the tower', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the tower' }, feet: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { creature: WIZARD }, feet: 30, bearing: 180 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 80, bearing: 90 } },
];

/** The rite, an hour, and the owl it leaves on the stair — then the fight. */
const withOwl = (fight = true) => {
  const declared = must(
    resolveSpell(
      fold('seed', TOWER),
      WIZARD,
      { spellId: 'find-familiar', targets: [WIZARD], slotLevel: 1, form: 'owl', choice: 'Fey' },
      supply('rite'),
    ),
    'Find Familiar',
  );
  const open = [...TOWER, ...declared.events];
  const ticked = [...open, ...must(advanceTime(fold('seed', open) as GameState, 3600, 'the rite'), 'an hour')];
  const settled = must(
    resolveDeclaredCast(fold('seed', ticked) as GameState, declared.castingId!, supply('rite')),
    'the rite ends',
  );
  const log = [...ticked, ...settled.events];
  const state = fold('seed', log) as GameState;
  const owl = Object.keys(state.creatures).find(
    (who) => state.creatures[who as CharacterId]?.summonedBy?.by === WIZARD,
  ) as CharacterId;
  // The owl on the wizard's arm, touched with Darkvision — the sense it will
  // lend — and then sent up the stair.
  const perched: GameEvent[] = [
    ...log,
    { type: 'creature-placed', id: owl, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
  ];
  const touched = must(
    resolveSpell(
      fold('seed', perched) as GameState,
      WIZARD,
      { spellId: 'darkvision', targets: [owl], willing: [owl], slotLevel: 2 },
      supply('dark'),
    ),
    'Darkvision on the owl',
  );
  const placed: GameEvent[] = [
    ...perched,
    ...touched.events,
    { type: 'creature-moved', id: owl, placement: { from: { creature: GOBLIN }, feet: 20, bearing: 270 }, forced: true },
    // The owl on the stair sees the goblin; the wizard, round the corner, does
    // not — both declared, because that is the model.
    { type: 'sight-declared', from: owl, to: GOBLIN, seen: true },
    { type: 'sight-declared', from: WIZARD, to: GOBLIN, seen: false },
  ];
  if (fight) {
    placed.push({
      type: 'combat-started',
      combatants: [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: owl, initiative: 15, speed: 30 },
        { id: FIGHTER, initiative: 10, speed: 30 },
        { id: GOBLIN, initiative: 5, speed: 30 },
      ],
    });
  }
  return { owl, log: placed, state: fold('seed', placed) as GameState };
};

const darkvisionOf = (state: GameState, who: CharacterId) =>
  sensesOf(state, who).find((sense) => sense.sense === 'darkvision');

/** Round the table, one turn at a time. */
const turns = (log: readonly GameEvent[], count: number): GameEvent[] => {
  let current = [...log];
  for (let i = 0; i < count; i += 1) {
    current = [...current, ...must(resolveTurn(fold('seed', current) as GameState, supply(`turn-${i}`)), 'turn').events];
  }
  return current;
};

describe('a familiar’s senses, borrowed', () => {
  it('lets the wizard see the goblin the owl sees, and read the owl’s Darkvision, for a Bonus Action', () => {
    const { owl, log, state } = withOwl();
    // The owl's Darkvision, which the wizard does not have.
    expect(darkvisionOf(state, owl)?.feet).toBe(150);
    expect(darkvisionOf(state, WIZARD)).toBeUndefined();
    expect(canSee(state, WIZARD, GOBLIN)).toBe(false);

    const borrowed = must(borrowSenses(state, SRD_CONTENT, WIZARD, { who: owl }), 'borrow');
    expect(borrowed.events.some((event) => event.type === 'bonus-action-spent' && event.id === WIZARD)).toBe(true);
    const after = fold('seed', [...log, ...borrowed.events]) as GameState;

    expect(canSee(after, WIZARD, GOBLIN)).toBe(true);
    expect(darkvisionOf(after, WIZARD)?.feet).toBe(150);
    // The owl's own sight is untouched, and nobody else borrowed anything.
    expect(canSee(after, owl, GOBLIN)).toBe(true);
    expect(darkvisionOf(after, FIGHTER)).toBeUndefined();
  });

  it('lasts until the start of the wizard’s next turn and not a moment longer', () => {
    const { owl, log, state } = withOwl();
    const borrowed = [...log, ...must(borrowSenses(state, SRD_CONTENT, WIZARD, { who: owl }), 'borrow').events];
    // The owl's, the fighter's and the goblin's turns: still looking.
    const lateInTheRound = turns(borrowed, 3);
    const still = fold('seed', lateInTheRound) as GameState;
    expect(canSee(still, WIZARD, GOBLIN)).toBe(true);
    expect(darkvisionOf(still, WIZARD)?.feet).toBe(150);
    // The wizard's next turn starts: the eyes are their own again.
    const back = fold('seed', turns(lateInTheRound, 1)) as GameState;
    expect(back.combat?.order[back.combat.turnIndex]?.id).toBe(WIZARD);
    expect(canSee(back, WIZARD, GOBLIN)).toBe(false);
    expect(darkvisionOf(back, WIZARD)).toBeUndefined();
  });

  it('keeps the model three-valued: where the owl does not see, the wizard’s own answer stands', () => {
    const { owl, log, state } = withOwl();
    const after = fold('seed', [
      ...log,
      ...must(borrowSenses(state, SRD_CONTENT, WIZARD, { who: owl }), 'borrow').events,
    ]) as GameState;
    // The fighter, thirty feet behind the wizard, whom nobody has declared
    // either of them sees: inside the owl's 150 feet of Darkvision, so the
    // owl's sense answers — and the wizard, looking through the owl, sees the
    // fighter too.
    expect(canSee(after, owl, FIGHTER)).toBe(true);
    expect(canSee(after, WIZARD, FIGHTER)).toBe(true);
    // Declared unseen by the owl, the owl's answer is no — and a no lends
    // nothing: the wizard's own eyes, holding the lent Darkvision, still answer.
    const hidden = fold('seed', [
      ...log,
      { type: 'sight-declared', from: owl, to: FIGHTER, seen: false },
      ...must(borrowSenses(state, SRD_CONTENT, WIZARD, { who: owl }), 'borrow').events,
    ]) as GameState;
    expect(canSee(hidden, owl, FIGHTER)).toBe(false);
    expect(canSee(hidden, WIZARD, FIGHTER)).toBe(true);
    // And where the owl's answer is no and the wizard's is a declared no, the
    // answer is no; nothing is invented either way.
    const walled = fold('seed', [
      ...log,
      { type: 'sight-declared', from: owl, to: FIGHTER, seen: false },
      { type: 'sight-declared', from: WIZARD, to: FIGHTER, seen: false },
      ...must(borrowSenses(state, SRD_CONTENT, WIZARD, { who: owl }), 'borrow').events,
    ]) as GameState;
    expect(canSee(walled, WIZARD, FIGHTER)).toBe(false);
    // And a creature beyond every sense in the room, whom nobody has declared:
    // still a question for both of them, borrowed eyes or not.
    const LURKER = id('lurker');
    const far = fold('seed', [
      ...log,
      added(LURKER, 'goblins'),
      { type: 'creature-placed', id: LURKER, placement: { from: { point: { x: 100, y: 500, z: 0 } }, feet: 0 } },
      ...must(borrowSenses(state, SRD_CONTENT, WIZARD, { who: owl }), 'borrow').events,
    ]) as GameState;
    expect(canSee(far, owl, LURKER)).toBeNull();
    expect(canSee(far, WIZARD, LURKER)).toBeNull();
  });

  it('refuses a creature the caster does not keep', () => {
    const { state } = withOwl();
    const refused = borrowSenses(state, SRD_CONTENT, WIZARD, { who: FIGHTER });
    expect(isErr(refused) && refused.code).toBe('not_your_summons');
  });

  it('asks for a turn outside a fight, where "the start of your next turn" has no meaning', () => {
    const { owl, state } = withOwl(false);
    const asked = borrowSenses(state, SRD_CONTENT, WIZARD, { who: owl });
    expect(isNeedsContext(asked)).toBe(true);
    expect(contextRequestsOf(asked)[0]?.kind).toBe('turn-order');
  });
});

describe('a steed’s senses, which its spell does not lend', () => {
  it('refuses the paladin, because Find Steed prints no such sentence', () => {
    const PALADIN = id('paladin');
    const stable: GameEvent[] = [
      added(PALADIN, 'party'),
      {
        type: 'spellcasting-declared',
        id: PALADIN,
        spellcasting: declaredCasting({ ability: 'cha', classId: 'paladin', prepared: ['find-steed'] }),
      },
      {
        type: 'resource-pool-declared',
        id: PALADIN,
        pool: { key: 'spell-slot:2', label: 'level 2', max: 2, recovers: 'long-rest' },
      },
      { type: 'scene-set', extent: { width: 200, depth: 200, height: 20 } },
      { type: 'landmark-added', name: 'the stable', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: PALADIN, placement: { from: { landmark: 'the stable' }, feet: 0 } },
      { type: 'combat-started', combatants: [{ id: PALADIN, initiative: 10, speed: 30 }] },
    ];
    const cast = must(
      resolveSpell(
        fold('seed', stable) as GameState,
        PALADIN,
        { spellId: 'find-steed', targets: [PALADIN], choice: 'Celestial', slotLevel: 2 },
        supply('steed'),
      ),
      'Find Steed',
    );
    const state = fold('seed', [...stable, ...cast.events]) as GameState;
    const steed = Object.keys(state.creatures).find(
      (who) => state.creatures[who as CharacterId]?.summonedBy?.by === PALADIN,
    ) as CharacterId;
    expect(steed).toBeDefined();
    const refused = borrowSenses(state, SRD_CONTENT, PALADIN, { who: steed });
    expect(isErr(refused) && refused.code).toBe('lends_nothing');
  });
});
