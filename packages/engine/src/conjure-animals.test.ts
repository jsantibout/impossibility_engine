import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declaredCasting } from './spellcasting.js';
import { savingSupport } from './commands/rolls.js';
import { resolveMove, resolveSpell, resolveTurn, settleAreaEffects } from './commands.js';

/**
 * SRD Conjure Animals: a pack that walks with its druid.
 *
 * > "You have Advantage on Strength saving throws while you're within 5 feet of
 * > the pack, and when you move on your turn, you can also move the pack up to 30
 * > feet to an unoccupied space you can see." / "Whenever the pack moves within 10
 * > feet of a creature you can see and whenever a creature you can see enters a
 * > space within 10 feet of the pack or ends its turn there, you can force that
 * > creature to make a Dexterity saving throw. On a failed save, the creature
 * > takes 3d10 Slashing damage. A creature makes this save only once per turn."
 *
 * Two things this spell waited on. **An area moved by the caster's own
 * movement**: `SpellDefinition.areaMovesWithCaster` is the allowance and
 * `MoveCommand.alsoMoves` is the rider, so the pack travels inside the one
 * command that moved the druid rather than through an action the spell does not
 * print. **A standing effect derived from where a creature stands**: the
 * Advantage on Strength saves is an `AreaStanding` clause read at the roll, five
 * feet from the pack's own point, and the caster's alone.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DRUID = id('druid');
const GOBLIN = id('goblin');
const BYSTANDER = id('bystander');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 18, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 80,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The pack's first space, twenty feet east of the druid. */
const PACK = { x: 120, y: 100, z: 0 };
/** And where the druid walks it: thirty feet on, five feet short of the goblin. */
const ONWARD = { x: 150, y: 100, z: 0 };

const MOOR: readonly GameEvent[] = [
  added(DRUID, 'party'),
  added(GOBLIN, 'goblins'),
  added(BYSTANDER, 'goblins'),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      classId: 'druid',
      prepared: ['conjure-animals'],
    }),
  },
  {
    type: 'resource-pool-declared',
    id: DRUID,
    pool: { key: 'spell-slot:3', label: 'level 3', max: 3, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the moor', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the moor' }, feet: 0 } },
  // Thirty-five feet from the pack's first space, which is out of its ten.
  {
    type: 'creature-placed',
    id: GOBLIN,
    placement: { from: { point: { x: 155, y: 100, z: 0 } }, feet: 0 },
  },
  // And one standing where the pack would be walked to, so the space is taken.
  {
    type: 'creature-placed',
    id: BYSTANDER,
    placement: { from: { point: { x: 200, y: 100, z: 0 } }, feet: 0 },
  },
  { type: 'sight-declared', from: DRUID, to: GOBLIN, seen: true },
  { type: 'sight-declared', from: DRUID, to: BYSTANDER, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: DRUID, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
      { id: BYSTANDER, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const conjured = () => {
  const out = must(
    resolveSpell(
      fold('seed', MOOR),
      DRUID,
      { spellId: 'conjure-animals', targets: [], slotLevel: 3, at: PACK },
      supply('pack'),
    ),
    'Conjure Animals',
  );
  const log = [...MOOR, ...out.events];
  return { out, log, state: fold('seed', log) as GameState, castingId: out.castingId! };
};

/** The druid's own move, carrying the pack with it. */
const walked = (to: { x: number; y: number; z: number }, seed = 'walk') => {
  const { log, castingId } = conjured();
  const state = fold('seed', log) as GameState;
  return {
    castingId,
    log,
    state,
    out: resolveMove(
      state,
      DRUID,
      {
        placement: { from: { point: { x: 105, y: 100, z: 0 } }, feet: 0 },
        alsoMoves: { castingId, to },
      },
      supply(seed),
    ),
  };
};

describe('Conjure Animals', () => {
  it('leaves a pack standing at the point the druid chose', () => {
    const { state, castingId } = conjured();
    const record = state.ongoing[castingId]!;
    expect(record.origin).toEqual(PACK);
    expect(record.areaTrigger?.within).toBe(10);
    // Nothing is caught at the casting: the pack simply appears.
    expect(state.owedAreaEffects).toEqual([]);
  });

  it('gives the druid Advantage on a Strength save within five feet of it', () => {
    const { state } = conjured();
    const beside = fold('seed', [
      ...conjured().log,
      {
        type: 'creature-moved',
        id: DRUID,
        placement: { from: { point: { x: 115, y: 100, z: 0 } }, feet: 0 },
        forced: true,
      } satisfies GameEvent,
    ]) as GameState;

    const near = savingSupport(beside, DRUID, beside.creatures[DRUID]!, 'str', {});
    expect(
      near.modes.some((mode) => typeof mode !== 'string' && mode.mode === 'advantage'),
    ).toBe(true);

    // Twenty feet off, which is where the druid started: nothing.
    const far = savingSupport(state, DRUID, state.creatures[DRUID]!, 'str', {});
    expect(far.modes.filter((mode) => typeof mode !== 'string')).toEqual([]);
    // And not on a Dexterity save even beside it: the sentence names Strength.
    const dex = savingSupport(beside, DRUID, beside.creatures[DRUID]!, 'dex', {});
    expect(dex.modes.filter((mode) => typeof mode !== 'string')).toEqual([]);
    // And not for the goblin, however close it stands: "**you** have Advantage".
    const theirs = savingSupport(beside, GOBLIN, beside.creatures[GOBLIN]!, 'str', {});
    expect(theirs.modes.filter((mode) => typeof mode !== 'string')).toEqual([]);
  });

  it('walks the pack with the druid’s own move and catches whoever it reaches', () => {
    const { out, log, castingId } = walked(ONWARD);
    const moved = must(out, 'the move');
    const after = [...log, ...moved.events];
    const state = fold('seed', after) as GameState;

    // The pack is where the druid put it, and the goblin five feet on is owed a
    // saving throw it did nothing to earn.
    expect(state.ongoing[castingId]!.origin).toEqual(ONWARD);
    expect(state.owedAreaEffects.map((owed) => owed.target)).toEqual([GOBLIN]);

    const settled = must(settleAreaEffects(state, supply('bite')), 'the pack');
    expect(settled.outcomes.map((one) => one.target)).toEqual([GOBLIN]);
    expect(settled.outcomes[0]!.save).toBeDefined();

    // And the pack does not walk twice on one turn, however many commands the
    // druid's thirty feet is broken into: "when you move on your turn" is one
    // sentence about one turn's walking, and the record remembers the turn its
    // point last moved on.
    const owed = [...after, ...settled.events];
    const again = resolveMove(
      fold('seed', owed) as GameState,
      DRUID,
      {
        placement: { from: { point: { x: 110, y: 100, z: 0 } }, feet: 0 },
        alsoMoves: { castingId, to: { x: 165, y: 100, z: 0 } },
      },
      supply('again'),
    );
    expect(isErr(again) && again.code).toBe('pack_already_carried');
  });

  it('walks the pack again on the druid’s next turn', () => {
    const { out, log, castingId } = walked(ONWARD);
    const moved = must(out, 'the move');
    let current: readonly GameEvent[] = [...log, ...moved.events];
    // Round the table back to the druid, settling what the carry owed on the way.
    for (let i = 0; i < 3; i += 1) {
      const settled = must(
        settleAreaEffects(fold('seed', current) as GameState, supply('bite')),
        'the settlement',
      );
      current = [...current, ...settled.events];
      const turn = must(resolveTurn(fold('seed', current) as GameState, supply('turn')), 'the turn');
      current = [...current, ...turn.events];
    }
    const next = resolveMove(
      fold('seed', current) as GameState,
      DRUID,
      {
        placement: { from: { point: { x: 110, y: 100, z: 0 } }, feet: 0 },
        alsoMoves: { castingId, to: { x: 165, y: 100, z: 0 } },
      },
      supply('walk'),
    );
    expect(isErr(next)).toBe(false);
  });

  it('refuses a pack walked further than thirty feet', () => {
    const { out } = walked({ x: 200, y: 100, z: 0 });
    expect(isErr(out) && out.code).toBe('pack_too_far');
  });

  it('refuses a pack walked into an occupied space', () => {
    // Twenty-five feet on and then five more would be the bystander's square,
    // which is inside the allowance and not empty.
    const { log, castingId } = conjured();
    const out = resolveMove(
      fold('seed', log) as GameState,
      DRUID,
      {
        placement: { from: { point: { x: 105, y: 100, z: 0 } }, feet: 0 },
        alsoMoves: { castingId, to: { x: 145, y: 100, z: 0 } },
      },
      supply('walk'),
    );
    // Nobody is standing there, so this one is legal; the refusal is asserted
    // against the square the bystander holds.
    expect(isErr(out)).toBe(false);
    const blocked = resolveMove(
      fold('seed', [
        ...log,
        {
          type: 'creature-moved',
          id: BYSTANDER,
          placement: { from: { point: { x: 145, y: 100, z: 0 } }, feet: 0 },
          forced: true,
        } satisfies GameEvent,
      ]) as GameState,
      DRUID,
      {
        placement: { from: { point: { x: 105, y: 100, z: 0 } }, feet: 0 },
        alsoMoves: { castingId, to: { x: 145, y: 100, z: 0 } },
      },
      supply('walk'),
    );
    expect(isErr(blocked) && blocked.code).toBe('pack_space_occupied');
  });

  it('refuses a pack walked to a space its blinded druid cannot see', () => {
    const { log, castingId } = conjured();
    const blind: readonly GameEvent[] = [
      ...log,
      {
        type: 'condition-applied',
        id: DRUID,
        condition: 'blinded',
        source: 'the fog took their eyes',
      } satisfies GameEvent,
    ];
    const out = resolveMove(
      fold('seed', blind) as GameState,
      DRUID,
      {
        placement: { from: { point: { x: 105, y: 100, z: 0 } }, feet: 0 },
        alsoMoves: { castingId, to: ONWARD },
      },
      supply('walk'),
    );
    expect(isErr(out) && out.code).toBe('pack_unseen');
  });

  it('refuses a move that carries a casting holding no pack', () => {
    const { log } = conjured();
    const out = resolveMove(
      fold('seed', log) as GameState,
      DRUID,
      {
        placement: { from: { point: { x: 105, y: 100, z: 0 } }, feet: 0 },
        alsoMoves: { castingId: 'cast:99', to: ONWARD },
      },
      supply('walk'),
    );
    expect(isErr(out) && out.code).toBe('not_ongoing');
  });
});
