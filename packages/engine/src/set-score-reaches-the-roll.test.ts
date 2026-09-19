import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { abilityModifier, type CharacterSheet } from './character.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import type { SpellDefinition } from './spell-definitions.js';
import type { ReactionFeature } from './reactions.js';
import { declaredCasting } from './spellcasting.js';
import { sheetAsItStands } from './standing.js';
import { awardItems } from './commands/declarations.js';
import { rollInitiativeFor } from './commands/initiative.js';
import { equipItem, unequipItem } from './commands/inventory.js';
import {
  resolveAttack,
  resolveAttackDamage,
  resolveSpell,
  resolveTest,
  takeDamageReaction,
  takeTestReaction,
} from './commands.js';

/**
 * A set ability score, at the moment a die is thrown for it.
 *
 * `standing.ts` has answered "what is this creature's Strength right now" for
 * as long as an item could set one, and two readers asked it: an Armour Class
 * and a save-bonus aura. Every other number the SRD derives from a score — an
 * attack roll, the damage it carries, an ability check, a saving throw,
 * Initiative — was rolled off `creature.sheet`, which is the score the
 * character was *built* with. So a Belt of Giant Strength moved the sheet and
 * not the dice, and the item's printed rule stopped at the page.
 *
 * The seam is at the **commands**, not in `attack.ts` or `checks.ts`: those
 * take a `CharacterSheet` and have no state to ask, which is right — one
 * substitution, made where the state is held, rather than a second derivation
 * per roller. So each test below drives a public command and reads the
 * modifier the engine put on the die.
 *
 * Every number asserted here is static: a modifier, not a roll. The dice stay
 * the engine's.
 */

const HERO = asCharacterId('rurik');
const THUG = asCharacterId('thug');
const WITCH = asCharacterId('witch');

/** The score the sheet is built with, and the score the belt sets it to. */
const BASE = 10;
const SET = 21;

/** SRD Belt of Giant Strength, said by a belt nobody printed. */
const BELT: CatalogueItem = {
  id: 'belt-of-the-stone-giant',
  name: 'Belt of Stone Giant Strength',
  kind: 'wondrous',
  weightLb: null,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'ability-score-set', ability: 'str', score: SET }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

/**
 * The same verb on Dexterity, because Initiative is a Dexterity check.
 *
 * SRD: "they make a Dexterity check that determines their place in the
 * Initiative order." A belt that sets Strength cannot say anything about it,
 * so the reader is driven by the item whose score it actually reads.
 */
const BOOTS: CatalogueItem = {
  ...BELT,
  id: 'boots-of-the-stone-giant',
  name: 'Boots of Stone Giant Quickness',
  grants: [
    {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'ability-score-set', ability: 'dex', score: SET }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

/**
 * A spell whose saving throw is a Strength one, so the resolver that rolls a
 * victim's save is driven over the score the belt sets.
 *
 * Shaped on SRD Bane, which is the same effect over a Charisma save; the SRD
 * prints no `buff` whose save is Strength, and a homebrew one goes through the
 * same door the book does.
 */
const SAP: SpellDefinition = {
  id: 'sap-the-mighty',
  name: 'Sap the Mighty',
  level: 1,
  school: 'enchantment',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'buff',
      ability: 'str',
      bonus: { source: 'Sap the Mighty', dice: '1d4' },
      applies: ['attack'],
      direction: 'subtract',
    },
  ],
  durationSeconds: 60,
};

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, { items: [BELT, BOOTS], spells: [SAP] }),
  'extend',
);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: BASE, dex: BASE, con: BASE, int: BASE, wis: BASE, cha: BASE },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const added = (who: CharacterId, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/**
 * A Reaction whose worth is an ability modifier, so the addend is driven too.
 *
 * Shaped on SRD Deflect Attacks, which adds "your Dexterity modifier" to the
 * die it rolls. `ReactionAddend` says the ability case is "resolved when the
 * die is thrown rather than at creation", and a belt is exactly the fact that
 * sentence was written to outlive. It costs no Reaction, so no combat has to
 * be running for the window to be answerable.
 */
const BRACED: ReactionFeature = {
  feature: 'braced',
  name: 'Braced',
  window: 'damage-rolled',
  costsReaction: false,
  pool: null,
  reach: { kind: 'self' },
  does: {
    kind: 'reduce-damage',
    amount: { plus: [{ kind: 'ability', ability: 'str', label: 'Strength modifier' }] },
  },
};

/**
 * And the other window, so both halves of `takeTestReaction` are driven.
 *
 * Shaped on SRD Peerless Skill, which pushes a D20 Test that has been rolled
 * and not yet had its effects. `outcome: 'either'` so the offer stands however
 * the die fell, and `tests` names the check the test below makes.
 */
const STEADY: ReactionFeature = {
  feature: 'steady',
  name: 'Steady',
  window: 'test-rolled',
  costsReaction: false,
  pool: null,
  reach: { kind: 'self' },
  does: {
    kind: 'intervene',
    amount: { plus: [{ kind: 'ability', ability: 'str', label: 'Strength modifier' }] },
    direction: 'bonus',
    tests: ['ability-check'],
    outcome: 'either',
  },
};

/**
 * And the reroll shape of the same window, which reads the score by a
 * different door — `modifierFor` rather than `reactionAddends`.
 *
 * Shaped on SRD Indomitable, so like every reroll it answers a failed saving
 * throw and nothing else. The test below fails it with a Difficulty Class no
 * d20 can reach, so the offer stands whatever the die did.
 */
const DOGGED: ReactionFeature = {
  feature: 'dogged',
  name: 'Dogged',
  window: 'test-rolled',
  costsReaction: false,
  pool: null,
  reach: { kind: 'self' },
  does: { kind: 'reroll', bonus: { kind: 'ability', ability: 'str', label: 'Strength modifier' } },
};

const SETUP: readonly GameEvent[] = [
  added(HERO, { reactions: [BRACED, STEADY, DOGGED] }),
  // A stated Armour Class low enough that the swing below lands, so the test
  // is about the modifier rather than about the die.
  added(THUG, { stated: { armorClass: 5 } }),
  added(WITCH, { spellcastingAbility: 'wis' }),
  {
    type: 'resource-pool-declared',
    id: WITCH,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: HERO, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: HERO }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: WITCH, placement: { from: { creature: HERO }, feet: 10, bearing: 90 } },
  { type: 'sight-declared', from: WITCH, to: HERO, seen: true },
  {
    type: 'spellcasting-declared',
    id: WITCH,
    spellcasting: declaredCasting({ ability: 'wis', cantrips: [], prepared: [SAP.id] }),
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
});

const at = (log: readonly GameEvent[]): GameState => fold('seed', log);

/** The hero, owning and wearing whatever the test names. */
const wearing = (...ids: readonly string[]): readonly GameEvent[] => {
  if (ids.length === 0) return SETUP;
  let log: readonly GameEvent[] = [
    ...SETUP,
    ...unwrap(
      awardItems(
        at(SETUP),
        supply('award'),
        HERO,
        ids.map((id) => ({ id })),
        'the hoard',
        { commandId: 'award' },
      ),
      'award',
    ),
  ];
  for (const id of ids) {
    log = [...log, ...unwrap(equipItem(at(log), CONTENT, HERO, id, `equip-${id}`), id)];
  }
  return log;
};

/** And then taking it off again, which is the other half of "while worn". */
const takingOff = (id: string): readonly GameEvent[] => {
  const on = wearing(id);
  return [...on, ...unwrap(unequipItem(at(on), CONTENT, HERO, id, `off-${id}`), 'unequip')];
};

// — the readers, one per door ————————————————————————————————————————————————

/** SRD Unarmed Strike: "your Strength modifier plus your Proficiency Bonus". */
const swing = (log: readonly GameEvent[]) =>
  unwrap(
    resolveAttack(
      at(log),
      HERO,
      { target: THUG, weapon: null, commandId: 'swing' },
      // The thug's Armour Class is stated at 5 and this seed's first d20 is
      // nowhere near a 1, so the swing lands whichever Strength is behind it
      // — and every test below asserts that it did, so a seed that stopped
      // being generous would say so rather than quietly prove nothing.
      supply('fist'),
    ),
    'attack',
  );

const takeTest = (log: readonly GameEvent[], kind: 'ability-check' | 'saving-throw') =>
  unwrap(
    resolveTest(
      at(log),
      HERO,
      { kind, ability: 'str', dc: 10, commandId: `test-${kind}` },
      supply('test'),
    ),
    'test',
  );

const testModifier = (log: readonly GameEvent[], kind: 'ability-check' | 'saving-throw') =>
  takeTest(log, kind).test!.modifier;

/**
 * What Steady adds to a check the hero has already rolled.
 *
 * `resolveTest` holds the result open because the hero holds a `test-rolled`
 * feature, and answering it pushes the total by the feature's whole amount —
 * here one ability modifier and no die, so the difference between the two
 * totals is the modifier and nothing else.
 */
const steadyAdds = (log: readonly GameEvent[]) => {
  const rolled = takeTest(log, 'ability-check');
  expect(rolled.offers.some((offer) => offer.feature === STEADY.feature)).toBe(true);
  const pushed = unwrap(
    takeTestReaction(
      at([...log, ...rolled.events]),
      HERO,
      { feature: STEADY.feature, commandId: 'steady' },
      supply('steady'),
    ),
    'steady',
  );
  return pushed.test!.total - rolled.test!.total;
};

/**
 * What Dogged adds to the save it rerolls.
 *
 * `rerollTest` folds the new flat bonus into the rerolled test's own modifier,
 * so the difference between the two modifiers is the bonus and nothing else —
 * the ability modifier already inside the first one cancels.
 */
const doggedAdds = (log: readonly GameEvent[]) => {
  const rolled = unwrap(
    resolveTest(
      at(log),
      HERO,
      // No d20 reaches 30 with either Strength behind it, so the save fails
      // and the offer a reroll only makes against a failure is always there.
      { kind: 'saving-throw', ability: 'str', dc: 30, commandId: 'doomed-save' },
      supply('test'),
    ),
    'test',
  );
  expect(rolled.test!.success).toBe(false);
  const pushed = unwrap(
    takeTestReaction(
      at([...log, ...rolled.events]),
      HERO,
      { feature: DOGGED.feature, commandId: 'dogged' },
      supply('dogged'),
    ),
    'dogged',
  );
  return pushed.test!.modifier - rolled.test!.modifier;
};

const initiativeModifier = (log: readonly GameEvent[]) =>
  unwrap(
    rollInitiativeFor(at(log), HERO, createRollIssuer('r'), createRng('initiative'), {}),
    'initiative',
  ).modifier;

/**
 * The same swing, held and then settled, which is the other damage roller.
 *
 * SRD Divine Smite lands between the two, so `resolveAttackDamage` rolls the
 * damage separately — and it is a separate reader of the attacker's sheet.
 * The score is asked for again when the blow is settled rather than pinned
 * when the hit landed, because "while you wear this" is the item's own clause.
 */
const heldSwingDamage = (log: readonly GameEvent[]) => {
  const swung = unwrap(
    resolveAttack(
      at(log),
      HERO,
      { target: THUG, weapon: null, hold: true, commandId: 'held-swing' },
      supply('fist'),
    ),
    'attack',
  );
  expect(swung.attack!.hit).toBe(true);
  expect(swung.damage).toBeUndefined();
  return unwrap(
    resolveAttackDamage(
      at([...log, ...swung.events]),
      HERO,
      { commandId: 'settle-held-swing' },
      supply('fist'),
    ),
    'settle',
  ).damage;
};

/**
 * How much Braced takes off a blow aimed at the hero.
 *
 * The thug swings, the damage roll is held open because the hero has a
 * `damage-rolled` feature, and the hero answers it. What comes off is the
 * feature's whole amount, which here is one ability modifier and no die.
 */
const braceAgainst = (log: readonly GameEvent[]) => {
  const swung = unwrap(
    resolveAttack(
      at(log),
      THUG,
      { target: HERO, weapon: null, commandId: 'thug-swings' },
      supply('fist'),
    ),
    'attack',
  );
  expect(swung.attack!.hit).toBe(true);
  const held = [...log, ...swung.events];
  const answered = unwrap(
    takeDamageReaction(
      at(held),
      HERO,
      { feature: BRACED.feature, commandId: 'brace' },
      supply('brace'),
    ),
    'brace',
  );
  return answered.reduction?.amount ?? null;
};

/** The Strength save `resolveBuffEffect` rolls for the spell's victim. */
const spellSaveModifier = (log: readonly GameEvent[]) => {
  const cast = unwrap(
    resolveSpell(
      at(log),
      WITCH,
      { spellId: SAP.id, targets: [HERO], slotLevel: 1 },
      supply('sap'),
    ),
    'cast',
  );
  const recorded = cast.events.find(
    (event) => event.type === 'roll-recorded' && event.who === HERO,
  );
  if (recorded === undefined || recorded.type !== 'roll-recorded') {
    throw new Error('the spell rolled no save for its victim');
  }
  // `recordD20Test` names the ability and the proficiency "modifier" and every
  // flat bonus after it, so this is the part the sheet contributed.
  return recorded.contributions?.find((one) => one.source === 'modifier')?.amount ?? null;
};

describe('a score an item sets reaches the dice', () => {
  const PROFICIENCY = 3; // level 5

  it('is on the attack roll', () => {
    expect(swing(SETUP).attack!.roll.modifier).toBe(abilityModifier(BASE) + PROFICIENCY);
    expect(swing(wearing(BELT.id)).attack!.roll.modifier).toBe(
      abilityModifier(SET) + PROFICIENCY,
    );
  });

  it('is on the damage the attack carries', () => {
    // SRD Unarmed Strike deals "1 plus your Strength modifier" Bludgeoning
    // damage and rolls no die for it, so the whole amount is static and the
    // assertion is about the modifier rather than about a roll.
    const bare = swing(SETUP);
    const belted = swing(wearing(BELT.id));
    expect(bare.attack!.hit).toBe(true);
    expect(belted.attack!.hit).toBe(true);
    expect(bare.damage).toBe(1 + abilityModifier(BASE));
    expect(belted.damage).toBe(1 + abilityModifier(SET));
  });

  it('is on an ability check', () => {
    expect(testModifier(SETUP, 'ability-check')).toBe(abilityModifier(BASE));
    expect(testModifier(wearing(BELT.id), 'ability-check')).toBe(abilityModifier(SET));
  });

  it('is on a saving throw', () => {
    expect(testModifier(SETUP, 'saving-throw')).toBe(abilityModifier(BASE));
    expect(testModifier(wearing(BELT.id), 'saving-throw')).toBe(abilityModifier(SET));
  });

  it('is on the saving throw a spell rolls for its victim', () => {
    expect(spellSaveModifier(SETUP)).toBe(abilityModifier(BASE));
    expect(spellSaveModifier(wearing(BELT.id))).toBe(abilityModifier(SET));
  });

  it('is on Initiative, which is the Dexterity check the boots set', () => {
    expect(initiativeModifier(SETUP)).toBe(abilityModifier(BASE));
    expect(initiativeModifier(wearing(BOOTS.id))).toBe(abilityModifier(SET));
  });

  it('is on the damage of a hit that was held and settled separately', () => {
    expect(heldSwingDamage(SETUP)).toBe(1 + abilityModifier(BASE));
    expect(heldSwingDamage(wearing(BELT.id))).toBe(1 + abilityModifier(SET));
  });

  it('is on the ability modifier a Reaction adds to what it takes off', () => {
    expect(braceAgainst(SETUP)).toBe(abilityModifier(BASE));
    expect(braceAgainst(wearing(BELT.id))).toBe(abilityModifier(SET));
  });

  it('is on the ability modifier a Reaction adds to a test already rolled', () => {
    expect(steadyAdds(SETUP)).toBe(abilityModifier(BASE));
    expect(steadyAdds(wearing(BELT.id))).toBe(abilityModifier(SET));
  });

  it('is on the ability modifier a Reaction adds to the test it rerolls', () => {
    expect(doggedAdds(SETUP)).toBe(abilityModifier(BASE));
    expect(doggedAdds(wearing(BELT.id))).toBe(abilityModifier(SET));
  });
});

describe('and it is gone the moment the item comes off', () => {
  const PROFICIENCY = 3;

  it('gives the attack roll, its damage and the two tests back', () => {
    const off = takingOff(BELT.id);
    expect(swing(off).attack!.roll.modifier).toBe(abilityModifier(BASE) + PROFICIENCY);
    expect(swing(off).damage).toBe(1 + abilityModifier(BASE));
    expect(testModifier(off, 'ability-check')).toBe(abilityModifier(BASE));
    expect(testModifier(off, 'saving-throw')).toBe(abilityModifier(BASE));
    expect(spellSaveModifier(off)).toBe(abilityModifier(BASE));
  });

  it('gives Initiative back', () => {
    expect(initiativeModifier(takingOff(BOOTS.id))).toBe(abilityModifier(BASE));
  });
});

/**
 * And a creature nothing is setting a score on pays nothing for the question.
 *
 * The substitution is one object allocation, made only where it changes
 * something — which is why threading it through every roller costs the
 * overwhelming majority of creatures nothing at all, and why the frozen logs
 * fold exactly where they always did.
 */
describe('a creature with no such item', () => {
  it('is handed its own sheet, by identity', () => {
    const bare = at(SETUP);
    expect(sheetAsItStands(bare, HERO)).toBe(bare.creatures[HERO]?.sheet);
  });

  it('rolls everything off the sheet it was built with', () => {
    const bare = at(SETUP);
    const abilities = bare.creatures[HERO]!.sheet.abilities;
    expect(swing(SETUP).attack!.roll.modifier).toBe(abilityModifier(abilities.str) + 3);
    expect(testModifier(SETUP, 'ability-check')).toBe(abilityModifier(abilities.str));
    expect(initiativeModifier(SETUP)).toBe(abilityModifier(abilities.dex));
  });
});
