import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { movementLeftFor } from './standing.js';
import { pendingMoveOf, resolveAttack, resolveMove, takeDash, takeDisengage } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * The Attack action, and the three actions that change what a turn can do.
 *
 * The economy counted *actions*, which is right for one attack and wrong for
 * every Fighter past level 5: SRD Extra Attack is "You can attack twice
 * instead of once whenever you take the Attack action", so the action is taken
 * once and holds two attacks. `resolveAttack` spent an action per swing, so a
 * level 5 Fighter got one attack a turn.
 *
 * The other three are each one sentence, and each is a sentence the engine had
 * nowhere to put:
 *
 * | Action | SRD |
 * |---|---|
 * | Dash | "you gain extra movement for the current turn. The increase equals your Speed **after applying any modifiers**" |
 * | Disengage | "your movement doesn't provoke Opportunity Attacks for the rest of the current turn" |
 * | Attack | "you can make one attack roll with a weapon or an Unarmed Strike" |
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');

const plain = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

/** A Fighter at the level Extra Attack arrives, and one a level below it. */
const fighter = (level: number): CharacterChoices => ({
  name: 'Bren',
  classId: 'fighter',
  level,
  speciesId: 'human',
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
    'fighter:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const table = (level: number, gap = 5): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT,fighter(level), FIGHTER), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: FIGHTER, side: 'party' },
  {
    type: 'creature-added',
    id: GOBLIN,
    name: 'goblin',
    sheet: plain(),
    maxHp: 200,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'goblins',
  },
  { type: 'items-gained', id: FIGHTER, items: [{ id: 'longsword', quantity: 1 }], source: 'loot' },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: FIGHTER }, feet: gap, bearing: 0 } },
  { type: 'sight-declared', from: GOBLIN, to: FIGHTER, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: FIGHTER, initiative: 20, speed: 30 },
      { id: GOBLIN, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed = 'swing') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng, content: SRD_CONTENT });

/** Swing, and hand back the longer log. */
const swing = (log: readonly GameEvent[], seed = 'swing') => {
  const out = unwrap(
    resolveAttack(fold('seed', log), FIGHTER, { target: GOBLIN, weapon: 'longsword' }, supply(seed)),
    'attack',
  );
  return { ...out, log: [...log, ...out.events] };
};

const budget = (state: GameState) => state.combat?.budgets.fighter;

describe('the Attack action holds the attacks a feature puts in it', () => {
  /** SRD Fighter 5: "You can attack twice instead of once." */
  it('gives a level 5 Fighter two attacks for one action', () => {
    expect(fold('seed', table(5)).creatures.fighter!.sheet.attacksPerAction).toBe(2);
  });

  it('gives a level 4 Fighter one, because the feature arrives at 5', () => {
    expect(fold('seed', table(4)).creatures.fighter!.sheet.attacksPerAction ?? 1).toBe(1);
  });

  it('lets the second swing happen without a second action', () => {
    const first = swing(table(5));
    expect(budget(fold('seed', first.log))?.action).toBe(false);

    const second = swing(first.log, 'again');
    expect(second.attack).not.toBeNull();
    // Still inside the same Attack action: the budget's action was already
    // gone before this swing, and the second swing did not need another.
    expect(budget(fold('seed', second.log))?.attacksRemaining).toBe(0);
  });

  it('refuses the third', () => {
    const second = swing(swing(table(5)).log, 'again');
    const third = resolveAttack(
      fold('seed', second.log),
      FIGHTER,
      { target: GOBLIN, weapon: 'longsword' },
      supply('third'),
    );
    expect(isErr(third)).toBe(true);
    if (isErr(third)) expect(third.code).toBe('no_attacks_left');
  });

  it('refuses the second for a Fighter who has not got the feature', () => {
    const again = resolveAttack(
      fold('seed', swing(table(4)).log),
      FIGHTER,
      { target: GOBLIN, weapon: 'longsword' },
      supply('again'),
    );
    expect(isErr(again)).toBe(true);
  });

  /** An Opportunity Attack is a Reaction, so it spends none of this. */
  it('is untouched by an attack that costs no action', () => {
    const free = unwrap(
      resolveAttack(
        fold('seed', table(5)),
        FIGHTER,
        { target: GOBLIN, weapon: 'longsword', free: true },
        supply(),
      ),
      'free',
    );
    const after = fold('seed', [...table(5), ...free.events]);
    expect(budget(after)?.action).toBe(true);
    expect(budget(after)?.attacksRemaining).toBeNull();
  });

  /**
   * SRD: "If you move on your turn and have a feature, such as Extra Attack,
   * that gives you more than one attack as part of the Attack action, you can
   * use some or all of that movement to move between those attacks."
   */
  it('lets the Fighter move between the two attacks', () => {
    const first = swing(table(5));
    const walked = unwrap(
      resolveMove(
        fold('seed', first.log),
        FIGHTER,
        { placement: { from: { creature: GOBLIN }, feet: 5, bearing: 90 } },
        supply(),
      ),
      'move',
    );
    const second = swing([...first.log, ...walked.events], 'again');
    expect(second.attack).not.toBeNull();
  });

  it('starts fresh on the next turn', () => {
    const spent = swing(swing(table(5)).log, 'again');
    const nextRound: readonly GameEvent[] = [
      ...spent.log,
      { type: 'turn-advanced' },
      { type: 'turn-advanced' },
    ];
    const out = swing(nextRound, 'fresh');
    expect(out.attack).not.toBeNull();
    // A fresh Attack action, with the second swing back in it.
    expect(budget(fold('seed', out.log))?.attacksRemaining).toBe(1);
  });
});

describe('Dash buys another Speed’s worth of movement', () => {
  /** SRD: "The increase equals your Speed after applying any modifiers." */
  it('adds the creature’s Speed to what is left', () => {
    const dashed = unwrap(takeDash(fold('seed', table(5)), FIGHTER, {}), 'dash');
    const after = fold('seed', [...table(5), ...dashed]);
    expect(movementLeftFor(after, FIGHTER)).toBe(60);
    expect(budget(after)?.action).toBe(false);
  });

  /**
   * "If your Speed of 30 feet is reduced to 15 feet, you can move up to 30
   * feet this turn if you Dash" — the SRD's own worked example, and the reason
   * the increase is read after modifiers rather than off the sheet.
   *
   * **This asserted 45 and its own comment said 30**, and the comment was
   * right. A remainder seeded at the *pinned* 30 and then raised by the
   * *reduced* 15 gives 45, which is neither number the book prints: the seed
   * was the un-reduced Speed, so Exhaustion reached the increase and not the
   * allowance. Storing the spend and deriving the allowance — 15 + 15 — is
   * what makes the two halves read the same Speed, and the SRD's example is
   * the thing that says so.
   */
  it('adds the reduced Speed when Exhaustion has taken its share', () => {
    const tired: readonly GameEvent[] = [...table(5), { type: 'exhaustion-set', id: FIGHTER, level: 3 }];
    const dashed = unwrap(takeDash(fold('seed', tired), FIGHTER, {}), 'dash');
    // A Speed of 30 less 15 is 15, so the turn holds 30 in total.
    expect(movementLeftFor(fold('seed', [...tired, ...dashed]), FIGHTER)).toBe(30);
  });

  it('refuses when the action is already gone', () => {
    const swung = swing(table(5));
    expect(isErr(takeDash(fold('seed', swung.log), FIGHTER, {}))).toBe(true);
  });
});

describe('Disengage takes the teeth out of walking away', () => {
  /** SRD: "your movement doesn't provoke Opportunity Attacks for the rest of the current turn." */
  it('stops the move provoking anybody', () => {
    const provoking = unwrap(
      resolveMove(
        fold('seed', table(5)),
        FIGHTER,
        { placement: { from: { landmark: 'the yard' }, feet: 20, bearing: 90 } },
        supply(),
      ),
      'move',
    );
    expect(pendingMoveOf(fold('seed', [...table(5), ...provoking.events]))).not.toBeNull();

    const disengaged = unwrap(takeDisengage(fold('seed', table(5)), FIGHTER, {}), 'disengage');
    const log = [...table(5), ...disengaged];
    const away = unwrap(
      resolveMove(
        fold('seed', log),
        FIGHTER,
        { placement: { from: { landmark: 'the yard' }, feet: 20, bearing: 90 } },
        supply(),
      ),
      'move',
    );
    expect(pendingMoveOf(fold('seed', [...log, ...away.events]))).toBeNull();
  });

  it('costs the action', () => {
    const disengaged = unwrap(takeDisengage(fold('seed', table(5)), FIGHTER, {}), 'disengage');
    expect(budget(fold('seed', [...table(5), ...disengaged]))?.action).toBe(false);
  });

  /** "for the rest of the current turn" — and not a moment longer. */
  it('lapses when the turn does', () => {
    const disengaged = unwrap(takeDisengage(fold('seed', table(5)), FIGHTER, {}), 'disengage');
    const nextRound: readonly GameEvent[] = [
      ...table(5),
      ...disengaged,
      { type: 'turn-advanced' },
      { type: 'turn-advanced' },
    ];
    const away = unwrap(
      resolveMove(
        fold('seed', nextRound),
        FIGHTER,
        { placement: { from: { landmark: 'the yard' }, feet: 20, bearing: 90 } },
        supply(),
      ),
      'move',
    );
    expect(pendingMoveOf(fold('seed', [...nextRound, ...away.events]))).not.toBeNull();
  });
});

describe('it all replays', () => {
  it('replays prefix by prefix', () => {
    const dashed = unwrap(takeDash(fold('seed', table(5)), FIGHTER, {}), 'dash');
    const log = [...table(5), ...dashed];
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('survives JSON', () => {
    const state = fold('seed', swing(table(5)).log);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
