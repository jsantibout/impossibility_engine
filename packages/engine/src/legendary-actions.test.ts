/**
 * The legendary economy, and the two lines it spends at CR 5.
 *
 * SRD Unicorn: "_Legendary Action Uses: 3. Immediately after another
 * creature's turn, the unicorn can expend a use to take one of the following
 * actions. The unicorn regains all expended uses at the start of each of its
 * turns._" — then Charging Horn ("moves up to half its Speed without provoking
 * Opportunity Attacks, and it makes one Radiant Horn attack") and Shimmering
 * Shield ("The unicorn targets itself or one creature it can see within 60
 * feet of itself. The target gains 10 (3d6) Temporary Hit Points, and its AC
 * increases by 2 until the end of the unicorn's next turn. The unicorn can't
 * take this action again until the start of its next turn.").
 *
 * The economy is a **pool** the block declares, regained whole at the start of
 * the holder's turn, and a **moment**: the boundary just after another
 * creature's turn ended, which the engine reads as a turn that has begun and
 * on which nothing has yet been spent. The Horn's attack is the swing the
 * block prints, free of the Attack action as an Opportunity Attack is; the
 * Shield's Temporary Hit Points carry the owner's default lifetime, its +2 is
 * a bonus on a `grants` timer, and "can't take this action again until the
 * start of its next turn" is a recharge of a third kind — one that comes back
 * at the turn's start with no die.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  placeCreatureInScene,
  resolveTurn,
  setScene,
  takeDodge,
  takeLegendaryAction,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { LEGENDARY_POOL } from './monster.js';
import { remaining } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { armorClassOf } from './standing.js';
import { createCharacter, type CharacterChoices } from './creation.js';

const id = (s: string) => asCharacterId(s);
const UNICORN = id('unicorn');
const BREN = id('bren');
const BANDIT = id('bandit');

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const bren = (): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level: 1,
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A',
  classEquipment: 'A',
  hitPoints: { method: 'fixed' },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  cantrips: [],
  preparedSpells: [],
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  equipped: ['chain-mail'],
  featureChoices: { 'human:skillful': ['perception'], 'fighter:weapon-mastery': [] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'fighter:fighting-style': { featId: 'archery' },
  },
});

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/** The unicorn first, Bren second and a bandit third, all within reach. */
function inTheGrove(): GameState {
  let state = fold('grove', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  const arrive = (who: CharacterId, block: string): void => {
    state = after(state, unwrap(addCreature(state, SRD_CONTENT, who, block), block).events);
  };
  arrive(UNICORN, 'unicorn');
  step(createCharacter(SRD_CONTENT, bren(), BREN), 'Bren');
  arrive(BANDIT, 'bandit');
  step(setScene(state, { width: 200, depth: 120, height: 20 }), 'scene');
  step(addSceneLandmark(state, 'the pool', { x: 60, y: 60, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, UNICORN, { from: { landmark: 'the pool' }, feet: 0 }), 'unicorn');
  step(placeCreatureInScene(state, BREN, { from: { creature: UNICORN }, feet: 30, bearing: 0 }), 'Bren');
  step(placeCreatureInScene(state, BANDIT, { from: { creature: UNICORN }, feet: 5, bearing: 180 }), 'bandit');
  step(declareCreatureSide(state, UNICORN, 'fey'), 'side');
  step(declareCreatureSide(state, BREN, 'party'), 'side');
  step(declareCreatureSide(state, BANDIT, 'bandits'), 'side');
  step(
    beginCombat(state, [
      { id: UNICORN, initiative: 20, speed: 50 },
      { id: BREN, initiative: 10, speed: 30 },
      { id: BANDIT, initiative: 5, speed: 30 },
    ]),
    'combat',
  );
  return state;
}

/** The world just after Bren's turn ended: the bandit's has begun and holds everything. */
function afterBrensTurn(): GameState {
  let state = inTheGrove();
  state = after(state, unwrap(resolveTurn(state, supply('to-bren')), 'to Bren').events);
  state = after(state, unwrap(resolveTurn(state, supply('to-bandit')), 'to bandit').events);
  return state;
}

const uses = (state: GameState): number =>
  remaining(state.creatures[UNICORN]!.resources, LEGENDARY_POOL);

const shield = (state: GameState, target: CharacterId, tag: string) =>
  takeLegendaryAction(
    state,
    UNICORN,
    { line: 'Shimmering Shield', target, commandId: `shield-${tag}` },
    supply(`shield-${tag}`),
  );

const horn = (state: GameState, target: CharacterId, tag: string) =>
  takeLegendaryAction(
    state,
    UNICORN,
    { line: 'Charging Horn', target, commandId: `horn-${tag}` },
    supply(`horn-${tag}`),
  );

describe('the block as the parser reads it', () => {
  it('reads the uses, the Horn as an attack line and the Shield as a shield', () => {
    const block = SRD_CONTENT.monsters.find((m) => m.id === 'unicorn')!;
    expect(block.legendaryActionUses).toBe(3);
    const [charging, shimmering] = block.legendaryActions;
    expect(charging!.legendary).toEqual({ kind: 'attack', attack: 'Radiant Horn', movesHalfSpeed: true });
    expect(shimmering!.legendary).toEqual({
      kind: 'shield',
      rangeFeet: 60,
      temporaryHitPoints: { dice: '3d6', flat: 0, average: 10 },
      armorClass: 2,
      oncePerRound: true,
    });
  });

  it('arrives with a pool of three uses', () => {
    expect(uses(inTheGrove())).toBe(3);
  });
});

describe('a unicorn spending a use after the fighter’s turn', () => {
  it('shields Bren for 3d6 Temporary Hit Points and +2 AC until the end of its next turn', () => {
    const state = afterBrensTurn();
    const wasAc = armorClassOf(state, BREN);
    const out = unwrap(shield(state, BREN, 'a'), 'the shield');
    const next = after(state, out.events);

    expect(out.usesLeft).toBe(2);
    expect(uses(next)).toBe(2);
    const temp = next.creatures[BREN]!.vitals.temporaryHp;
    expect(temp).toBeGreaterThanOrEqual(3);
    expect(temp).toBeLessThanOrEqual(18);
    expect(out.events.some((e) => e.type === 'temporary-hp-granted')).toBe(true);
    expect(out.events.some((e) => e.type === 'roll-recorded' && e.label.includes('Shimmering Shield'))).toBe(true);
    expect(armorClassOf(next, BREN)).toBe(wasAc + 2);
    const timer = Object.values(next.timers).find((t) => t.target.kind === 'grants' && t.target.on === BREN);
    expect(timer?.deadline).toMatchObject({ kind: 'turn-end', of: UNICORN });
    // The owner's lifetime ruling: no stated span, so no deadline on the points.
    expect(Object.values(next.timers).some((t) => t.target.kind === 'temporary-hit-points')).toBe(false);
    // The Shield is spent until the start of the unicorn's next turn.
    expect(next.creatures[UNICORN]!.expendedLines).toContain('Shimmering Shield');
    expect(shield(next, BREN, 'b')).toMatchObject({ ok: false, code: 'line_expended' });
  });

  it('charges the bandit: a Radiant Horn attack free of the Attack action, the move the table’s', () => {
    const state = afterBrensTurn();
    const out = unwrap(horn(state, BANDIT, 'a'), 'the horn');
    expect(out.usesLeft).toBe(2);
    expect(out.attack).not.toBeNull();
    const roll = out.events.find((e) => e.type === 'roll-recorded');
    if (roll?.type !== 'roll-recorded') throw new Error('no attack roll');
    expect(roll.label).toBe('Radiant Horn attack');
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(false);
    expect(out.unverified.some((line) => line.includes('half its Speed'))).toBe(true);
  });

  it('is refused a fourth use in the round, and has three again at the top of its turn', () => {
    let state = afterBrensTurn();
    state = after(state, unwrap(horn(state, BANDIT, 'one'), 'one').events);
    state = after(state, unwrap(horn(state, BANDIT, 'two'), 'two').events);
    state = after(state, unwrap(shield(state, UNICORN, 'three'), 'three').events);
    expect(uses(state)).toBe(0);
    expect(horn(state, BANDIT, 'four')).toMatchObject({ ok: false, code: 'no_legendary_uses' });

    // The bandit's turn ends and the unicorn's begins: every use is back and
    // the Shield is off the spent list.
    const top = after(state, unwrap(resolveTurn(state, supply('round-two')), 'round two').events);
    expect(uses(top)).toBe(3);
    expect(top.creatures[UNICORN]!.expendedLines).not.toContain('Shimmering Shield');
  });
});

describe('the moment', () => {
  it('is closed on the unicorn’s own turn, and once the beginning creature has acted', () => {
    const own = inTheGrove();
    expect(horn(own, BANDIT, 'own')).toMatchObject({ ok: false, code: 'legendary_moment_closed' });

    const state = afterBrensTurn();
    const acted = after(state, unwrap(takeDodge(state, BANDIT, { commandId: 'dodge' }), 'dodge'));
    expect(horn(acted, BANDIT, 'late')).toMatchObject({ ok: false, code: 'legendary_moment_closed' });
    // Nothing was spent by a refusal.
    expect(uses(acted)).toBe(3);
  });

  it('asks who the Horn is aimed at, and refuses a line the block does not print as legendary', () => {
    const state = afterBrensTurn();
    const unaimed = takeLegendaryAction(state, UNICORN, { line: 'Charging Horn', commandId: 'x' }, supply('x'));
    expect(unaimed).toMatchObject({ ok: false, kind: 'needs-context', code: 'undeclared_targets' });
    expect(takeLegendaryAction(state, UNICORN, { line: 'Hooves', commandId: 'y' }, supply('y'))).toMatchObject({
      ok: false,
      code: 'no_such_line',
    });
    expect(takeLegendaryAction(state, BANDIT, { line: 'Charging Horn', commandId: 'z' }, supply('z'))).toMatchObject({
      ok: false,
      code: 'no_such_line',
    });
  });
});
