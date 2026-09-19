import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CatalogueItem } from './catalogue.js';
import { abilityModifier, type CharacterSheet } from './character.js';
import { extendContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import type { SpellDefinition } from './spell-definitions.js';
import { declaredCasting } from './spellcasting.js';
import { sheetAsItStands } from './standing.js';
import {
  availableChecks,
  awardItems,
  equipItem,
  resolveDamage,
  resolveEffectCheck,
  resolveSpell,
  resolveTurn,
  unequipItem,
  useSelfHeal,
} from './commands.js';

/**
 * A set ability score, at the moment a **casting** reads it.
 *
 * `set-score-reaches-the-roll.test.ts` drove the rollers a command hands a
 * sheet to — an attack, its damage, a check, a save, Initiative, a Reaction's
 * addend — and left one family behind, named in `sheetAsItStands`'s own
 * docstring rather than implied: the numbers a *spell* is made with, the rolls
 * its effects make, the Concentration that damage puts at risk, the two rolls
 * a turn boundary repeats, and a self-heal's addend. Each was rolled off
 * `creature.sheet`, which is the score the character was **built** with, so an
 * Amulet of Health moved the sheet and not the Constitution save the SRD
 * prints the amulet against.
 *
 * The seam is the same one, and in the same place: the *command* asks
 * `sheetAsItStands` once, where the state is, and hands the answer down.
 * `attack.ts` and `checks.ts` are untouched — a roller that went looking for a
 * worn item would be the second derivation that function exists to prevent.
 *
 * Every number asserted here is static: a save DC, an attack modifier, the
 * modifier on a save, an addend. The dice stay the engine's.
 */

const id = (s: string) => asCharacterId(s);
/** The caster. Her spellcasting ability is Wisdom, so a circlet moves it. */
const WITCH = id('witch');
/** Whatever she points it at, and the one the belt is strapped to. */
const OGRE = id('ogre');
/** A second caster, so a Counterspell has somebody to come from. */
const RIVAL = id('rival');

/** The score a sheet is built with, and the score an item sets it to. */
const BASE = 10;
const SET = 21;
/** SRD Amulet of Health: "Your Constitution is 19 while you wear this amulet." */
const AMULET = 'amulet-of-health';
const AMULET_SETS = 19;

/** Level 9 on both sheets, so every Proficiency Bonus below is this one. */
const PROFICIENCY = 4;

/** SRD Headband of Intellect's sentence, said over Wisdom by nobody's circlet. */
const CIRCLET: CatalogueItem = {
  id: 'circlet-of-the-owl',
  name: 'Circlet of the Owl',
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
      effects: [{ kind: 'ability-score-set', ability: 'wis', score: SET }],
      requires: [{ kind: 'while-worn' }],
    },
  ],
};

/** The same verb on Strength, for the rolls a victim makes. */
const BELT: CatalogueItem = {
  ...CIRCLET,
  id: 'belt-of-the-stone-giant',
  name: 'Belt of Stone Giant Strength',
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
 * A wand that prints **neither** number, so both are the wielder's own.
 *
 * SRD "Spells Cast from Items": a wand that prints its own save DC has settled
 * it, and one that does not leaves "your spell save DC" to the rule the book
 * prints once. `numbersForItem` is the reader of that rule, and it is the one
 * under test here — which is why this wand prints no `saveDc` and no
 * `attackBonus`, and why it is at-will rather than charged: a charge is a
 * different question and it has its own file.
 */
const WAND: CatalogueItem = {
  ...CIRCLET,
  id: 'wand-of-the-plain-tangle',
  name: 'Wand of the Plain Tangle',
  kind: 'wand',
  weightLb: 1,
  grants: [
    { kind: 'casts', spell: 'fire-bolt', atWill: true },
    { kind: 'casts', spell: 'tangle-the-mighty', atWill: true },
  ],
};

/**
 * A Strength save that leaves something running, so one spell drives four
 * readers: the DC the caster derives, the save the victim rolls, the escape
 * the condition offers and the save it repeats.
 *
 * Shaped on SRD Black Tentacles, which writes all four sentences over the same
 * Strength save; this is that spell with one target and smaller dice, because
 * the SRD prints no single-target one and a homebrew spell goes through the
 * same door the book does.
 */
const TANGLE: SpellDefinition = {
  id: 'tangle-the-mighty',
  name: 'Tangle the Mighty',
  level: 2,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 90 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'save-damage',
      ability: 'str',
      damage: { dice: '1d4' },
      damageType: 'bludgeoning',
      onSuccess: 'none',
      conditions: [
        {
          name: 'restrained',
          check: { ability: 'str', skill: 'athletics', onSuccess: 'end-on-target' },
          repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
        },
      ],
    },
  ],
  durationSeconds: 60,
};

/**
 * The other victim-save resolver: a saving throw with no damage beside it.
 *
 * `save-damage` and `save` are two functions in `spell-effect-rolls.ts` and
 * each rolls its own save, so one of them moving is not the other moving.
 */
const GRASP: SpellDefinition = {
  id: 'grasp-of-the-deep',
  name: 'Grasp of the Deep',
  level: 1,
  school: 'conjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [{ kind: 'save', ability: 'str', condition: 'grappled' }],
  durationSeconds: 60,
};

/**
 * Dispel Magic's ability check at a level a level 1 slot cannot end outright.
 *
 * SRD Dispel Magic: "make an ability check using your spellcasting ability (DC
 * 10 plus that spell's level)", which is the one roll in the engine a *caster*
 * makes through `spell-effect-magic.ts`. Level 1 so that the level 2 tangle is
 * above the slot and the check is actually rolled.
 */
const UNWEAVE: SpellDefinition = {
  id: 'unweave',
  name: 'Unweave',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [{ kind: 'dispel' }],
};

/** Something to concentrate on, so damage has a Concentration to threaten. */
const WARD: SpellDefinition = {
  id: 'ward-of-the-owl',
  name: 'Ward of the Owl',
  level: 1,
  school: 'abjuration',
  castingTime: 'action',
  concentration: true,
  range: { kind: 'ranged', feet: 30 },
  targets: { count: 1 },
  effects: [
    {
      kind: 'buff',
      ability: 'str',
      bonus: { source: 'Ward of the Owl', flat: 1 },
      applies: ['attack'],
      direction: 'add',
    },
  ],
  durationSeconds: 600,
};

const CONTENT: Content = unwrap(
  extendContent(SRD_CONTENT, {
    items: [CIRCLET, BELT, WAND],
    spells: [TANGLE, GRASP, UNWEAVE, WARD],
  }),
  'extend',
);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 9,
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

/** The pool the self-heal below spends a use out of. */
const BREATH = 'ogre:second-breath';

/**
 * A self-heal whose addend is an ability modifier.
 *
 * Shaped on SRD Wholeness of Body, which adds "your Wisdom modifier" to the
 * die it rolls. `selfHealAddend` says the ability case is derived "so the
 * number is the one on the sheet when the die is thrown" — and a belt is
 * exactly the fact that sentence was written to outlive.
 */
const SECOND_BREATH = {
  feature: 'second-breath',
  name: 'Second Breath',
  action: 'bonus-action' as const,
  pool: BREATH,
  dice: '1d10',
  plus: { kind: 'ability' as const, ability: 'str' as const, label: 'Strength modifier' },
};

const SETUP: readonly GameEvent[] = [
  added(WITCH, { spellcastingAbility: 'wis' }),
  added(OGRE, { selfHeals: [SECOND_BREATH] }),
  added(RIVAL, { spellcastingAbility: 'int', abilities: { str: BASE, dex: BASE, con: BASE, int: 16, wis: BASE, cha: BASE } }),
  ...[1, 2, 3].flatMap((level): GameEvent[] =>
    [WITCH, RIVAL].map((who) => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: spellSlotKey(level), label: `level ${level}`, max: 4, recovers: 'long-rest' },
    })),
  ),
  {
    type: 'resource-pool-declared',
    id: OGRE,
    pool: { key: BREATH, label: 'Second Breath', max: 2, recovers: 'short-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: WITCH,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['fire-bolt'],
      prepared: [TANGLE.id, GRASP.id, UNWEAVE.id, WARD.id],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: RIVAL,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['counterspell'] }),
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WITCH, placement: { from: { landmark: 'the road' }, feet: 0 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: WITCH }, feet: 20, bearing: 0 } },
  { type: 'creature-placed', id: RIVAL, placement: { from: { creature: WITCH }, feet: 20, bearing: 90 } },
  { type: 'sight-declared', from: WITCH, to: OGRE, seen: true },
  { type: 'sight-declared', from: OGRE, to: WITCH, seen: true },
  { type: 'sight-declared', from: RIVAL, to: WITCH, seen: true },
  { type: 'sight-declared', from: WITCH, to: RIVAL, seen: true },
];

const at = (log: readonly GameEvent[]): GameState => fold('seed', log);

const supply = (seed: string, flat = 0) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: CONTENT,
  bonuses: [{ source: 'the fixture insists', flat }],
});

const run = (
  log: readonly GameEvent[],
  command: (s: GameState) => Result<readonly GameEvent[]>,
): readonly GameEvent[] => [...log, ...unwrap(command(at(log)), 'command')];

/** Found, then worn. Attuned too, where the item's own line asks for it. */
const wearing = (
  who: CharacterId,
  itemId: string,
  log: readonly GameEvent[],
): readonly GameEvent[] => {
  const owned = run(log, (s) =>
    awardItems(s, supply('the-hoard'), who, [{ id: itemId }], 'the hoard', {
      commandId: `award-${who}-${itemId}`,
    }),
  );
  const held = run(owned, (s) => equipItem(s, CONTENT, who, itemId, `equip-${who}-${itemId}`));
  return CONTENT.item(itemId)?.attunement === undefined
    ? held
    : [...held, { type: 'attuned', id: who, item: itemId }];
};

/**
 * The starting log: the wand in the witch's hand and nothing that sets a score.
 *
 * The wand is here rather than in the item's own test because it is the
 * *baseline* every casting below is measured against — an item that prints no
 * numbers leaves both of them to the wielder's sheet, so it moves with the
 * circlet exactly as her own casting does.
 */
const BARE: readonly GameEvent[] = wearing(WITCH, WAND.id, SETUP);

/** The same, with whatever the test straps on. */
const worn = (who: CharacterId, itemId: string): readonly GameEvent[] =>
  wearing(who, itemId, BARE);

/** And taking it off again, which is the other half of "while you wear this". */
const takenOff = (who: CharacterId, itemId: string): readonly GameEvent[] => {
  const on = worn(who, itemId);
  return run(on, (s) => unequipItem(s, CONTENT, who, itemId, `off-${itemId}`));
};

// — the seven readers, one helper each ———————————————————————————————————————

/** Cast one of the witch's own spells at the ogre. */
const cast = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveSpell>[2],
  seed = 'cast',
  flat = 0,
) => unwrap(resolveSpell(at(log), WITCH, request, supply(seed, flat)), 'cast');

/** The save DC the tangle was made with: `numbersFor`, off the caster's sheet. */
const spellSaveDc = (log: readonly GameEvent[]) =>
  cast(log, { spellId: TANGLE.id, targets: [OGRE], slotLevel: 2, commandId: 'dc' }).outcomes[0]
    ?.save?.dc ?? null;

/** The spell attack modifier: the other half of `numbersFor`. */
const spellAttackModifier = (log: readonly GameEvent[]) =>
  cast(log, { spellId: 'fire-bolt', targets: [OGRE], commandId: 'bolt' }).outcomes[0]?.attack?.roll
    .modifier ?? null;

/** The same two numbers, derived for a wand that printed neither. */
const wandAttackModifier = (log: readonly GameEvent[]) =>
  cast(log, { spellId: 'fire-bolt', targets: [OGRE], item: WAND.id, commandId: 'wand-bolt' })
    .outcomes[0]?.attack?.roll.modifier ?? null;

const wandSaveDc = (log: readonly GameEvent[]) =>
  cast(log, { spellId: TANGLE.id, targets: [OGRE], item: WAND.id, commandId: 'wand-dc' })
    .outcomes[0]?.save?.dc ?? null;

/** The victim's own save against a `save-damage` effect. */
const saveDamageModifier = (log: readonly GameEvent[]) =>
  cast(log, { spellId: TANGLE.id, targets: [OGRE], slotLevel: 2, commandId: 'sd' }).outcomes[0]
    ?.save?.modifier ?? null;

/** And against the `save` effect beside it, which is a second resolver. */
const saveModifier = (log: readonly GameEvent[]) =>
  cast(log, { spellId: GRASP.id, targets: [OGRE], slotLevel: 1, commandId: 's' }).outcomes[0]?.save
    ?.modifier ?? null;

/** The tangle, cast so that the ogre is certainly caught by it. */
const tangled = (log: readonly GameEvent[] = SETUP): readonly GameEvent[] => [
  ...log,
  ...cast(log, { spellId: TANGLE.id, targets: [OGRE], slotLevel: 2, commandId: 'tangle' }, 'tangle', -40)
    .events,
];

/** SRD Dispel Magic's ability check — the caster's roll in `spell-effect-magic`. */
const dispelCheckModifier = (log: readonly GameEvent[]) =>
  cast(tangled(log), { spellId: UNWEAVE.id, targets: [OGRE], slotLevel: 1, commandId: 'unweave' })
    .outcomes[0]?.check?.modifier ?? null;

/** The escape the tangle offers, rolled by the creature it holds. */
const escapeCheckModifier = (log: readonly GameEvent[]) => {
  const held = tangled(log);
  const state = at(held);
  const offered = availableChecks(state, OGRE);
  expect(offered).toHaveLength(1);
  return (
    unwrap(
      resolveEffectCheck(state, OGRE, { effectKey: offered[0]!.effectKey, commandId: 'escape' }, supply('escape')),
      'escape',
    ).check?.modifier ?? null
  );
};

/** The save the tangle repeats when the ogre's turn ends. */
const repeatSaveModifier = (log: readonly GameEvent[]) => {
  const fighting: readonly GameEvent[] = [
    ...tangled(log),
    {
      type: 'combat-started',
      combatants: [
        { id: OGRE, initiative: 20, speed: 30 },
        { id: WITCH, initiative: 10, speed: 30 },
      ],
    },
  ];
  const turn = unwrap(resolveTurn(at(fighting), supply('boundary')), 'turn');
  expect(turn.saves).toHaveLength(1);
  return turn.saves[0]!.save.modifier;
};

/** The Constitution save the damage a Concentration is taken through asks for. */
const concentrationSaveModifier = (log: readonly GameEvent[]) => {
  const warded = [
    ...log,
    ...cast(log, { spellId: WARD.id, targets: [OGRE], slotLevel: 1, commandId: 'ward' }, 'ward')
      .events,
  ];
  const hurt = unwrap(
    resolveDamage(at(warded), WITCH, { amount: 12, commandId: 'hurt' }, supply('hurt')),
    'damage',
  );
  expect(hurt.concentration.kind).toBe('resolved');
  return hurt.concentration.kind === 'resolved' ? hurt.concentration.save.modifier : null;
};

/** What the ogre's Second Breath adds to the die it throws. */
const selfHealAddendOf = (log: readonly GameEvent[]) => {
  const wounded = [
    ...log,
    ...unwrap(
      resolveDamage(at(log), OGRE, { amount: 60, commandId: 'wound' }, supply('wound')),
      'wound',
    ).events,
  ];
  const healed = unwrap(
    useSelfHeal(
      at(wounded),
      OGRE,
      { feature: SECOND_BREATH.feature, commandId: 'breathe' },
      { issuer: createRollIssuer('r'), rng: createRng('breath') as Rng },
    ),
    'self-heal',
  );
  const recorded = healed.find((event) => event.type === 'roll-recorded');
  if (recorded === undefined || recorded.type !== 'roll-recorded') {
    throw new Error('the self-heal rolled nothing');
  }
  return recorded.contributions?.[0]?.amount ?? null;
};

/** The Constitution save a countered caster makes, with the amulet on her. */
const counterspellSaveModifier = (log: readonly GameEvent[]) => {
  const fighting: readonly GameEvent[] = [
    ...log,
    {
      type: 'combat-started',
      combatants: [
        { id: WITCH, initiative: 20, speed: 30 },
        { id: RIVAL, initiative: 10, speed: 30 },
      ],
    },
  ];
  const declared = [
    ...fighting,
    ...unwrap(
      resolveSpell(
        at(fighting),
        WITCH,
        { spellId: TANGLE.id, targets: [OGRE], slotLevel: 2, hold: true, commandId: 'declare' },
        supply('declare'),
      ),
      'declare',
    ).events,
  ];
  const countered = unwrap(
    resolveSpell(
      at(declared),
      RIVAL,
      { spellId: 'counterspell', targets: [WITCH], slotLevel: 3, commandId: 'counter' },
      supply('counter'),
    ),
    'counterspell',
  );
  return countered.outcomes[0]?.save?.modifier ?? null;
};

describe('a score an item sets reaches the numbers a casting is made with', () => {
  it('is in the spell save DC the caster derives', () => {
    expect(spellSaveDc(BARE)).toBe(8 + PROFICIENCY + abilityModifier(BASE));
    expect(spellSaveDc(worn(WITCH, CIRCLET.id))).toBe(8 + PROFICIENCY + abilityModifier(SET));
  });

  it('is in the spell attack modifier beside it', () => {
    expect(spellAttackModifier(BARE)).toBe(PROFICIENCY + abilityModifier(BASE));
    expect(spellAttackModifier(worn(WITCH, CIRCLET.id))).toBe(
      PROFICIENCY + abilityModifier(SET),
    );
  });

  it('is in the numbers a wand that printed none leaves to its wielder', () => {
    expect(wandAttackModifier(BARE)).toBe(PROFICIENCY + abilityModifier(BASE));
    expect(wandSaveDc(BARE)).toBe(8 + PROFICIENCY + abilityModifier(BASE));

    const circled = worn(WITCH, CIRCLET.id);
    expect(wandAttackModifier(circled)).toBe(PROFICIENCY + abilityModifier(SET));
    expect(wandSaveDc(circled)).toBe(8 + PROFICIENCY + abilityModifier(SET));
  });

  it('is in the ability check a dispel rolls', () => {
    // SRD: "an ability check using your spellcasting ability" — bare, so no
    // Proficiency Bonus joins it and the whole modifier is the score.
    expect(dispelCheckModifier(BARE)).toBe(abilityModifier(BASE));
    expect(dispelCheckModifier(worn(WITCH, CIRCLET.id))).toBe(abilityModifier(SET));
  });
});

describe('a score an item sets reaches the rolls a spell asks its victim for', () => {
  it('is on the save a `save-damage` effect rolls', () => {
    expect(saveDamageModifier(BARE)).toBe(abilityModifier(BASE));
    expect(saveDamageModifier(worn(OGRE, BELT.id))).toBe(abilityModifier(SET));
  });

  it('is on the save the `save` effect beside it rolls', () => {
    expect(saveModifier(BARE)).toBe(abilityModifier(BASE));
    expect(saveModifier(worn(OGRE, BELT.id))).toBe(abilityModifier(SET));
  });

  it('is on the Constitution save a Counterspell asks the caster for', () => {
    expect(counterspellSaveModifier(BARE)).toBe(abilityModifier(BASE));
    expect(counterspellSaveModifier(worn(WITCH, AMULET))).toBe(abilityModifier(AMULET_SETS));
  });
});

describe('a score an item sets reaches what a turn boundary repeats', () => {
  it('is on the escape check the condition offers', () => {
    expect(escapeCheckModifier(BARE)).toBe(abilityModifier(BASE));
    expect(escapeCheckModifier(worn(OGRE, BELT.id))).toBe(abilityModifier(SET));
  });

  it('is on the save the boundary repeats', () => {
    expect(repeatSaveModifier(BARE)).toBe(abilityModifier(BASE));
    expect(repeatSaveModifier(worn(OGRE, BELT.id))).toBe(abilityModifier(SET));
  });
});

describe('an Amulet of Health reaches the save the book prints it against', () => {
  /**
   * SRD Concentration: "whenever you take damage, you must succeed on a
   * Constitution saving throw to maintain it" — and the amulet's whole printed
   * text is "Your Constitution is 19 while you wear this amulet". The two
   * sentences met nowhere until this substitution.
   */
  it('is on the Constitution save that keeps a spell going', () => {
    expect(concentrationSaveModifier(BARE)).toBe(abilityModifier(BASE));
    expect(concentrationSaveModifier(worn(WITCH, AMULET))).toBe(abilityModifier(AMULET_SETS));
  });
});

describe('a score an item sets reaches a feature’s own addend', () => {
  it('is what a self-heal adds to its die', () => {
    expect(selfHealAddendOf(BARE)).toBe(abilityModifier(BASE));
    expect(selfHealAddendOf(worn(OGRE, BELT.id))).toBe(abilityModifier(SET));
  });
});

describe('and it is gone the moment the item comes off', () => {
  it('gives the caster’s numbers back', () => {
    const off = takenOff(WITCH, CIRCLET.id);
    expect(spellSaveDc(off)).toBe(8 + PROFICIENCY + abilityModifier(BASE));
    expect(spellAttackModifier(off)).toBe(PROFICIENCY + abilityModifier(BASE));
    expect(wandSaveDc(off)).toBe(8 + PROFICIENCY + abilityModifier(BASE));
    expect(dispelCheckModifier(off)).toBe(abilityModifier(BASE));
  });

  it('gives the victim’s rolls back', () => {
    const off = takenOff(OGRE, BELT.id);
    expect(saveDamageModifier(off)).toBe(abilityModifier(BASE));
    expect(saveModifier(off)).toBe(abilityModifier(BASE));
    expect(escapeCheckModifier(off)).toBe(abilityModifier(BASE));
    expect(repeatSaveModifier(off)).toBe(abilityModifier(BASE));
    expect(selfHealAddendOf(off)).toBe(abilityModifier(BASE));
  });

  it('gives the Concentration save back', () => {
    expect(concentrationSaveModifier(takenOff(WITCH, AMULET))).toBe(abilityModifier(BASE));
  });
});

/**
 * And a creature nothing is setting a score on pays nothing for the question:
 * the same object comes back, so the substitution costs an allocation only
 * where it changes something — which is why the frozen logs fold exactly where
 * they always did.
 */
describe('a creature with no such item', () => {
  it('is handed its own sheet, by identity', () => {
    const bare = at(BARE);
    expect(sheetAsItStands(bare, WITCH)).toBe(bare.creatures[WITCH]?.sheet);
    expect(sheetAsItStands(bare, OGRE)).toBe(bare.creatures[OGRE]?.sheet);
  });

  it('makes every casting off the sheet it was built with', () => {
    const bare = at(BARE);
    const abilities = bare.creatures[WITCH]!.sheet.abilities;
    expect(spellSaveDc(BARE)).toBe(8 + PROFICIENCY + abilityModifier(abilities.wis));
    expect(spellAttackModifier(BARE)).toBe(PROFICIENCY + abilityModifier(abilities.wis));
  });
});
