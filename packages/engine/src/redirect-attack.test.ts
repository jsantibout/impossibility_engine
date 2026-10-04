/**
 * **An attack declared and turned on somebody else** — M-REFLEX.
 *
 * SRD Goblin Boss, Redirect Attack: "_Trigger:_ A creature the goblin can see
 * makes an attack roll against it. _Response:_ The goblin chooses a Small or
 * Medium ally within 5 feet of itself. The goblin and that ally swap places,
 * and the ally becomes the target of the attack instead."
 *
 * The window is the instant before the d20 is thrown — an attack roll's
 * Advantage, cover and Armour Class are its target's, so a roll thrown at the
 * goblin cannot become one at the ally. So a swing at a creature that holds
 * such a Reaction, with an ally to give it to, is **declared and held**; the
 * goblin redirects or declines; and the attacker makes the swing, which is
 * thrown at whoever is then its target.
 */

import { SRD_CONTENT } from '@ie/content';
import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId, isErr, isNeedsContext, type Result } from '@ie/shared';
import {
  addCreature,
  addSceneLandmark,
  beginCombat,
  declareCreatureSide,
  declineDeclaredAttack,
  placeCreatureInScene,
  reactionOpportunities,
  redirectDeclaredAttack,
  resolveAttack,
  resolveTurn,
  setScene,
} from './commands.js';
import { createRng, type Rng } from './dice.js';
import { applyEvent, fold, type GameEvent, type GameState } from './events.js';
import { printedTraitKey } from './monster.js';
import { positionOf } from './positioning.js';
import { createRollIssuer } from './rolls.js';

const id = (s: string): CharacterId => asCharacterId(s);
const BOSS = id('boss');
const GOBLIN = id('goblin');
const BANDIT = id('bandit');
const REDIRECT = printedTraitKey('goblin-boss', 'Redirect Attack');

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('redirect') as Rng,
  content: SRD_CONTENT,
});

const unwrap = <T>(result: Result<T>, label = 'ok'): T => {
  if (!result.ok) throw new Error(`${label}: ${result.code} — ${result.reason}`);
  return result.value;
};

const after = (state: GameState, events: readonly GameEvent[]): GameState =>
  events.reduce((s, e) => applyEvent(s, e), state);

/**
 * A goblin boss at (100, 100), a bandit five feet west of it on the bandit's
 * turn, and a second creature of the stated block on the boss's side the
 * stated feet east of it.
 */
function camp(allyFeet = 5, allyBlock = 'goblin-warrior', allySide: string | null = 'goblins'): GameState {
  let state = fold('redirect', []);
  const step = (result: Result<readonly GameEvent[]>, label: string): void => {
    state = after(state, unwrap(result, label));
  };
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, BOSS, 'goblin-boss'), 'boss').events);
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, GOBLIN, allyBlock), 'ally').events);
  state = after(state, unwrap(addCreature(state, SRD_CONTENT, BANDIT, 'bandit'), 'bandit').events);
  step(setScene(state, { width: 200, depth: 200, height: 40 }), 'scene');
  step(addSceneLandmark(state, 'the fire', { x: 100, y: 100, z: 0 }), 'landmark');
  step(placeCreatureInScene(state, BOSS, { from: { landmark: 'the fire' }, feet: 0 }), 'boss');
  step(placeCreatureInScene(state, BANDIT, { from: { creature: BOSS }, feet: 5, bearing: 270 }), 'bandit');
  step(placeCreatureInScene(state, GOBLIN, { from: { creature: BOSS }, feet: allyFeet, bearing: 90 }), 'ally');
  step(declareCreatureSide(state, BOSS, 'goblins'), 'side');
  if (allySide !== null) step(declareCreatureSide(state, GOBLIN, allySide), 'side');
  step(declareCreatureSide(state, BANDIT, 'bandits'), 'side');
  step(
    beginCombat(state, [
      { id: BANDIT, initiative: 20, speed: 30 },
      { id: BOSS, initiative: 10, speed: 30 },
      { id: GOBLIN, initiative: 5, speed: 30 },
    ]),
    'combat',
  );
  return state;
}

const swing = (state: GameState, commandId = 'swing') =>
  resolveAttack(state, BANDIT, { target: BOSS, weapon: null, action: 'Scimitar', commandId }, supply());

/** The Armour Class the swing was measured against — the goblin boss's 17, or the ally's 15. */
const BOSS_AC = SRD_CONTENT.monsterById('goblin-boss')!.ac;
const ALLY_AC = SRD_CONTENT.monsterById('goblin-warrior')!.ac;

describe('a swing at the goblin boss, with an ally beside it', () => {
  it('is declared and held: no die is thrown and the boss is offered its Reaction', () => {
    const declared = unwrap(swing(camp()), 'declare');
    expect(declared.attack).toBeNull();
    expect(declared.events.some((event) => event.type === 'roll-recorded')).toBe(false);
    expect(declared.events.some((event) => event.type === 'attack-declared')).toBe(true);

    const state = after(camp(), declared.events);
    expect(state.pendingSwing).toMatchObject({ attacker: BANDIT, target: BOSS, answered: false });
    expect(
      reactionOpportunities(state, SRD_CONTENT).filter((o) => o.reactor === BOSS),
    ).toMatchObject([{ window: 'attack-declared', id: REDIRECT, kind: 'feature', against: BANDIT }]);
  });

  it('turns on the ally when the boss redirects it, and the two swap places', () => {
    let state = after(camp(), unwrap(swing(camp()), 'declare').events);
    const bossWas = positionOf(state.scene!, BOSS);
    const goblinWas = positionOf(state.scene!, GOBLIN);

    state = after(
      state,
      unwrap(
        redirectDeclaredAttack(state, BOSS, { feature: REDIRECT, ally: GOBLIN, commandId: 'redirect' }),
        'redirect',
      ),
    );
    expect(positionOf(state.scene!, BOSS)).toEqual(goblinWas);
    expect(positionOf(state.scene!, GOBLIN)).toEqual(bossWas);
    expect(state.combat!.budgets[BOSS]!.reaction).toBe(false);
    expect(state.pendingSwing).toMatchObject({ target: GOBLIN, answered: true });

    // The bandit makes the swing it declared, and it is thrown at the ally.
    const made = unwrap(swing(state, 'swing-again'), 'swing');
    expect(BOSS_AC).not.toBe(ALLY_AC);
    expect(made.attack?.targetAc).toBe(ALLY_AC);
    const done = after(state, made.events);
    expect(done.pendingSwing).toBeUndefined();
  });

  it('is thrown at the boss when it declines', () => {
    let state = after(camp(), unwrap(swing(camp()), 'declare').events);
    state = after(state, unwrap(declineDeclaredAttack(state, BOSS, { commandId: 'decline' }), 'decline'));
    expect(state.combat!.budgets[BOSS]!.reaction).toBe(true);
    const made = unwrap(swing(state, 'swing-again'), 'swing');
    expect(made.attack?.targetAc).toBe(BOSS_AC);
  });

  it('holds the fight until it is thrown', () => {
    const state = after(camp(), unwrap(swing(camp()), 'declare').events);
    const advanced = resolveTurn(state, supply(), { commandId: 'end' });
    expect(isErr(advanced) && advanced.code).toBe('attack_declared');
    const other = resolveAttack(state, GOBLIN, { target: BANDIT, weapon: null, action: 'Scimitar', commandId: 'other' }, supply());
    expect(isErr(other) && other.code).toBe('attack_declared');
  });
});

describe('what the boss may redirect it to', () => {
  const declared = (allyFeet = 5, allyBlock = 'goblin-warrior'): GameState =>
    after(camp(allyFeet, allyBlock), unwrap(swing(camp(allyFeet, allyBlock)), 'declare').events);

  it('asks whose side a creature is on before calling it an ally', () => {
    // The goblin beside the boss with no side declared: offered, because the
    // engine withholds nothing on a fact nobody has stated, and asked about at
    // the answer, because it invents no ally either.
    const sideless = camp(5, 'goblin-warrior', null);
    const state = after(sideless, unwrap(swing(sideless), 'declare').events);
    const asked = redirectDeclaredAttack(state, BOSS, { feature: REDIRECT, ally: GOBLIN, commandId: 'r' });
    expect(isNeedsContext(asked) && !asked.ok && asked.code).toBe('allegiance_undeclared');
  });

  it('is answered only where an attack waits', () => {
    const refused = declineDeclaredAttack(camp(), BOSS, { commandId: 'd' });
    expect(isErr(refused) && refused.code).toBe('no_declared_attack');
  });

  it('refuses a creature that is not its ally', () => {
    const refused = redirectDeclaredAttack(declared(), BOSS, { feature: REDIRECT, ally: BANDIT, commandId: 'r' });
    expect(isErr(refused) && refused.code).toBe('not_an_ally');
  });

  it('is not opened where no ally stands within five feet', () => {
    const made = unwrap(swing(camp(10)), 'swing');
    expect(made.events.some((event) => event.type === 'attack-declared')).toBe(false);
    expect(made.attack?.targetAc).toBe(BOSS_AC);
  });

  it('is not opened for an ally larger than Medium', () => {
    const made = unwrap(swing(camp(5, 'ogre')), 'swing');
    expect(made.events.some((event) => event.type === 'attack-declared')).toBe(false);
  });

  it('is not opened against an attacker the boss cannot see', () => {
    const unseen = after(camp(), [{ type: 'sight-declared', from: BOSS, to: BANDIT, seen: false }]);
    const made = unwrap(swing(unseen), 'swing');
    expect(made.events.some((event) => event.type === 'attack-declared')).toBe(false);
  });
});
