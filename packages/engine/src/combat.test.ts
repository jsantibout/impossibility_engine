import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import type { Rng, RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { conditionState } from './conditions.js';
import { halfProficiencyBonus, proficiencyBonus } from './character.js';
import { rollAbilityCheck } from './checks.js';
import type { AbilityScores, CharacterSheet } from './character.js';
import {
  advanceTurn,
  budgetFor,
  currentCombatant,
  passiveInitiative,
  removeCombatant,
  rollInitiative,
  spendAction,
  spendBonusAction,
  spendMovement,
  spendReaction,
  startCombat,
  swapInitiative,
  useFreeInteraction,
} from './combat.js';

const scriptedRng = (values: readonly number[]): Rng => {
  let i = 0;
  return {
    int: () => values[i++ % values.length]!,
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const scores = (over: Partial<AbilityScores> = {}): AbilityScores => ({
  str: 10,
  dex: 10,
  con: 10,
  int: 10,
  wis: 10,
  cha: 10,
  ...over,
});

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 1,
  abilities: scores(),
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const id = (s: string) => asCharacterId(s);
const issuer = () => createRollIssuer('t');

const combatant = (name: string, initiative: number, speed = 30, tiebreak = 0) => ({
  id: id(name),
  initiative,
  speed,
  tiebreak,
});

const threeWay = () =>
  unwrap(
    startCombat([
      combatant('rogue', 20),
      combatant('orc', 12),
      combatant('cleric', 8),
    ]),
    'combat',
  );

describe('rollInitiative', () => {
  // SRD: "they make a Dexterity check that determines their place in the
  // Initiative order."
  it('is a Dexterity check', () => {
    const s = sheet({ abilities: scores({ dex: 16 }) });
    const result = unwrap(rollInitiative(issuer(), scriptedRng([10]), id('a'), s, {}), 'init');
    expect(result.total).toBe(13);
  });

  it('does not add proficiency by default', () => {
    const s = sheet({ level: 9, abilities: scores({ dex: 14 }) });
    expect(unwrap(rollInitiative(issuer(), scriptedRng([10]), id('a'), s, {}), 'x').total).toBe(12);
  });

  // SRD Alert: "When you roll Initiative, you can add your Proficiency Bonus to
  // the roll." Expressed as an ordinary named bonus.
  it('accepts the Alert feat as a bonus', () => {
    const s = sheet({ level: 9, abilities: scores({ dex: 14 }) });
    const result = unwrap(
      rollInitiative(issuer(), scriptedRng([10]), id('a'), s, {
        bonuses: [{ source: 'Alert', flat: proficiencyBonus(s) }],
      }),
      'alert',
    );
    expect(result.total).toBe(10 + 2 + 4);
  });

  /**
   * SRD Jack of All Trades: "add half your Proficiency Bonus (round down) to
   * any ability check you make that **uses a skill proficiency you lack** and
   * that doesn't otherwise use your Proficiency Bonus."
   *
   * Initiative is a *bare* Dexterity check — it uses no skill — so the feature
   * does not apply. Earlier guidance here claimed it did, and this test
   * asserted the claim; both were wrong, and the 2014 version is where the
   * confusion comes from.
   */
  it('does not receive Jack of All Trades, which needs a skill', () => {
    const s = sheet({ level: 5, abilities: scores({ dex: 12 }) });
    const plain = unwrap(rollInitiative(issuer(), scriptedRng([10]), id('a'), s, {}), 'plain');
    expect(plain.total).toBe(11);
    // The primitive still exists for the checks the feature does cover.
    expect(halfProficiencyBonus(s)).toBe(1);
  });

  it('does receive Jack of All Trades on a skill check the character lacks', () => {
    const s = sheet({ level: 5, abilities: scores({ str: 10 }) });
    const result = unwrap(
      rollAbilityCheck(issuer(), scriptedRng([10]), s, 'str', {
        dc: 10,
        skill: 'athletics',
        bonuses: [{ source: 'Jack of All Trades', flat: halfProficiencyBonus(s) }],
      }),
      'joat',
    );
    expect(result.total).toBe(11);
  });

  it('accepts a dice bonus, such as Bless', () => {
    const result = unwrap(
      rollInitiative(issuer(), scriptedRng([10, 3]), id('a'), sheet(), {
        bonuses: [{ source: 'Bless', dice: '1d4' }],
      }),
      'bless',
    );
    expect(result.total).toBe(13);
  });

  // SRD: "If a combatant is surprised by combat starting, that combatant has
  // Disadvantage on their Initiative roll." Not a condition, in 2024.
  it('gives a surprised combatant disadvantage', () => {
    const result = unwrap(
      rollInitiative(issuer(), scriptedRng([18, 4]), id('a'), sheet(), { surprised: true }),
      'surprised',
    );
    expect(result.mode).toBe('disadvantage');
    expect(result.roll.natural).toBe(4);
  });

  it('gives an Invisible combatant advantage and an Incapacitated one disadvantage', () => {
    const invisible = unwrap(
      rollInitiative(issuer(), scriptedRng([4, 18]), id('a'), sheet(), {
        conditions: conditionState(['invisible']),
      }),
      'invisible',
    );
    expect(invisible.mode).toBe('advantage');

    const stunned = unwrap(
      rollInitiative(issuer(), scriptedRng([18, 4]), id('a'), sheet(), {
        conditions: conditionState(['stunned']),
      }),
      'stunned',
    );
    expect(stunned.mode).toBe('disadvantage');
  });

  it('cancels invisibility against being surprised', () => {
    const result = unwrap(
      rollInitiative(issuer(), scriptedRng([18, 4]), id('a'), sheet(), {
        conditions: conditionState(['invisible']),
        surprised: true,
      }),
      'both',
    );
    expect(result.mode).toBe('normal');
  });

  it('applies the exhaustion penalty', () => {
    const result = unwrap(
      rollInitiative(issuer(), scriptedRng([15]), id('a'), sheet(), {
        conditions: conditionState([], 2),
      }),
      'exhausted',
    );
    expect(result.total).toBe(11);
  });

  it('records the roll with engine provenance', () => {
    const result = unwrap(rollInitiative(issuer(), scriptedRng([10]), id('a'), sheet(), {}), 'prov');
    expect(result.roll.provenance.source).toBe('engine');
  });
});

describe('passiveInitiative', () => {
  // SRD: "Your Initiative score equals 10 plus your Dexterity modifier. If you
  // have Advantage on Initiative rolls, increase your Initiative score by 5."
  it('is 10 plus the Dexterity modifier', () => {
    expect(passiveInitiative(sheet({ abilities: scores({ dex: 16 }) }), 'normal')).toBe(13);
  });

  it('shifts by 5 for advantage and disadvantage', () => {
    const s = sheet({ abilities: scores({ dex: 16 }) });
    expect(passiveInitiative(s, 'advantage')).toBe(18);
    expect(passiveInitiative(s, 'disadvantage')).toBe(8);
  });
});

describe('startCombat', () => {
  it('orders combatants from highest initiative to lowest', () => {
    expect(threeWay().order.map((c) => c.id)).toEqual([id('rogue'), id('orc'), id('cleric')]);
  });

  it('starts on round 1 with the first combatant', () => {
    const state = threeWay();
    expect(state.round).toBe(1);
    expect(currentCombatant(state).id).toBe(id('rogue'));
  });

  // SRD: "If a tie occurs, the GM decides the order." The engine stays
  // deterministic and takes that decision as an input rather than inventing one.
  it('breaks ties by the caller-supplied tiebreak, highest first', () => {
    const state = unwrap(
      startCombat([combatant('a', 15, 30, 1), combatant('b', 15, 30, 9)]),
      'tie',
    );
    expect(state.order.map((c) => c.id)).toEqual([id('b'), id('a')]);
  });

  it('falls back to a stable insertion order when tiebreaks match', () => {
    const state = unwrap(startCombat([combatant('a', 15), combatant('b', 15)]), 'stable');
    expect(state.order.map((c) => c.id)).toEqual([id('a'), id('b')]);
  });

  it('refuses an empty combat', () => {
    expect(isErr(startCombat([]))).toBe(true);
  });

  it('refuses duplicate combatants', () => {
    expect(isErr(startCombat([combatant('a', 10), combatant('a', 12)]))).toBe(true);
  });

  it('gives the first combatant a full budget', () => {
    const state = threeWay();
    expect(budgetFor(state, id('rogue'))).toEqual({
      action: true,
      bonusAction: true,
      reaction: true,
      movementRemaining: 30,
      freeInteraction: true,
      spellSlotSpentOnTurn: null,
    });
  });
});

describe('advanceTurn', () => {
  it('moves to the next combatant in order', () => {
    const state = advanceTurn(threeWay());
    expect(currentCombatant(state).id).toBe(id('orc'));
    expect(state.round).toBe(1);
  });

  // SRD: "When everyone involved in the combat has had a turn, the round ends."
  it('starts a new round after the last combatant', () => {
    let state = threeWay();
    state = advanceTurn(advanceTurn(advanceTurn(state)));
    expect(currentCombatant(state).id).toBe(id('rogue'));
    expect(state.round).toBe(2);
  });

  // SRD: "The Initiative order remains the same from round to round."
  it('keeps the order across rounds', () => {
    let state = threeWay();
    const order = state.order.map((c) => c.id);
    for (let i = 0; i < 7; i++) state = advanceTurn(state);
    expect(state.order.map((c) => c.id)).toEqual(order);
  });

  it('refreshes the incoming combatant’s budget', () => {
    let state = threeWay();
    state = unwrap(spendAction(state, id('rogue')), 'spend');
    state = unwrap(spendMovement(state, id('rogue'), 20), 'move');
    expect(budgetFor(state, id('rogue'))?.action).toBe(false);

    // Round the table back to the rogue.
    for (let i = 0; i < 3; i++) state = advanceTurn(state);
    expect(budgetFor(state, id('rogue'))).toMatchObject({ action: true, movementRemaining: 30 });
  });
});

describe('the action economy', () => {
  it('allows one action per turn', () => {
    const state = unwrap(spendAction(threeWay(), id('rogue')), 'first');
    expect(isErr(spendAction(state, id('rogue')))).toBe(true);
  });

  // SRD: "A Bonus Action is a special action that you can take on the same turn
  // that you take an action."
  it('allows a bonus action alongside the action', () => {
    let state = unwrap(spendAction(threeWay(), id('rogue')), 'action');
    state = unwrap(spendBonusAction(state, id('rogue')), 'bonus');
    expect(budgetFor(state, id('rogue'))).toMatchObject({ action: false, bonusAction: false });
  });

  it('allows only one bonus action', () => {
    const state = unwrap(spendBonusAction(threeWay(), id('rogue')), 'first');
    expect(isErr(spendBonusAction(state, id('rogue')))).toBe(true);
  });

  it('refuses an action from a combatant whose turn it is not', () => {
    expect(isErr(spendAction(threeWay(), id('orc')))).toBe(true);
  });

  it('refuses an action from someone not in the combat', () => {
    expect(isErr(spendAction(threeWay(), id('ghost')))).toBe(true);
  });

  // SRD Incapacitated: "You can't take any action, Bonus Action, or Reaction."
  it('refuses every action from an Incapacitated combatant', () => {
    const state = threeWay();
    const stunned = conditionState(['stunned']);
    expect(isErr(spendAction(state, id('rogue'), stunned))).toBe(true);
    expect(isErr(spendBonusAction(state, id('rogue'), stunned))).toBe(true);
    expect(isErr(spendReaction(state, id('rogue'), stunned))).toBe(true);
  });
});

describe('reactions', () => {
  // SRD: "You can take a Reaction on another creature's turn."
  it('can be taken on someone else’s turn', () => {
    const state = unwrap(spendReaction(threeWay(), id('cleric')), 'opportunity');
    expect(budgetFor(state, id('cleric'))?.reaction).toBe(false);
  });

  it('allows only one at a time', () => {
    const state = unwrap(spendReaction(threeWay(), id('cleric')), 'first');
    expect(isErr(spendReaction(state, id('cleric')))).toBe(true);
  });

  /**
   * SRD: "Once you take a Reaction, you can't take another one until the start
   * of your next turn." Not the end of the round — a creature that spent its
   * Reaction on an Opportunity Attack has none until its own turn comes round.
   */
  it('does not refresh until the start of that combatant’s own turn', () => {
    let state = unwrap(spendReaction(threeWay(), id('cleric')), 'spent');

    state = advanceTurn(state);
    expect(budgetFor(state, id('cleric'))?.reaction).toBe(false);

    state = advanceTurn(state);
    expect(currentCombatant(state).id).toBe(id('cleric'));
    expect(budgetFor(state, id('cleric'))?.reaction).toBe(true);
  });
});

describe('movement', () => {
  it('spends from the turn’s allowance', () => {
    const state = unwrap(spendMovement(threeWay(), id('rogue'), 10), 'move');
    expect(budgetFor(state, id('rogue'))?.movementRemaining).toBe(20);
  });

  it('allows spending the whole speed across several moves', () => {
    let state = unwrap(spendMovement(threeWay(), id('rogue'), 15), 'a');
    state = unwrap(spendMovement(state, id('rogue'), 15), 'b');
    expect(budgetFor(state, id('rogue'))?.movementRemaining).toBe(0);
  });

  it('refuses to move further than the remaining allowance', () => {
    const state = unwrap(spendMovement(threeWay(), id('rogue'), 25), 'a');
    expect(isErr(spendMovement(state, id('rogue'), 10))).toBe(true);
  });

  it('refuses a negative distance', () => {
    expect(isErr(spendMovement(threeWay(), id('rogue'), -5))).toBe(true);
  });

  // Conditions that set Speed to 0 leave nothing to spend.
  it('refuses movement while Grappled', () => {
    expect(isErr(spendMovement(threeWay(), id('rogue'), 5, conditionState(['grappled'])))).toBe(
      true,
    );
  });

  it('limits movement to the exhausted speed', () => {
    // Exhaustion 2 reduces a 30-foot Speed to 20.
    const exhausted = conditionState([], 2);
    const state = unwrap(spendMovement(threeWay(), id('rogue'), 20, exhausted), 'ok');
    expect(isErr(spendMovement(state, id('rogue'), 5, exhausted))).toBe(true);
  });
});

describe('free object interaction', () => {
  // SRD: "You can interact with one object or feature of the environment for
  // free... If you want to interact with a second object, you need to take the
  // Utilize action."
  it('allows one per turn', () => {
    const state = unwrap(useFreeInteraction(threeWay(), id('rogue')), 'first');
    expect(isErr(useFreeInteraction(state, id('rogue')))).toBe(true);
  });

  it('refreshes on the combatant’s next turn', () => {
    let state = unwrap(useFreeInteraction(threeWay(), id('rogue')), 'first');
    for (let i = 0; i < 3; i++) state = advanceTurn(state);
    expect(budgetFor(state, id('rogue'))?.freeInteraction).toBe(true);
  });
});

describe('removeCombatant', () => {
  it('takes a combatant out of the order', () => {
    const state = unwrap(removeCombatant(threeWay(), id('orc')), 'removed');
    expect(state.order.map((c) => c.id)).toEqual([id('rogue'), id('cleric')]);
  });

  it('keeps the current combatant current when a later one is removed', () => {
    const state = unwrap(removeCombatant(threeWay(), id('cleric')), 'removed');
    expect(currentCombatant(state).id).toBe(id('rogue'));
  });

  // The index has to shift, or removing someone earlier in the order silently
  // skips whoever's turn it actually is.
  it('keeps the current combatant current when an earlier one is removed', () => {
    let state = advanceTurn(advanceTurn(threeWay()));
    expect(currentCombatant(state).id).toBe(id('cleric'));

    state = unwrap(removeCombatant(state, id('rogue')), 'removed');
    expect(currentCombatant(state).id).toBe(id('cleric'));
  });

  it('advances to the next combatant when the current one is removed', () => {
    const state = unwrap(removeCombatant(advanceTurn(threeWay()), id('orc')), 'removed');
    expect(currentCombatant(state).id).toBe(id('cleric'));
  });

  it('wraps to a new round when the last combatant is removed on their turn', () => {
    let state = advanceTurn(advanceTurn(threeWay()));
    state = unwrap(removeCombatant(state, id('cleric')), 'removed');
    expect(currentCombatant(state).id).toBe(id('rogue'));
    expect(state.round).toBe(2);
  });

  it('refuses to remove the last combatant standing', () => {
    let state = unwrap(removeCombatant(threeWay(), id('orc')), 'a');
    state = unwrap(removeCombatant(state, id('cleric')), 'b');
    expect(isErr(removeCombatant(state, id('rogue')))).toBe(true);
  });

  it('refuses to remove someone not in the combat', () => {
    expect(isErr(removeCombatant(threeWay(), id('ghost')))).toBe(true);
  });
});

describe('swapInitiative', () => {
  /**
   * SRD Alert: "Immediately after you roll Initiative, you can swap your
   * Initiative with the Initiative of one willing ally in the same combat. You
   * can't make this swap if you or the ally has the Incapacitated condition."
   */
  it('exchanges two combatants’ initiative and reorders', () => {
    const state = unwrap(swapInitiative(threeWay(), id('rogue'), id('cleric')), 'swap');
    expect(state.order.map((c) => c.id)).toEqual([id('cleric'), id('orc'), id('rogue')]);
  });

  it('refuses when either party is Incapacitated', () => {
    const state = threeWay();
    const stunned = conditionState(['stunned']);
    expect(isErr(swapInitiative(state, id('rogue'), id('cleric'), stunned))).toBe(true);
    expect(isErr(swapInitiative(state, id('rogue'), id('cleric'), undefined, stunned))).toBe(true);
  });

  it('refuses to swap a combatant with themselves', () => {
    expect(isErr(swapInitiative(threeWay(), id('rogue'), id('rogue')))).toBe(true);
  });

  it('refuses an unknown combatant', () => {
    expect(isErr(swapInitiative(threeWay(), id('rogue'), id('ghost')))).toBe(true);
  });
});
