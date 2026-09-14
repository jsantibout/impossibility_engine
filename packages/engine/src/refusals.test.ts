import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  contextRequestsOf,
  isErr,
  expect as unwrap,
  type Result,
} from '@ie/shared';
import { WEAPONS, type Weapon } from '@ie/srd';
import type { CharacterSheet } from './character.js';
import { itemFor } from './catalogue.js';
import { createRng, parseNotation, rerollDice, roll, type Rng } from './dice.js';
import { createRollIssuer, recordExternalD20, recordExternalDamage } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { declarePool, resourceState, spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { rollAttackDamage } from './attack.js';
import { dash, removeCombatant, spendMovement } from './combat.js';
import { rollDeathSave } from './vitals.js';
import {
  activateSpell,
  castSpell,
  damageCreature,
  declareCreatureDead,
  declareResourcePool,
  dismountRider,
  equipItem,
  grantTemporaryHpTo,
  healCreature,
  joinCombat,
  mountCreature,
  placeCreatureInScene,
  releaseReady,
  removeCreatureEverywhere,
  resolveAttack,
  resolveAttackDamage,
  resolveDeclaredCast,
  resolveMove,
  resolveSpell,
  resolveTurn,
  settleTest,
  takeDash,
  takeReady,
  takeTestReaction,
  declineTestReaction,
  pendingCastingsOf,
} from './commands.js';
import { beginRest, endRest } from './rest.js';

/**
 * The refusals nothing had ever read.
 *
 * A rules-legal refusal is a value rather than an exception so that the layer
 * above can act on it, and every code below is one the engine could return and
 * no test had ever seen. That is not a cosmetic gap: a code nobody asserts is
 * a code whose branch may not be reachable, whose spelling nothing pins, and
 * whose rule — "a cantrip is cast without a spell slot", "only the engine may
 * record a roll as engine-generated" — is recorded in a string and nowhere
 * else. `refusal-sweep.test.ts` is what keeps the list honest; this is the
 * list.
 *
 * **Every case here goes through the public API** — a command off
 * `commands.ts`'s barrel, or a function `index.ts` re-exports — never through
 * the helper that happens to contain the `err`. Calling the function that
 * returns a code proves the string exists; it does not prove the rule holds,
 * and the rule is the point. Where a code's own site is a private helper the
 * test names the outermost entry point that reaches it.
 *
 * Each case names the rule it pins, because a refusal without its rule is a
 * string with a test around it.
 */

const id = (s: string) => asCharacterId(s);
const A = id('a');
const B = id('b');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (who: string, side: string): GameEvent => ({
  type: 'creature-added',
  id: id(who),
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const SETUP: readonly GameEvent[] = [
  added('a', 'party'),
  added('b', 'foes'),
  { type: 'items-gained', id: A, items: [{ id: 'chain-shirt', quantity: 2 }], source: 'kit' },
  {
    type: 'resource-pool-declared',
    id: A,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: A,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'resource-pool-declared',
    id: A,
    pool: { key: spellSlotKey(3), label: 'level 3 spell slot', max: 3, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: A,
    spellcasting: declaredCasting({
      ability: 'int',
      prepared: [
        'inflict-wounds',
        'fire-bolt',
        'hold-person',
        'disguise-self',
        'spirit-guardians',
        'vampiric-touch',
        'counterspell',
        'charm-person',
        'comprehend-languages',
      ],
    }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: A, placement: { from: { landmark: 'here' }, feet: 0 } },
  { type: 'creature-placed', id: B, placement: { from: { creature: A }, feet: 5, bearing: 0 } },
  { type: 'sight-declared', from: A, to: B, seen: true },
  { type: 'sight-declared', from: B, to: A, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: A, initiative: 20, speed: 30 },
      { id: B, initiative: 10, speed: 30 },
    ],
  },
];

const world = (extra: readonly GameEvent[] = []): GameState => fold('seed', [...SETUP, ...extra]);

const supply = (seed = 'seed') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

/** The code a refusal carried, or what it did instead. */
const refusal = (out: Result<unknown>): string =>
  isErr(out) ? out.code : 'not refused';

describe('casting refuses a slot that contradicts itself', () => {
  /**
   * SRD: "A cantrip is cast without a spell slot." So naming one is not a
   * generous caller being tidy; it is a casting the rules do not describe.
   *
   * `resolveSpell` cannot reach this and is right not to: it derives the
   * payment from the definition, so a cantrip is never given a slot level to
   * contradict. `castSpell` is the documented low-level half a caller
   * reconstructing a log or scripting a fixture uses, and it takes the caller's
   * word for the level — which is exactly why it has to check.
   */
  it('refuses a cantrip that names a spell slot', () => {
    const out = castSpell(world(), A, { spell: 'Fire Bolt', level: 0, slotLevel: 1 });
    expect(refusal(out)).toBe('cantrip_takes_no_slot');
  });

  /** And nothing is spent by the refusal — the slot is still there. */
  it('spends nothing refusing it', () => {
    const before = world();
    expect(isErr(castSpell(before, A, { spell: 'Fire Bolt', level: 0, slotLevel: 1 }))).toBe(true);
    expect(before.creatures[A]?.resources.pools[spellSlotKey(1)]?.spent).toBe(0);
  });

  /**
   * A casting either expends a slot or explains why it does not. Saying both
   * is not over-specification: the two answers disagree about whether the
   * one-slot-per-turn rule has fired, and the engine will not pick one.
   */
  it('refuses a casting that both expends a slot and explains why it does not', () => {
    const out = castSpell(world(), A, {
      spell: 'Inflict Wounds',
      level: 1,
      slotLevel: 1,
      slotless: 'special-ability',
    });
    expect(refusal(out)).toBe('conflicting_slot');
  });

  /**
   * Through the whole spell surface as well, which is the half a tool surface
   * will actually reach: a levelled spell paid for with a slot, handed a
   * `slotless` reason on top of it.
   */
  it('refuses the same contradiction through the whole spell resolution', () => {
    const out = resolveSpell(
      world(),
      A,
      { spellId: 'inflict-wounds', targets: [B], slotLevel: 1, slotless: 'special-ability' },
      supply(),
    );
    expect(refusal(out)).toBe('conflicting_slot');
  });

  /** SRD prints nine slot levels. A tenth is not a big spell; it is not a slot. */
  it('refuses a slot level the game does not have', () => {
    expect(refusal(castSpell(world(), A, { spell: 'Inflict Wounds', level: 1, slotLevel: 10 }))).toBe(
      'bad_slot_level',
    );
    expect(refusal(castSpell(world(), A, { spell: 'Inflict Wounds', level: 1, slotLevel: 0 }))).toBe(
      'bad_slot_level',
    );
  });

  /**
   * A spell name may not carry the mark that forges a casting link.
   *
   * `castingSource` writes `Hold Person#cast:3` and `castingIdOf` reads it
   * back, so a name carrying a `#` could attach its effects to somebody else's
   * casting — or detach its own from the cleanup that ends it.
   */
  it('refuses a spell name that would forge a casting link', () => {
    const out = castSpell(world(), A, { spell: 'Hold Person#cast:1', level: 2, slotLevel: 2 });
    expect(refusal(out)).toBe('bad_spell');
  });

  it('refuses a spell with no name at all', () => {
    expect(refusal(castSpell(world(), A, { spell: '   ', level: 1, slotLevel: 1 }))).toBe('bad_spell');
  });

  /**
   * A duration runs forwards in whole seconds. Half a second is not a short
   * effect and a negative one is not an expired effect — both are a deadline
   * the clock could never reach, which is the one thing a timer must not be.
   */
  it('refuses a duration that does not run forwards in whole seconds', () => {
    const out = castSpell(world(), A, {
      spell: 'Inflict Wounds',
      level: 1,
      slotLevel: 1,
      duration: { kind: 'seconds', seconds: -60 },
    });
    expect(refusal(out)).toBe('bad_duration');
  });
});

describe('a D20 Test Reaction needs a D20 Test to answer', () => {
  /**
   * The window is the whole mechanism: `pendingTest` holds a roll whose total
   * is known and whose consequences have not happened. With no window open
   * there is nothing to push on, and all three commands that speak to one say
   * so rather than inventing a roll to modify.
   */
  it('refuses a Reaction when no test is waiting', () => {
    const out = takeTestReaction(world(), A, { feature: 'fighter:indomitable' }, supply());
    expect(refusal(out)).toBe('no_pending_test');
  });

  it('refuses a decline when no test is waiting', () => {
    expect(refusal(declineTestReaction(world(), A, {}))).toBe('no_pending_test');
  });

  it('refuses a settlement when no test is waiting', () => {
    expect(refusal(settleTest(world(), {}))).toBe('no_pending_test');
  });
});

describe('the turn refuses to advance outside a fight', () => {
  /**
   * Out of combat there is no Initiative order to wrap and no six seconds to
   * pass — the clock moves by narration instead. Advancing a turn that does
   * not exist would move the clock on a rule that is not running.
   */
  it('refuses to advance a turn when no combat is running', () => {
    const outside = fold('seed', [added('a', 'party')]);
    expect(refusal(resolveTurn(outside, supply()))).toBe('no_combat');
  });
});

describe('a pool is declared once, and with a maximum it could have', () => {
  /** Pools are declared, never derived — and declaring one twice is two answers to one question. */
  it('refuses a second pool with a key the creature already has', () => {
    const out = declareResourcePool(world(), A, {
      key: spellSlotKey(1),
      label: 'level 1 spell slot',
      max: 4,
      recovers: 'long-rest',
    });
    expect(refusal(out)).toBe('duplicate_pool');
  });

  /**
   * A maximum is a count of uses. A fraction is not a number of uses and a
   * negative one is a pool that owes the creature something.
   */
  it('refuses a maximum that is not a whole number of uses', () => {
    const out = declareResourcePool(world(), A, {
      key: 'test:rage',
      label: 'Rage',
      max: -1,
      recovers: 'long-rest',
    });
    expect(refusal(out)).toBe('bad_max');
  });
});

describe('what is worn is worn once', () => {
  /**
   * One suit of body armour. Equipping the same item twice is not two suits —
   * `equipped` is a set of what is actually on the creature, and Armour Class
   * reads it.
   */
  it('refuses to equip what is already equipped', () => {
    const on = unwrap(equipItem(world(), A, 'chain-shirt', 'first'), 'equip');
    const out = equipItem(world(on), A, 'chain-shirt', 'second');
    expect(refusal(out)).toBe('already_equipped');
  });
});

describe('a rest is a span, and only one at a time', () => {
  /** A rest begins, time passes, it ends. A second beginning contradicts the first. */
  it('refuses to begin a rest while one is already running', () => {
    const resting = unwrap(beginRest(world(), A, 'short', 'first'), 'begin');
    const out = beginRest(world(resting), A, 'long', 'second');
    expect(refusal(out)).toBe('already_resting');
  });

  /**
   * SRD: spending Hit Point Dice is a benefit of a Short Rest. A completed
   * Long Rest "restores all lost Hit Points and all spent Hit Point Dice", so
   * spending one there is burning a resource the rest is about to hand back.
   */
  it('refuses Hit Dice on a rest that does not offer them', () => {
    const resting = unwrap(beginRest(world(), A, 'long', 'begin'), 'begin');
    const rested = fold('seed', [
      ...SETUP,
      ...resting,
      { type: 'time-advanced', seconds: 8 * 60 * 60, reason: 'a long night' },
    ]);
    const out = endRest(rested, A, { hitDice: ['hit-die:d8'] }, supply());
    expect(refusal(out)).toBe('no_hit_dice_here');
  });

  /**
   * The die size lives in the pool key because nothing else knows it — a sheet
   * has a level but no class. A key that names no die is a request the engine
   * cannot price, and it is refused before any die is rolled.
   */
  it('refuses a Hit Die pool key that names no die', () => {
    const resting = unwrap(beginRest(world(), A, 'short', 'begin'), 'begin');
    const rested = fold('seed', [
      ...SETUP,
      ...resting,
      { type: 'time-advanced', seconds: 60 * 60, reason: 'a breather' },
    ]);
    const out = endRest(rested, A, { hitDice: ['test:vigour'] }, supply());
    expect(refusal(out)).toBe('bad_hit_die');
  });
});

describe('an amount is a number of hit points', () => {
  /**
   * A non-finite or negative amount is the bug that turned hit points into
   * `NaN` — a creature that compares false against every threshold and is
   * therefore neither alive nor dead. Each of the three numeric entry points
   * has its own sentence about what a number means there.
   */
  it('refuses damage that is not a non-negative number', () => {
    expect(refusal(damageCreature(world(), A, { amount: -5, source: 'a trap' }))).toBe('bad_amount');
    expect(refusal(damageCreature(world(), A, { amount: Number.NaN, source: 'a trap' }))).toBe(
      'bad_amount',
    );
  });

  /** Healing of nothing is not healing; SRD gives no spell that restores zero. */
  it('refuses healing that is not a positive number', () => {
    expect(refusal(healCreature(world(), A, 0))).toBe('bad_amount');
  });

  it('refuses Temporary Hit Points that are not a non-negative number', () => {
    expect(refusal(grantTemporaryHpTo(world(), A, -1, {}))).toBe('bad_amount');
  });
});

describe('a roll recorded from outside the engine is still a roll the die could have made', () => {
  /**
   * The provenance guard, and the one place the Inviolable Rule is actually
   * enforced. Only `rolls.ts`'s own functions may stamp `engine`, so the layer
   * above cannot forge the audit trail by claiming a number it decided was one
   * the engine rolled. A human DM legitimately fudges; a model doing the same
   * is a bug, and the difference is visible only because this refusal exists.
   */
  it('refuses an external roll that claims the engine generated it', () => {
    const out = recordExternalD20(createRollIssuer('r'), {
      natural: 20,
      modifier: 0,
      source: 'engine',
    });
    expect(refusal(out)).toBe('forged_provenance');
  });

  it('refuses external damage that claims the engine generated it', () => {
    const out = recordExternalDamage(createRollIssuer('r'), {
      notation: '2d6',
      total: 7,
      source: 'engine',
    });
    expect(refusal(out)).toBe('forged_provenance');
  });

  /** A d20 has twenty faces regardless of who is holding it — an override included. */
  it('refuses a face a d20 cannot show', () => {
    const issuer = createRollIssuer('r');
    expect(refusal(recordExternalD20(issuer, { natural: 21, modifier: 0, source: 'dm-override' }))).toBe(
      'impossible_die',
    );
    expect(refusal(recordExternalD20(issuer, { natural: 0, modifier: 0, source: 'physical-dice' }))).toBe(
      'impossible_die',
    );
  });

  /** Damage is never negative, whoever is reporting it. */
  it('refuses a damage total that is not a damage total', () => {
    const out = recordExternalDamage(createRollIssuer('r'), {
      notation: '2d6',
      total: -1,
      source: 'dm-override',
    });
    expect(refusal(out)).toBe('impossible_damage');
  });

  /**
   * And physical dice are held to what the notation can produce, where a DM's
   * override is not: the difference between reporting a roll and deciding one.
   * 2d6 cannot come to 13, so a table claiming it misread the dice.
   */
  it('refuses physical dice reporting a total the notation cannot reach', () => {
    const issuer = createRollIssuer('r');
    expect(
      refusal(recordExternalDamage(issuer, { notation: '2d6', total: 13, source: 'physical-dice' })),
    ).toBe('impossible_damage');
    // The same total from a DM stating the result they want is allowed, which
    // is what makes the check about provenance rather than about arithmetic.
    expect(
      unwrap(
        recordExternalDamage(issuer, { notation: '2d6', total: 13, source: 'dm-override' }),
        'override',
      ).total,
    ).toBe(13);
  });
});

describe('dice notation says what it says', () => {
  /** Nothing parses into a roll, and a roll of no dice is not a roll. */
  it('refuses notation that is not notation', () => {
    expect(refusal(parseNotation('a handful'))).toBe('bad_notation');
    expect(refusal(parseNotation('0d6'))).toBe('bad_notation');
    expect(refusal(parseNotation('2d6kh0'))).toBe('bad_notation');
    expect(refusal(parseNotation('2d6kh3'))).toBe('bad_notation');
  });

  /**
   * The die limit is a guard on the generator rather than a rule of the game:
   * a caller asking for a million dice would advance the sequence a million
   * times, and a replay would have to do it again.
   */
  it('refuses more dice than the engine will roll', () => {
    expect(refusal(parseNotation('1001d6'))).toBe('too_many_dice');
    // And the limit itself is not over it — a guard that refused the boundary
    // would be a different guard from the one written down.
    expect(unwrap(parseNotation('1000d6'), 'at the limit').count).toBe(1000);
    // A die with too many sides is the other half of the same sentence, and is
    // `bad_notation` rather than a limit of its own.
    expect(refusal(parseNotation('1d1001'))).toBe('bad_notation');
  });

  /**
   * A reroll takes explicit indices, because the rules that use one let the
   * *player* choose which dice. An index that names no die is a choice about
   * nothing, and a die already given up cannot be given up twice — the record
   * keeps it marked `rerolled` so the log shows what was surrendered.
   */
  it('refuses a reroll of a die that is not there, and of one already rerolled', () => {
    const rng = createRng('reroll') as Rng;
    const outcome = unwrap(roll(rng, '2d6'), 'roll');
    expect(refusal(rerollDice(rng, outcome, [7], 'Empowered Spell'))).toBe('unknown_die');
    const once = unwrap(rerollDice(rng, outcome, [0], 'Empowered Spell'), 'reroll');
    expect(refusal(rerollDice(rng, once, [0], 'Empowered Spell'))).toBe('already_rerolled');
  });
});

describe('a pool needs a key to be found by', () => {
  /**
   * A pool is looked up by its key — `spell-slot:3`, `hit-die:d8` — so a blank
   * one is a pool nothing can ever spend from or refill. "Declared, never
   * derived" means the declaration has to say which pool it is declaring.
   *
   * The command above it does not reach this: `declareResourcePool` asks
   * whether the creature already *has* the key, which an empty string never
   * is, and emits the event — so an empty key arrives at the reducer, where
   * `declarePool` refuses and the fold throws a corrupt log rather than
   * returning a value. That is the reducer's contract working as designed and
   * it is why this is asserted at the pure declaration, which is the public
   * function a caller building a pool actually holds.
   */
  it('refuses a pool with no key', () => {
    const out = declarePool(resourceState(), {
      key: '   ',
      label: 'a nameless reserve',
      max: 3,
      recovers: 'long-rest',
    });
    expect(refusal(out)).toBe('bad_key');
  });
});

describe('a distance is a distance', () => {
  /**
   * Movement and placement share the rule and refuse it separately, because
   * different callers reach them. A negative or non-finite distance does not
   * move a creature backwards; it puts a `NaN` into the budget or the
   * coordinates, and everything downstream compares false against it for ever
   * — the same failure that made a creature neither alive nor dead.
   */
  it('refuses a movement spend that is not a distance', () => {
    const combat = world().combat!;
    expect(refusal(spendMovement(combat, A, -5, 30))).toBe('bad_distance');
    expect(refusal(spendMovement(combat, A, Number.POSITIVE_INFINITY, 30))).toBe('bad_distance');
  });

  it('refuses a placement measured by a distance that is not one', () => {
    const out = placeCreatureInScene(world(), id('c'), {
      from: { landmark: 'here' },
      feet: Number.NaN,
    });
    expect(refusal(out)).toBe('bad_distance');
  });
});

describe('a fight keeps at least one combatant', () => {
  /**
   * An Initiative order of nobody is not a fight that has ended; it is a fight
   * whose "whose turn is it" has no answer, and `currentCombatant` would have
   * to invent one.
   *
   * `removeCreatureEverywhere` is why this is rarely met — it ends the combat
   * outright rather than removing the last combatant — and the second case is
   * what makes that a choice rather than an accident.
   */
  it('refuses to remove the only combatant left', () => {
    const alone = fold('seed', [
      added('a', 'party'),
      { type: 'combat-started', combatants: [{ id: A, initiative: 20, speed: 30 }] },
    ]).combat!;
    expect(refusal(removeCombatant(alone, A))).toBe('last_combatant');
  });

  it('and the command that removes a creature ends the fight instead', () => {
    const alone = fold('seed', [
      added('a', 'party'),
      { type: 'combat-started', combatants: [{ id: A, initiative: 20, speed: 30 }] },
    ]);
    const out = unwrap(removeCreatureEverywhere(alone, A, {}), 'remove');
    expect(out.map((e) => e.type)).toContain('combat-ended');
    expect(out.map((e) => e.type)).not.toContain('combatant-removed');
  });
});

/**
 * `not_a_combatant` is reachable only at `dash` itself, and that is exempted.
 *
 * Dash doubles the Speed the Initiative order is holding, so a creature who is
 * not in it has no Speed for the rule to act on — and `dash` is a public
 * function `index.ts` re-exports, so a caller holding a `CombatState` really
 * can be told this. What no caller can reach is the code **through
 * `takeDash`**, and the exemption names the two facts that make that so, each
 * asserted below rather than asserted about:
 *
 * 1. `spendAction` runs first and answers `unknown_combatant` — a **stricter**
 *    rule, and a better one, because it is a `needs-context` naming a fact to
 *    go and get rather than a verdict. Reordering to reach the narrower code
 *    would be a worse answer, not a fix.
 * 2. `order` and `budgets` are kept in exact step by every operation that
 *    changes either, so a creature that gets past `spendAction` is always in
 *    the order. The guard below it is the type system's, not a rule's:
 *    `.find()` returns `T | undefined` and the printed Speed lives on the
 *    order rather than on the budget.
 *
 * The honest answer here is therefore the exemption rather than a reachability
 * fix — "if a site is unreachable because the rule above it is stricter, the
 * exemption must name the stricter rule."
 */
describe('an action is taken by somebody in the fight', () => {
  it('refuses a Dash by a creature who is not in this fight', () => {
    const combat = world().combat!;
    expect(refusal(dash(combat, id('c'), 30))).toBe('not_a_combatant');
  });

  /**
   * Fact 1: the command above it asks for the fact instead, twice over — a
   * creature nobody has mentioned is `unknown_creature`, and one in the game
   * but out of the fight is `unknown_combatant`, which is `spendAction`'s own
   * answer and the one that stands in front of `dash`'s guard.
   */
  it('and the command above it asks who that creature is, rather than refusing', () => {
    expect(refusal(takeDash(world(), id('nobody'), {}))).toBe('unknown_creature');
    expect(refusal(takeDash(world([added('c', 'party')]), id('c'), {}))).toBe('unknown_combatant');
  });

  /**
   * Fact 2: nothing puts a budget on a creature the order does not hold, and
   * nothing leaves one holding a creature with no budget.
   *
   * The order used to only ever *shrink* — it was set by `combat-started` and
   * thinned by removals, and this comment said as much. `joinCombat` grows it,
   * so the claim is no longer true by construction and the insertion is driven
   * here on both sides of the creature currently acting. The turn counts are
   * swept beside the budgets for the same reason: `duration.ts` answers "the
   * start of your next turn" out of `turnCounts` and refuses `not_in_combat`
   * where it finds none, so a combatant the order holds and the counts do not
   * would strand every turn-anchored effect anchored on them.
   */
  it('and no operation leaves a budget for somebody the order does not hold', () => {
    const agree = (state: GameState): void => {
      const combat = state.combat;
      if (combat === null) return;
      const held = combat.order.map((c) => c.id as string).sort();
      expect(Object.keys(combat.budgets).sort()).toEqual(held);
      expect(Object.keys(combat.turnCounts).sort()).toEqual(held);
    };

    const start = world();
    agree(start);
    agree(fold('seed', [...SETUP, ...unwrap(resolveTurn(start, supply()), 'turn').events]));
    agree(fold('seed', [...SETUP, ...unwrap(removeCreatureEverywhere(start, B, {}), 'remove')]));

    // And the operation that grows it, on both sides of the turn in progress:
    // A is acting at 20, so 25 lands ahead of the creature mid-turn and 5
    // lands behind everybody.
    const walked = [...SETUP, added('c', 'party')];
    for (const initiative of [25, 5]) {
      const joining = { id: id('c'), initiative, speed: 30 };
      const joined = [
        ...walked,
        ...unwrap(joinCombat(fold('seed', walked), joining), 'join'),
      ];
      agree(fold('seed', joined));
    }
  });
});

/**
 * `no_damage` is reachable at `rollAttackDamage` and nowhere above it, and
 * that is exempted rather than fixed.
 *
 * Every weapon the SRD prints has damage dice or a flat amount — the Blowgun
 * is the one with only the second — and a weapon with neither is a homebrew
 * row the public damage function will be handed sooner or later. Dealing 0
 * would be the engine inventing a number for a weapon whose damage nobody
 * stated, so the refusal has to stay; and it cannot be made reachable through
 * `resolveAttack` without giving the engine a way to be handed a weapon that
 * is not in the book, which is a mechanism rather than a hygiene fix.
 *
 * Two facts make it unreachable from a command, and both are asserted below
 * rather than asserted about, so the exemption falls the day either stops
 * being true.
 */
describe('a weapon that deals no damage is refused rather than dealing none', () => {
  /** Fact 1: no weapon the catalogue lists is missing its damage. */
  it('finds no SRD weapon with neither dice nor a flat amount', () => {
    const silent = WEAPONS.filter((w) => w.damage.dice === null && w.damage.fixed === null);
    expect(silent.map((w) => w.id)).toEqual([]);
    // …and the catalogue a command resolves against is exactly those weapons,
    // so the sweep above is a sweep of what a command can actually reach.
    expect(WEAPONS.filter((w) => itemFor(w.id)?.weapon !== w).map((w) => w.id)).toEqual([]);
  });

  /**
   * Fact 2: a command names its weapon by catalogue id and gets a refusal for
   * anything that is not one, so a caller cannot introduce a third case.
   */
  it('and an attack naming a weapon the book does not list is refused as unknown', () => {
    const out = resolveAttack(world(), A, { weapon: 'feather', target: B }, supply());
    expect(refusal(out)).toBe('unknown_item');
  });

  it('refuses to roll damage for a weapon with neither dice nor a flat amount', () => {
    const nothing = {
      id: 'feather',
      name: 'A Feather',
      category: 'simple',
      kind: 'melee',
      damage: { dice: null, fixed: null, type: 'bludgeoning' },
      properties: [],
      versatileDamage: null,
      thrownRange: null,
      ammunitionRange: null,
      ammunitionType: null,
      propertyNotes: null,
      mastery: null,
      weightLb: 0,
      cost: { amount: 0, currency: 'cp' },
    } as unknown as Weapon;
    const out = rollAttackDamage(
      createRollIssuer('r'),
      createRng('d') as Rng,
      sheet(),
      { weapon: nothing, targetAc: 10 },
      false,
    );
    expect(refusal(out)).toBe('no_damage');
  });
});

describe('a spell aimed at a place is not a spell aimed at a creature', () => {
  /**
   * SRD Hold Person: "Choose a Humanoid that you can see within range." There
   * is no point to aim it at, so a caller who names one has asked for a
   * different spell — and the engine refuses rather than quietly dropping the
   * field, which is the same rule `eligibleTargets` follows about a target it
   * was not given.
   */
  it('refuses a point for a spell that is cast on a target', () => {
    const out = resolveSpell(
      world(),
      A,
      { spellId: 'hold-person', targets: [B], slotLevel: 2, at: { x: 105, y: 100, z: 0 } },
      supply(),
    );
    expect(refusal(out)).toBe('not_an_area');
  });
});

describe('a missing fact is a request, and the request says so', () => {
  /**
   * SRD Hold Person targets "a Humanoid that you can **see**", and sight is
   * three-valued: seen, unseen, and nobody has said. Undeclared is a fact to
   * go and get, so the whole casting comes back as `needs-context` with
   * nothing spent — no slot, no die, no action.
   */
  it('asks for a sight line nobody has declared', () => {
    const stranger = id('c');
    const state = world([
      added('c', 'foes'),
      { type: 'creature-placed', id: stranger, placement: { from: { creature: A }, feet: 5, bearing: 90 } },
    ]);
    const out = resolveSpell(
      state,
      A,
      { spellId: 'hold-person', targets: [stranger], slotLevel: 2 },
      supply(),
    );
    expect(refusal(out)).toBe('needs_context');
    expect(contextRequestsOf(out).map((r) => r.kind)).toContain('visibility');
    // And asking cost nothing: the slot is still there.
    expect(state.creatures[A]?.resources.pools[spellSlotKey(2)]?.spent).toBe(0);
  });
});

describe('a readied move needs somewhere to go', () => {
  /**
   * SRD Ready: the trigger is declared now and the Reaction is taken later.
   * A readied *move* has no destination until the trigger fires — "I move when
   * it charges" does not say where — so the release is the moment the caller
   * says, and a release that does not is refused rather than moving nobody.
   */
  it('refuses to release a readied move with nowhere to go', () => {
    const held = unwrap(
      takeReady(world(), A, { trigger: 'when it charges', response: { kind: 'move' } }),
      'ready',
    );
    // Round the order to somebody else, so the Reaction is available.
    const waiting = world([...held]);
    const turned = unwrap(resolveTurn(waiting, supply()), 'turn').events;
    const out = releaseReady(world([...held, ...turned]), A, {}, supply());
    expect(refusal(out)).toBe('no_placement');
  });
});

describe('a spell cast on a hit has to be one', () => {
  /**
   * SRD Divine Smite is cast "immediately after hitting a target", and what it
   * does is add damage to that attack — an `attack-damage` effect. A spell
   * with a definition and no such effect has nothing to contribute to a swing,
   * so naming one is refused before the slot goes.
   */
  it('refuses a smite that is not a spell cast on a hit', () => {
    const held = unwrap(
      resolveAttack(
        world(),
        A,
        { target: B, weapon: null, hold: true, modes: ['advantage'], attackBonuses: [{ source: 'a sure thing', flat: 50 }] },
        supply('swing'),
      ),
      'attack',
    );
    const after = world(held.events);
    expect(after.pendingAttack).not.toBeNull();
    const out = resolveAttackDamage(
      after,
      A,
      { smite: { spellId: 'hold-person', slotLevel: 2 } },
      supply('damage'),
    );
    expect(refusal(out)).toBe('not_cast_on_a_hit');
  });
});

describe('a dead creature makes no death saving throws', () => {
  /**
   * SRD: death saves are made "at 0 Hit Points", and a creature that is dead
   * is past them. The three answers `rollDeathSave` gives apart are the three
   * states a creature can be in — dead, not dying, Stable — and only the first
   * had never been asserted.
   *
   * The vitals are the engine's own, folded out of a `creature-died` event
   * that `declareCreatureDead` wrote, rather than a `Vitals` built by hand:
   * death that is not hit-point loss is its own event, and this is the state
   * it actually produces.
   */
  it('refuses a death save for a creature the engine has recorded as dead', () => {
    const killed = unwrap(declareCreatureDead(world(), B, 'a wish', {}), 'died');
    const dead = world(killed).creatures[B]!.vitals;
    expect(dead.dead).toBe(true);
    const out = rollDeathSave(createRollIssuer('r'), createRng('d') as Rng, dead);
    expect(refusal(out)).toBe('already_dead');
  });
});

describe('a casting designates each creature once', () => {
  /**
   * SRD Spirit Guardians: "When you cast this spell, you can designate
   * creatures to be unaffected by it." Naming one twice is not emphasis — the
   * list is a set of decisions, and a duplicate means the caller has lost
   * track of which, so the engine says so rather than deduplicating silently.
   */
  it('refuses the same creature designated twice', () => {
    const out = resolveSpell(
      world(),
      A,
      {
        spellId: 'spirit-guardians',
        targets: [],
        slotLevel: 3,
        damageType: 'radiant',
        unaffected: [B, B],
      },
      supply(),
    );
    expect(refusal(out)).toBe('duplicate_designation');
  });
});

describe('a casting answers the question its spell asks, and only that one', () => {
  /**
   * SRD Charm Person: "It does so with Advantage if you or your allies are
   * fighting it." The engine does not hold that fact and will not derive one —
   * `side` is a different question and may be undeclared — so the casting
   * states it, and a casting that says nothing is refused before a slot goes.
   *
   * An answer the engine filled in would be a fact it invented, which is the
   * one thing this whole three-valued discipline exists to stop. Naming the
   * **empty** list is a real answer and is not this case: the caster read the
   * spell and said they were fighting nobody.
   */
  it('refuses a casting that does not say which creatures are being fought', () => {
    const out = resolveSpell(
      world(),
      A,
      { spellId: 'charm-person', targets: [B], slotLevel: 1 },
      supply(),
    );
    expect(refusal(out)).toBe('fought_fact_required');
  });

  /**
   * And the other half, which is the mirror of `damage_type_fixed`: a field a
   * spell does not print is a caller who has misunderstood the spell, not a
   * field to drop quietly.
   */
  it('refuses the fact from a spell that prints no such clause', () => {
    const out = resolveSpell(
      world(),
      A,
      { spellId: 'hold-person', targets: [B], slotLevel: 2, fought: [B] },
      supply(),
    );
    expect(refusal(out)).toBe('no_fought_clause');
  });

  /**
   * The list is a set of facts the caller assembled, so naming one creature
   * twice means they have lost track of it — the reading the neighbouring
   * designation already takes, and the one place these two fields agree that
   * the empty list is not.
   */
  it('refuses the same creature named as fought twice', () => {
    const out = resolveSpell(
      world(),
      A,
      { spellId: 'charm-person', targets: [B], slotLevel: 1, fought: [B, B] },
      supply(),
    );
    expect(refusal(out)).toBe('duplicate_fought_target');
  });
});

describe('a casting that holds no point has nothing to move', () => {
  /**
   * SRD gives a movement allowance to the spells that print one — Spiritual
   * Weapon's twenty feet, Arcane Sword's thirty. Vampiric Touch is Range: Self
   * and holds no point at all, so "move it" names nothing; giving every
   * activation an allowance because one spell has one is a neighbouring
   * spell's clause lending this one a rule.
   */
  it('refuses a destination for a casting with no point to move', () => {
    const cast = unwrap(
      resolveSpell(world(), A, { spellId: 'vampiric-touch', targets: [B], slotLevel: 3 }, supply('cast')),
      'cast',
    );
    const running = world(cast.events);
    const castingId = Object.keys(running.ongoing)[0]!;
    const out = activateSpell(
      running,
      A,
      { castingId, targets: [B], to: { x: 110, y: 100, z: 0 } },
      supply('move'),
    );
    expect(refusal(out)).toBe('not_movable');
  });
});

describe('a Counterspell answers an open casting, and the window is read before anything is spent', () => {
  /**
   * `nothing_to_interrupt` is the re-read *inside* the resolution, and nothing
   * can reach it — see the allowlist entry in `refusal-sweep.test.ts`. What is
   * reachable is the guard in front of it, and it is the one that matters: a
   * Reaction is a whole action-economy slot and usually a slot too, and
   * handing both over for a moment that never came is the expensive kind of
   * wrong. So the window is checked before anything is spent.
   */
  it('refuses a Counterspell when nobody is midway through a casting', () => {
    const state = world();
    expect(pendingCastingsOf(state)).toEqual([]);
    const out = resolveSpell(
      state,
      A,
      { spellId: 'counterspell', targets: [B], slotLevel: 3 },
      supply('counter'),
    );
    expect(refusal(out)).toBe('no_trigger');
    // Nothing spent, which is the whole point of checking here.
    expect(state.creatures[A]?.resources.pools[spellSlotKey(3)]?.spent).toBe(0);
  });

  /**
   * And the readied route — the one path that skips the trigger check, because
   * a readied spell's trigger was declared and paid for when it was readied —
   * cannot carry a Counterspell at all. SRD: "To be readied, a spell must have
   * a casting time of an action", and Counterspell's is a Reaction. That is
   * what closes the only door to the re-read beyond it.
   */
  it('and a Counterspell cannot be readied, because its casting time is a Reaction', () => {
    const out = takeReady(
      world(),
      A,
      {
        trigger: 'when the ogre casts',
        response: { kind: 'spell', spellId: 'counterspell', slotLevel: 3 },
      },
    );
    expect(refusal(out)).toBe('not_readiable');
  });
});

describe('a route that supplies no slot cannot be paid for with one', () => {
  /**
   * A grant says how it may be paid for. Magic Initiate's level 1 spell allows
   * both — "You can also cast the spell using any spell slots you have" — and
   * a declared innate grant need not: a monster's once-a-day ability is not a
   * spell slot's worth of anything.
   *
   * Declared rather than derived, which is the same rule as a stat block's
   * printed Armour Class: creation's own grants cannot reach this branch,
   * because the only one it builds with `slotCasting: false` is a *cantrip*,
   * and a cantrip costs nothing on any route and returns before the check.
   */
  it('refuses a slot on a route that does not take one', () => {
    const innate = world([
      {
        type: 'spellcasting-declared',
        id: B,
        spellcasting: declaredCasting({
          ability: 'cha',
          granted: [
            {
              spellId: 'inflict-wounds',
              source: 'innate:a dark gift',
              ability: 'cha',
              freeCastPool: 'innate:a dark gift:free',
              slotCasting: false,
            },
          ],
        }),
      },
      {
        type: 'resource-pool-declared',
        id: B,
        pool: {
          key: 'innate:a dark gift:free',
          label: 'a dark gift',
          max: 1,
          recovers: 'long-rest',
        },
      },
      {
        type: 'resource-pool-declared',
        id: B,
        pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
      },
    ]);
    const out = resolveSpell(
      innate,
      B,
      { spellId: 'inflict-wounds', targets: [A], payment: 'slot', slotLevel: 1 },
      supply(),
    );
    expect(refusal(out)).toBe('slot_not_allowed');
  });
});

/**
 * A refusal from the turn economy arrives under its own code.
 *
 * `resolveMove` and `spendMounting` both asked `spendMovement` for the feet
 * and then **rewrote whatever came back** unless it was already about
 * movement. Two codes were passed through and everything else — in practice
 * `not_their_turn`, since SRD gives a creature its movement on its own turn
 * and nowhere else — came back as `not_enough_movement` carrying a reason
 * that said "it is not b's turn". A caller branching on the code and a DM
 * reading the reason were handed two different answers to one question, which
 * is the whole of what a refusal-as-a-value is for.
 *
 * It is A's turn in `world()`, and B is the one acting in each case below.
 */
describe('a refusal from the turn economy keeps its own code', () => {
  const M = id('m');

  /** A Large mount standing beside B, who is in the fight and is not up. */
  const stable = (extra: readonly GameEvent[] = []): GameState =>
    world([
      added('m', 'foes'),
      {
        type: 'creature-placed',
        id: M,
        placement: { from: { creature: B }, feet: 5, bearing: 90, size: 'large' },
      },
      ...extra,
    ]);

  it('says whose turn it is not when a rider climbs up out of turn', () => {
    expect(refusal(mountCreature(stable(), B, M, { willing: true }))).toBe('not_their_turn');
  });

  it('and says the same when they try to get down again', () => {
    const riding = stable([{ type: 'mounted', rider: B, mount: M, willing: true }]);
    const out = dismountRider(riding, B, { from: { landmark: 'here' }, feet: 10, bearing: 180 });
    expect(refusal(out)).toBe('not_their_turn');
  });

  /** The same rewrite, at the site `spendMounting` copied it from. */
  it('says whose turn it is not when the move is somebody else’s', () => {
    const out = resolveMove(
      world(),
      B,
      { placement: { from: { landmark: 'here' }, feet: 10, bearing: 180 } },
      supply(),
    );
    expect(refusal(out)).toBe('not_their_turn');
  });

  /**
   * And the code the rewrite stood in for is still the answer where it is the
   * true one: A is up, and has spent every foot of the 30 they had.
   */
  it('still reports the movement allowance when that is what ran out', () => {
    const out = resolveMove(
      world([{ type: 'movement-spent', id: A, feet: 30 }]),
      A,
      { placement: { from: { landmark: 'here' }, feet: 10, bearing: 180 } },
      supply(),
    );
    expect(refusal(out)).toBe('not_enough_movement');
  });

  it('and mounting reports it too, when the rider cannot afford the half-Speed', () => {
    const out = mountCreature(
      world([
        added('m', 'foes'),
        {
          type: 'creature-placed',
          id: M,
          placement: { from: { creature: A }, feet: 5, bearing: 90, size: 'large' },
        },
        { type: 'movement-spent', id: A, feet: 30 },
      ]),
      A,
      M,
      { willing: true },
    );
    expect(refusal(out)).toBe('not_enough_movement');
  });
});

describe('a pool needs a key, and the command is what says so', () => {
  /**
   * A pool is looked up by its key — `spell-slot:3`, `hit-die:d8` — so a blank
   * one is a pool nothing can ever spend from or refill. "Declared, never
   * derived" means the declaration has to say which pool it is declaring.
   *
   * `declareResourcePool` did not ask: it checked whether the creature already
   * *had* the key, which an empty string never is, and emitted the event — so
   * a blank key arrived at the reducer, where `declarePool` refused and the
   * fold threw a corrupt log. **A corrupt log is the backstop for a log that
   * claims something happened, not the answer to a caller's bad argument**, and
   * rules-legal refusals are values. The command mirrors the declaration's own
   * two checks, exactly as it already mirrored `bad_max`.
   */
  it('refuses a blank key through the command, rather than throwing at the fold', () => {
    const out = declareResourcePool(world(), A, {
      key: '   ',
      label: 'a nameless reserve',
      max: 3,
      recovers: 'long-rest',
    });
    expect(refusal(out)).toBe('bad_key');
  });

  /** And the declaration beneath it still answers the same way. */
  it('and the declaration beneath it says the same', () => {
    const out = declarePool(resourceState(), {
      key: '   ',
      label: 'a nameless reserve',
      max: 3,
      recovers: 'long-rest',
    });
    expect(refusal(out)).toBe('bad_key');
  });
});

describe('every Hit Die in a request is checked before any of them is rolled', () => {
  /**
   * "Spending them validates every die before rolling any, so asking for more
   * than are left costs neither a die nor a turn of the generator." A key
   * naming no die is the other half of that sentence, and the validation pass
   * covers the whole request — which is why the rolling loop below it had a
   * second `bad_hit_die` that nothing could reach. The validated sizes are
   * carried forward instead, so there is one check rather than a live one and
   * a dead one spelled alike.
   *
   * The bad key stands **second**, so a pass that stopped at the first entry
   * would have rolled a die before meeting it.
   */
  it('refuses a bad key standing among good ones, with the generator unmoved', () => {
    const resting = unwrap(beginRest(world(), A, 'short', 'begin'), 'begin');
    const rested = fold('seed', [
      ...SETUP,
      ...resting,
      { type: 'time-advanced', seconds: 60 * 60, reason: 'a breather' },
    ]);
    const rolls = supply();
    const out = endRest(rested, A, { hitDice: ['hit-die:d8', 'test:vigour'] }, rolls);
    expect(refusal(out)).toBe('bad_hit_die');
    expect(rolls.issuer.count).toBe(0);
  });
});

describe('a casting of a minute or more, and the Ritual that is one', () => {
  /**
   * Outside combat, where a long casting is legal. SRD "Longer Casting Times"
   * makes it a process the caster keeps at, and the engine keeps the process
   * on the clock — so the fixtures below are the world with the fight taken
   * out of it.
   */
  const peace = (extra: readonly GameEvent[] = []): GameState =>
    fold('seed', [...SETUP.filter((e) => e.type !== 'combat-started'), ...extra]);

  /**
   * SRD writes "minutes or even hours" and never a number. So the engine will
   * not invent one: a casting time of `long` that names no span of seconds has
   * no moment it could complete at, and there is nothing plausible to fall
   * back to.
   */
  it('refuses a long casting that names no moment to complete at', () => {
    const out = castSpell(peace(), A, {
      spell: 'Comprehend Languages',
      level: 1,
      slotLevel: 1,
      castingTime: 'long',
    });
    expect(refusal(out)).toBe('bad_casting_seconds');
  });

  /**
   * **And the floor is the same number the validator holds a definition to.**
   * SRD's bucket is "minutes or even hours", so a six-second `long` casting is
   * incoherent — and the low-level half taking a caller's word about the
   * economy is not the same as taking one about arithmetic. Two spellings of
   * one number would let a casting through here that no definition could ever
   * declare, which is the second answer to one question this engine keeps
   * finding.
   */
  it('refuses a long casting shorter than the minute the bucket names', () => {
    const out = castSpell(peace(), A, {
      spell: 'Comprehend Languages',
      level: 1,
      slotLevel: 1,
      castingTime: 'long',
      castingSeconds: 6,
      hold: { spellId: 'comprehend-languages', targets: [], unverified: [] },
    });
    expect(refusal(out)).toBe('bad_casting_seconds');
  });

  /** And a span of seconds means nothing to a casting time that is a moment. */
  it('refuses a span of seconds on an Action casting time', () => {
    const out = castSpell(peace(), A, {
      spell: 'Inflict Wounds',
      level: 1,
      slotLevel: 1,
      castingSeconds: 60,
    });
    expect(refusal(out)).toBe('casting_seconds_without_long');
  });

  /**
   * **Inverted.** This asserted that a fight running refused a long casting
   * outright, on the grounds that SRD's "you must take the Magic action on each
   * of your turns" was a state machine the engine did not have. It has one now
   * — `PendingCasting.sustainedOnTurn`, `continueCasting` and the derived
   * failure at the caster's own turn boundary — so the refusal is gone and
   * `long-casting.test.ts` drives the obligation instead.
   *
   * `unsupported_casting_time` survives on its other rule, which is about the
   * *shape* of the command rather than about a fight: a casting of a minute or
   * more is a declared casting settled later, so a caller who names nothing for
   * the settlement to resolve has asked for a window nothing could ever close.
   */
  it('refuses a long casting that names nothing for the settlement to resolve', () => {
    const out = castSpell(world(), A, {
      spell: 'Comprehend Languages',
      level: 1,
      slotLevel: 1,
      castingTime: 'long',
      castingSeconds: 60,
    });
    expect(refusal(out)).toBe('unsupported_casting_time');
    expect(isErr(out) && out.reason).toContain('settled later');
  });

  /** The spell has not been cast until the time has passed. */
  it('refuses to settle a casting that is still being cast', () => {
    const declared = unwrap(
      resolveSpell(
        peace(),
        A,
        { spellId: 'comprehend-languages', targets: [], ritual: true },
        supply(),
      ),
      'declare',
    );
    const open = peace(declared.events);
    expect(refusal(resolveDeclaredCast(open, declared.castingId, supply()))).toBe('still_casting');
  });

  /** A spell the book does not tag as a Ritual has no Ritual version. */
  it('refuses a Ritual of a spell that prints no Ritual tag', () => {
    const out = resolveSpell(
      peace(),
      A,
      { spellId: 'inflict-wounds', targets: [B], ritual: true },
      supply(),
    );
    expect(refusal(out)).toBe('not_a_ritual');
  });

  /**
   * SRD: a Ritual "doesn't expend a spell slot, **which means the ritual
   * version of a spell can't be cast at a higher level**". The book's own
   * gloss, so the refusal names the level rather than the slot.
   */
  it('refuses a Ritual cast from a higher slot', () => {
    const out = resolveSpell(
      peace(),
      A,
      { spellId: 'comprehend-languages', targets: [], ritual: true, slotLevel: 3 },
      supply(),
    );
    expect(refusal(out)).toBe('ritual_not_upcast');
  });

  /**
   * And nothing is paid at all — not a slot and not a feat's free casting — so
   * there is no payment to choose between. A field quietly ignored is a caller
   * who thinks they said something.
   */
  it('refuses a Ritual that names a payment', () => {
    const out = resolveSpell(
      peace(),
      A,
      { spellId: 'comprehend-languages', targets: [], ritual: true, payment: 'slot' },
      supply(),
    );
    expect(refusal(out)).toBe('ritual_pays_nothing');
  });
});

describe('one code said five things, and two of them were different questions', () => {
  /**
   * `no_trigger` carried five distinct rules across three modules, which
   * IE-029 measured and left to the task that owns the casting path. Two of
   * them are not about a trigger at all, and the difference is what a caller
   * does next.
   *
   * **`no_trigger` stays for the moment that has not arrived**, which is the
   * genuine window question and the only one a caller answers by waiting: no
   * attack is held, nothing has damaged you, the window has closed, nobody is
   * casting. Four voices, one rule, one code — and each of the four is driven
   * by name in `reaction-triggers.test.ts`, `reactions.test.ts` and
   * `counterspell.test.ts`.
   */
  it('still refuses a Reaction whose moment has not arrived', () => {
    const out = resolveSpell(
      world(),
      A,
      { spellId: 'counterspell', targets: [B], slotLevel: 3 },
      supply(),
    );
    expect(refusal(out)).toBe('no_trigger');
  });

  /**
   * **`no_trigger_stated` is a malformed command**, not an unarrived moment.
   * SRD Ready: "you decide what perceivable circumstance will trigger your
   * Reaction" — so a Ready with an empty trigger has not said what it waits
   * for, and a caller fixes that by re-sending rather than by waiting.
   */
  it('refuses a Ready that never says what it is waiting for', () => {
    const out = takeReady(world(), A, {
      trigger: '   ',
      response: { kind: 'move' },
    });
    expect(refusal(out)).toBe('no_trigger_stated');
  });

  /**
   * **`forced_target` is the window being open and the casting naming the
   * wrong creature.** SRD forces the target of both Reactions that take one —
   * Hellish Rebuke's "the creature that damaged you", Counterspell's "a
   * creature in the process of casting a spell" — so the engine refuses rather
   * than quietly redirecting, which is `eligibleTargets`' rule arriving at a
   * Reaction. Told apart from `no_trigger` because the Reaction really is
   * available and a caller who gave up on it would lose it.
   */
  it('refuses a Counterspell aimed at anybody but the creature casting', () => {
    const declared = unwrap(
      resolveSpell(
        world(),
        A,
        { spellId: 'hold-person', targets: [B], slotLevel: 2, hold: true },
        supply(),
      ),
      'declare',
    );
    const out = resolveSpell(
      world(declared.events),
      B,
      { spellId: 'counterspell', targets: [B], slotLevel: 3 },
      supply(),
    );
    expect(refusal(out)).toBe('forced_target');
  });
});
