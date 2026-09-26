import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { advanceTime, resolveDeclaredCast, resolveSpell } from './commands.js';

/**
 * SRD Find Familiar, the touch the familiar delivers.
 *
 * > "Finally, when you cast a spell with a range of touch, your familiar can
 * > deliver the touch. Your familiar must be within 100 feet of you, and it must
 * > take a Reaction to deliver the touch when you cast the spell."
 *
 * The one sentence in the book that lets a **second creature** carry a casting
 * that belongs to somebody else, and it is not an activation: the spell is cast
 * now, by its caster, with its caster's numbers — what moves is the hand the
 * touch is measured from. So `CastSpellRequest.deliveredBy` names the creature,
 * the bond says whether that creature may (`KeptBond.delivers`, off
 * `KeptSummons.delivers` — the permission is Find Familiar's own sentence and
 * lives on the definition rather than in the command), the hundred feet is
 * checked, the familiar's Reaction is spent, and the spell's Touch is measured
 * from the familiar's square.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const WIZARD = id('wizard');
const FIGHTER = id('fighter');
const STRANGER = id('stranger');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

/** The wizard, a fighter sixty feet off, and a stranger with no bond at all. */
const ROOM: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(FIGHTER, 'party'),
  added(STRANGER, 'party'),
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      classId: 'wizard',
      prepared: ['find-familiar', 'cure-wounds', 'magic-missile'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: WIZARD,
    pool: { key: 'spell-slot:1', label: 'level 1', max: 4, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the tower', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the tower' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: FIGHTER,
    placement: { from: { creature: WIZARD }, feet: 60, bearing: 90 },
  },
  {
    type: 'creature-placed',
    id: STRANGER,
    placement: { from: { creature: FIGHTER }, feet: 5, bearing: 90 },
  },
];

/** The rite, an hour long, and the owl it leaves standing beside the fighter. */
const withOwl = () => {
  const declared = must(
    resolveSpell(
      fold('seed', ROOM),
      WIZARD,
      { spellId: 'find-familiar', targets: [WIZARD], slotLevel: 1, form: 'owl', choice: 'Fey' },
      supply('rite'),
    ),
    'Find Familiar',
  );
  const open = [...ROOM, ...declared.events];
  const tick = must(advanceTime(fold('seed', open) as GameState, 3600, 'the rite'), 'an hour');
  const ticked = [...open, ...tick];
  const settled = must(
    resolveDeclaredCast(fold('seed', ticked) as GameState, declared.castingId!, supply('rite')),
    'the rite ends',
  );
  const log = [...ticked, ...settled.events];
  const state = fold('seed', log) as GameState;
  const owl = Object.keys(state.creatures).find(
    (who) => state.creatures[who as CharacterId]?.summonedBy?.by === WIZARD,
  ) as CharacterId;
  // Beside the fighter, sixty feet from the wizard, which is inside the hundred
  // the bond allows and outside the wizard's own reach.
  const placed: readonly GameEvent[] = [
    ...log,
    {
      type: 'creature-placed',
      id: owl,
      placement: { from: { creature: FIGHTER }, feet: 5, bearing: 270 },
    } satisfies GameEvent,
    {
      type: 'combat-started',
      combatants: [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: owl, initiative: 15, speed: 30 },
        { id: FIGHTER, initiative: 10, speed: 30 },
        { id: STRANGER, initiative: 5, speed: 30 },
      ],
    } satisfies GameEvent,
  ];
  return { owl, log: placed, state: fold('seed', placed) as GameState };
};

describe("a familiar delivering its wizard's touch", () => {
  it('binds an owl that the spell says may deliver a touch', () => {
    const { owl, state } = withOwl();
    // The permission and the hundred feet, both off the spell's own sentence.
    expect(state.creatures[owl]!.summonedBy!.kept!.delivers).toEqual({ within: 100 });
  });

  it('reaches a creature sixty feet from the wizard and five from the owl', () => {
    const { owl, state } = withOwl();
    const healed = must(
      resolveSpell(
        state,
        WIZARD,
        { spellId: 'cure-wounds', targets: [FIGHTER], slotLevel: 1, deliveredBy: owl },
        supply('touch'),
      ),
      'Cure Wounds',
    );
    // The owl's Reaction went, and the wizard's Action.
    expect(healed.events.some((event) => event.type === 'reaction-spent' && event.id === owl)).toBe(
      true,
    );
    expect(healed.events.some((event) => event.type === 'action-spent' && event.id === WIZARD)).toBe(
      true,
    );
    // The log says whose hand it was.
    const cast = healed.events.find((event) => event.type === 'spell-cast');
    expect(cast).toMatchObject({ deliveredBy: owl });
    // And it really resolved on somebody the wizard could not have reached.
    expect(healed.outcomes.map((one) => one.target)).toEqual([FIGHTER]);
    expect(healed.castingId!.length).toBeGreaterThan(0);
  });

  it('refuses a creature the owl cannot reach either', () => {
    const { owl, state } = withOwl();
    // Ten feet from the owl, which is twice the Touch the spell prints.
    const refused = resolveSpell(
      state,
      WIZARD,
      { spellId: 'cure-wounds', targets: [STRANGER], slotLevel: 1, deliveredBy: owl },
      supply('touch'),
    );
    expect(isErr(refused) && refused.code).toBe('out_of_range');
  });

  it('refuses an owl more than a hundred feet away', () => {
    const { owl, log } = withOwl();
    const far: readonly GameEvent[] = [
      ...log,
      {
        type: 'creature-moved',
        id: owl,
        placement: { from: { creature: WIZARD }, feet: 200, bearing: 90 },
        forced: true,
      } satisfies GameEvent,
    ];
    const refused = resolveSpell(
      fold('seed', far) as GameState,
      WIZARD,
      { spellId: 'cure-wounds', targets: [FIGHTER], slotLevel: 1, deliveredBy: owl },
      supply('touch'),
    );
    expect(isErr(refused) && refused.code).toBe('deliverer_too_far');
  });

  it('refuses a creature that is nobody’s familiar', () => {
    const { state } = withOwl();
    const refused = resolveSpell(
      state,
      WIZARD,
      { spellId: 'cure-wounds', targets: [FIGHTER], slotLevel: 1, deliveredBy: STRANGER },
      supply('touch'),
    );
    expect(isErr(refused) && refused.code).toBe('cannot_deliver');
  });

  it('refuses a spell whose range is not Touch', () => {
    const { owl, state } = withOwl();
    const refused = resolveSpell(
      state,
      WIZARD,
      { spellId: 'magic-missile', targets: [FIGHTER], slotLevel: 1, deliveredBy: owl },
      supply('darts'),
    );
    expect(isErr(refused) && refused.code).toBe('not_a_touch');
  });

  it('refuses an owl whose Reaction has already gone', () => {
    const { owl, log } = withOwl();
    const spent: readonly GameEvent[] = [...log, { type: 'reaction-spent', id: owl }];
    const refused = resolveSpell(
      fold('seed', spent) as GameState,
      WIZARD,
      { spellId: 'cure-wounds', targets: [FIGHTER], slotLevel: 1, deliveredBy: owl },
      supply('touch'),
    );
    expect(isErr(refused) && refused.code).toBe('no_reaction');
  });
});
