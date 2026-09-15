import { describe, expect, it } from 'vitest';
import { SPELL_DEFINITIONS, SRD_CONTENT } from '@ie/content';
import {
  asCharacterId,
  isErr,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng, type RngState } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import type { D20TestResult } from './checks.js';
import type { ModeSource } from './bonuses.js';
import { spellSlotKey } from './resources.js';
import {
  endConcentration,
  resolveAttack,
  resolveSpell,
  resolveTest,
  resolveTurn,
  takeDodge,
} from './commands.js';
import { declaredCasting } from './spellcasting.js';
import { rollModesFor } from './standing.js';
import {
  grantedRollModes,
  selectorMatches,
  rollSelectorProblems,
  type RollSelector,
} from './roll-modifiers.js';
import { SKILL_ABILITY } from '@ie/shared';
import { type SpellDefinition } from './spell-definitions.js';
import {
  checkSpellDefinition,
  checkSpellDefinitionValue,
  parseSpellDefinition,
} from './spell-schema.js';

/**
 * Advantage and Disadvantage that a running effect grants, and the question
 * the engine had no way to ask before it:
 *
 * > **Does this source modify THIS roll?**
 *
 * The engine has always settled a list of modes correctly — `combineRollModes`
 * is the SRD's presence rule and is the only thing that decides an outcome.
 * What it never had was a way to *build* that list from state for a roll it
 * had not been told about in advance. Every source was a hard-coded reader
 * that knew one question: `standingSaveModes` could answer about a save and
 * nothing else, `attackedWithDisadvantage` about a weapon attack and nothing
 * else, and a spell that wanted either had nowhere to write itself down.
 *
 * So the tests below are in two halves, and the second is the one that matters.
 *
 * | | |
 * |---|---|
 * | The predicate | one selector, matched against one roll, with nothing else in the way |
 * | The table | a real spell, cast through the public API, changing the right roll and **not** the adjacent wrong one |
 *
 * An effect sitting in state proves nothing. Twice below, a modifier is in
 * state and the assertion is that some neighbouring roll came out `normal`.
 */

const id = (s: string) => asCharacterId(s);
const WIZARD = id('wizard');
const CLERIC = id('cleric');
const ALLY = id('ally');
const OGRE = id('ogre');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 12, con: 12, int: 16, wis: 14, cha: 10 },
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

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const slots = (who: CharacterId): readonly GameEvent[] =>
  [1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  );

const SETUP: readonly GameEvent[] = [
  added(WIZARD, 'party'),
  added(CLERIC, 'party', { spellcastingAbility: 'wis' }),
  added(ALLY, 'party'),
  added(OGRE, 'ogres'),
  ...slots(WIZARD),
  ...slots(CLERIC),
  { type: 'items-gained', id: OGRE, items: [{ id: 'greatclub', quantity: 1 }], source: 'kit' },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the hall', at: { x: 60, y: 60, z: 0 } },
  { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the hall' }, feet: 0 } },
  { type: 'creature-placed', id: CLERIC, placement: { from: { creature: WIZARD }, feet: 5, bearing: 180 } },
  { type: 'creature-placed', id: OGRE, placement: { from: { creature: WIZARD }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: OGRE }, feet: 5, bearing: 90 } },
  { type: 'sight-declared', from: WIZARD, to: OGRE, seen: true },
  { type: 'sight-declared', from: CLERIC, to: OGRE, seen: true },
  { type: 'sight-declared', from: CLERIC, to: WIZARD, seen: true },
  { type: 'sight-declared', from: CLERIC, to: ALLY, seen: true },
  { type: 'sight-declared', from: WIZARD, to: CLERIC, seen: true },
  { type: 'sight-declared', from: ALLY, to: OGRE, seen: true },
  {
    type: 'spellcasting-declared',
    id: WIZARD,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: ['fire-bolt'],
      prepared: ['blur'],
    }),
  },
  {
    type: 'spellcasting-declared',
    id: OGRE,
    spellcasting: declaredCasting({ ability: 'int', cantrips: ['fire-bolt'], prepared: [] }),
  },
  { type: 'sight-declared', from: OGRE, to: WIZARD, seen: true },
  {
    type: 'spellcasting-declared',
    id: CLERIC,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['sacred-flame'],
      prepared: ['beacon-of-hope', 'bane'],
    }),
  },
];

/**
 * The same table with Initiative rolled, for the one test that needs a turn
 * order: Dodge's benefit lasts "until the start of your next turn", which is a
 * deadline only a fight has. Everything else here is deliberately **out** of
 * combat, where there is no action economy to spend and a test can cast, swing
 * and check in whatever order it likes.
 */
const IN_COMBAT: readonly GameEvent[] = [
  ...SETUP,
  {
    type: 'combat-started',
    combatants: [
      { id: WIZARD, initiative: 20, speed: 30 },
      { id: OGRE, initiative: 10, speed: 30 },
    ],
  },
];

const base = (): GameState => fold('seed', SETUP);

/**
 * A generator that rolls exactly what it is told to.
 *
 * A seeded roll proves determinism and cannot prove *which* die was taken: two
 * dice from a seed are two unknown numbers. Scripting `[3, 18]` makes the mode
 * observable in the recorded natural — 3 under a normal roll, 18 under
 * Advantage — which is what turns "the modifier is in state" into "the modifier
 * changed the roll".
 */
const scripted = (values: readonly number[]): Rng => {
  let i = 0;
  return { int: () => values[i++ % values.length]!, snapshot: (): RngState => [0, 0, 0, 0] };
};
const supply = (seed = 'roll') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng, content: SRD_CONTENT });

/** Cast against a log and hand back the longer one, so casts can stack. */
const cast = (
  log: readonly GameEvent[],
  who: CharacterId,
  request: Parameters<typeof resolveSpell>[2],
  seed = 'cast',
): readonly GameEvent[] => [
  ...log,
  ...unwrap(resolveSpell(fold('seed', log), who, request, supply(seed)), 'cast').events,
];

/** Advance to whoever is next, settling anything the boundary owes. */
const nextTurn = (log: readonly GameEvent[]): readonly GameEvent[] => [
  ...log,
  ...unwrap(resolveTurn(fold('seed', log), supply('turn')), 'turn').events,
];

const swing = (log: readonly GameEvent[], target: CharacterId, seed = 'swing') =>
  unwrap(
    resolveAttack(fold('seed', log), OGRE, { target, weapon: 'greatclub' }, supply(seed)),
    'attack',
  );

/**
 * Roll one D20 Test through the command a DM reaches for, and hand back the
 * roll itself — `test` is null only for a replayed command id, which nothing
 * here sends.
 */
const test = (
  log: readonly GameEvent[],
  who: CharacterId,
  command: Parameters<typeof resolveTest>[2],
  seed = 'test',
): D20TestResult => {
  const out = unwrap(resolveTest(fold('seed', log), who, command, supply(seed)), 'test');
  if (out.test === null) throw new Error('the test was a replay, which no fixture here sends');
  return out.test;
};

// — the predicate, on its own —————————————————————————————————————————————————

describe('one predicate decides whether a source reaches a roll', () => {
  const attackAgainst: RollSelector = { roll: 'attack', relation: 'against-holder' };
  const attackBy: RollSelector = { roll: 'attack', relation: 'roller' };
  const wisSave: RollSelector = { roll: 'saving-throw', relation: 'roller', ability: 'wis' };
  const wisCheck: RollSelector = { roll: 'ability-check', relation: 'roller', ability: 'wis' };

  it('reads "the holder is rolling" as the holder rolling', () => {
    expect(selectorMatches(attackBy, OGRE, { family: 'attack', roller: OGRE, against: WIZARD })).toBe(true);
    expect(selectorMatches(attackBy, WIZARD, { family: 'attack', roller: OGRE, against: WIZARD })).toBe(false);
  });

  /**
   * The bit the engine did not have. Both of these are about the wizard and
   * they are not the same rule: one hampers the wizard's swings, the other
   * hampers everybody swinging at the wizard.
   */
  it('reads "against the holder" as somebody else rolling at them', () => {
    expect(selectorMatches(attackAgainst, WIZARD, { family: 'attack', roller: OGRE, against: WIZARD })).toBe(true);
    expect(selectorMatches(attackAgainst, OGRE, { family: 'attack', roller: OGRE, against: WIZARD })).toBe(false);
  });

  /** An attack nobody recorded a target for is a miss, not a guess. */
  it('matches nothing against the holder when the roll has no target', () => {
    expect(selectorMatches(attackAgainst, WIZARD, { family: 'attack', roller: OGRE })).toBe(false);
    expect(selectorMatches(attackAgainst, WIZARD, { family: 'attack', roller: OGRE, against: null })).toBe(false);
  });

  it('keeps an ability check and a saving throw of the same ability apart', () => {
    const query = { family: 'saving-throw', roller: WIZARD, ability: 'wis' } as const;
    expect(selectorMatches(wisSave, WIZARD, query)).toBe(true);
    expect(selectorMatches(wisCheck, WIZARD, query)).toBe(false);

    const check = { family: 'ability-check', roller: WIZARD, ability: 'wis' } as const;
    expect(selectorMatches(wisCheck, WIZARD, check)).toBe(true);
    expect(selectorMatches(wisSave, WIZARD, check)).toBe(false);
  });

  it('narrows by ability and by skill, and absent means the whole family', () => {
    const any: RollSelector = { roll: 'ability-check', relation: 'roller' };
    const athletics: RollSelector = { roll: 'ability-check', relation: 'roller', skill: 'athletics' };

    const strAthletics = { family: 'ability-check', roller: WIZARD, ability: 'str', skill: 'athletics' } as const;
    const bareStr = { family: 'ability-check', roller: WIZARD, ability: 'str' } as const;

    expect(selectorMatches(any, WIZARD, strAthletics)).toBe(true);
    expect(selectorMatches(any, WIZARD, bareStr)).toBe(true);
    expect(selectorMatches(athletics, WIZARD, strAthletics)).toBe(true);
    // A bare Strength check is not an Athletics check.
    expect(selectorMatches(athletics, WIZARD, bareStr)).toBe(false);
  });

  /**
   * SRD grants Advantage on "Initiative rolls", which is a smaller set than
   * "Dexterity checks" — Feral Instinct does not help a Barbarian pick a lock.
   * And a Death Saving Throw is "not tied to an ability score", so it is not a
   * saving throw an ability-keyed grant can reach.
   */
  it('keeps Initiative and a Death Saving Throw out of the families they resemble', () => {
    const dexCheck: RollSelector = { roll: 'ability-check', relation: 'roller', ability: 'dex' };
    const init: RollSelector = { roll: 'initiative', relation: 'roller' };
    expect(selectorMatches(dexCheck, WIZARD, { family: 'initiative', roller: WIZARD })).toBe(false);
    expect(selectorMatches(init, WIZARD, { family: 'ability-check', roller: WIZARD, ability: 'dex' })).toBe(false);

    const anySave: RollSelector = { roll: 'saving-throw', relation: 'roller' };
    expect(selectorMatches(anySave, WIZARD, { family: 'death-save', roller: WIZARD })).toBe(false);
  });
});

// — what the validator refuses ————————————————————————————————————————————————

describe('a selector that describes a roll nobody makes is refused', () => {
  const problems = (selector: RollSelector) =>
    rollSelectorProblems(selector, (skill) => SKILL_ABILITY[skill]).map((p) => p.code);

  it('refuses an ability on a roll that is not made with one', () => {
    expect(problems({ roll: 'attack', relation: 'roller', ability: 'str' })).toContain(
      'ability_on_ability_less_roll',
    );
    expect(problems({ roll: 'death-save', relation: 'roller', ability: 'con' })).toContain(
      'ability_on_ability_less_roll',
    );
    expect(problems({ roll: 'initiative', relation: 'roller', ability: 'dex' })).toContain(
      'ability_on_ability_less_roll',
    );
  });

  it('refuses a skill on a roll that uses none', () => {
    expect(problems({ roll: 'saving-throw', relation: 'roller', skill: 'athletics' })).toContain(
      'skill_off_ability_check',
    );
  });

  it('refuses a skill and an ability that disagree, and allows ones that agree', () => {
    expect(
      problems({ roll: 'ability-check', relation: 'roller', ability: 'cha', skill: 'athletics' }),
    ).toContain('skill_ability_mismatch');
    expect(
      problems({ roll: 'ability-check', relation: 'roller', ability: 'str', skill: 'athletics' }),
    ).toEqual([]);
  });

  /** The rule from `RollRelation`: only an attack has a second participant. */
  it('refuses "against the holder" on a roll with nobody on the other side', () => {
    for (const roll of ['ability-check', 'saving-throw', 'initiative', 'death-save'] as const) {
      expect(problems({ roll, relation: 'against-holder' })).toContain(
        'against_holder_without_target',
      );
    }
    expect(problems({ roll: 'attack', relation: 'against-holder' })).toEqual([]);
  });
});

/**
 * The same rules, reached the way an author reaches them: through a whole
 * definition rather than a bare selector.
 */
describe('the definition validator carries those rules to an author', () => {
  const homebrew = (effect: unknown): unknown => ({
    id: 'wardens-hunch',
    name: "Warden's Hunch",
    level: 1,
    school: 'divination',
    castingTime: 'action',
    concentration: true,
    range: { kind: 'touch' },
    targets: { count: 1, self: true },
    effects: [effect],
    durationSeconds: 60,
  });

  // Every problem rather than the first: `parseSpellDefinition` is the `Result`
  // half and stops at one, which is right for a caller that wants a definition
  // or a refusal and wrong for an author fixing several things at once.
  const codes = (effect: unknown): readonly string[] =>
    checkSpellDefinitionValue(homebrew(effect)).map((p) => p.code);

  it('refuses a mode with no roll category', () => {
    expect(
      codes({ kind: 'roll-mode', modifier: { mode: 'advantage', selector: { relation: 'roller' } } }),
    ).toContain('bad_roll_family');
  });

  it('refuses an ability-specific modifier on an attack roll', () => {
    expect(
      codes({
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: 'attack', relation: 'roller', ability: 'str' },
        },
      }),
    ).toContain('ability_on_ability_less_roll');
  });

  it('refuses "against the holder" on a saving throw', () => {
    expect(
      codes({
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: 'saving-throw', relation: 'against-holder' },
        },
      }),
    ).toContain('against_holder_without_target');
  });

  it('refuses a relation and a mode outside the vocabulary', () => {
    expect(
      codes({
        kind: 'roll-mode',
        modifier: { mode: 'normal', selector: { roll: 'attack', relation: 'whoever' } },
      }),
    ).toEqual(expect.arrayContaining(['bad_roll_mode', 'bad_roll_relation']));
  });

  /**
   * **The saving throw that used to sit on this kind is gone**, and the test
   * that checked its ability went with it.
   *
   * `roll-mode.save` had zero users in the catalogue from the day it was
   * written — Blur and Beacon of Hope are the only `roll-mode` effects and
   * neither spell asks anybody to resist — and the rider vocabulary made it
   * redundant rather than merely unused: a spell whose mode is imposed by a
   * failed save writes the save as its host and hangs the mode as a
   * `modifiers` rider, which is one roll shared rather than two spellings of
   * one sentence. What replaces this case is the rider's own validation,
   * beside the `buff` rules it shares, in `spell-schema.test.ts`.
   */
  it('has no saving throw of its own to get wrong', () => {
    expect(
      SPELL_DEFINITIONS.flatMap((definition) => definition.effects).filter(
        (effect) => effect.kind === 'roll-mode' && 'save' in effect,
      ),
    ).toEqual([]);
  });

  /**
   * The other half of the sentence, and the half that keeps "valid" from
   * coming to mean "official": a spell nobody printed is mechanically valid
   * data if it uses the primitive correctly.
   */
  it('accepts a custom spell nobody printed', () => {
    const parsed = parseSpellDefinition(
      homebrew({
        kind: 'roll-mode',
        modifier: {
          mode: 'advantage',
          selector: { roll: 'ability-check', relation: 'roller', ability: 'wis' },
        },
      }),
    );
    expect(parsed.ok).toBe(true);
    expect(checkSpellDefinition(unwrap(parsed, 'custom'))).toEqual([]);
    // And it is not in the book, which is the point of the claim.
    expect(SPELL_DEFINITIONS.some((d) => d.id === 'wardens-hunch')).toBe(false);
  });
});

// — a real spell, cast through the public API ————————————————————————————————

describe('Blur puts Disadvantage on attacks against the creature it is on', () => {
  const blurred = (log: readonly GameEvent[] = SETUP): readonly GameEvent[] =>
    cast(log, WIZARD, { spellId: 'blur', targets: [WIZARD], slotLevel: 2 });

  it('lands a durable modifier on the wizard and on nobody else', () => {
    const state = fold('seed', blurred());
    const held = state.creatures.wizard?.rollModifiers ?? [];
    expect(held).toHaveLength(1);
    expect(held[0]?.modifier.mode).toBe('disadvantage');
    expect(held[0]?.modifier.selector).toEqual({ roll: 'attack', relation: 'against-holder' });
    expect(held[0]?.source).toMatch(/^Blur#cast:\d+$/);

    expect(state.creatures.ally?.rollModifiers).toEqual([]);
    expect(state.creatures.ogre?.rollModifiers).toEqual([]);
  });

  /**
   * The whole point, and the reason an assertion about state would not do:
   * the die actually changes. Two d20s rolled, and the mode says why.
   */
  it('changes the attacker’s roll, and rolls two dice to do it', () => {
    expect(swing(SETUP, WIZARD).attack!.mode).toBe('normal');
    expect(swing(SETUP, WIZARD).attack!.roll.rolls).toHaveLength(1);

    const hampered = swing(blurred(), WIZARD).attack!;
    expect(hampered.mode).toBe('disadvantage');
    expect(hampered.roll.rolls).toHaveLength(2);
  });

  /**
   * **The adjacent wrong roll.** `against-holder` is not `roller`, so the
   * blurred wizard's own rolls are untouched — and neither is anybody else's
   * attack on a different creature.
   */
  it('does not touch the wizard’s own rolls, nor an attack on somebody else', () => {
    const log = blurred();
    expect(swing(log, ALLY).attack!.mode).toBe('normal');
    expect(
      test(log, WIZARD, { kind: 'saving-throw', ability: 'dex', dc: 12 }).mode,
    ).toBe('normal');
    expect(
      test(log, WIZARD, { kind: 'ability-check', ability: 'dex', dc: 12 }).mode,
    ).toBe('normal');
  });

  /**
   * SRD Dodge: "any attack roll made against you". It never said "with a
   * weapon" — and before one gatherer read both ends of every attack, the
   * spell-attack path never asked the defender anything at all.
   */
  it('reaches a spell attack, which the weapon path used to reach alone', () => {
    const bolt = (log: readonly GameEvent[]) =>
      unwrap(
        resolveSpell(
          fold('seed', log),
          OGRE,
          { spellId: 'fire-bolt', targets: [WIZARD] },
          supply('bolt'),
        ),
        'bolt',
      ).outcomes.find((o) => o.target === WIZARD)?.attack;

    expect(bolt(SETUP)?.mode).toBe('normal');
    expect(bolt(SETUP)?.roll.rolls).toHaveLength(1);

    const hampered = bolt(blurred());
    expect(hampered?.mode).toBe('disadvantage');
    expect(hampered?.roll.rolls).toHaveLength(2);

    // And the weapon path answers the same, which is the point of one gatherer.
    expect(swing(blurred(), WIZARD).attack!.mode).toBe('disadvantage');
  });

  /**
   * A saving throw a spell forces is a different family, so Blur says nothing
   * about it — the filter doing its job on a real casting rather than in the
   * predicate's own unit test.
   */
  it('says nothing about a saving throw a spell forces', () => {
    const shot = unwrap(
      resolveSpell(
        fold('seed', blurred()),
        CLERIC,
        { spellId: 'sacred-flame', targets: [WIZARD] },
        supply('flame'),
      ),
      'flame',
    );
    expect(shot.outcomes[0]?.save?.mode).toBe('normal');
  });
});

describe('Beacon of Hope grants Advantage on the saves it names and no others', () => {
  const hopeful = (targets: readonly CharacterId[] = [ALLY]): readonly GameEvent[] =>
    cast(SETUP, CLERIC, { spellId: 'beacon-of-hope', targets: [...targets], slotLevel: 3 }, 'hope');

  it('lands both of its modifiers on every target', () => {
    const state = fold('seed', hopeful([ALLY, WIZARD]));
    for (const who of ['ally', 'wizard'] as const) {
      const held = state.creatures[who]?.rollModifiers ?? [];
      expect(held.map((h) => h.modifier.selector.roll).sort()).toEqual([
        'death-save',
        'saving-throw',
      ]);
      expect(held.every((h) => h.modifier.mode === 'advantage')).toBe(true);
    }
    expect(state.creatures.ogre?.rollModifiers).toEqual([]);
  });

  it('reaches a Wisdom saving throw the engine rolls', () => {
    const plain = test(SETUP, ALLY, { kind: 'saving-throw', ability: 'wis', dc: 12 });
    expect(plain.mode).toBe('normal');

    const helped = test(hopeful(), ALLY, { kind: 'saving-throw', ability: 'wis', dc: 12 });
    expect(helped.mode).toBe('advantage');
    expect(helped.rolls).toHaveLength(2);
    expect(helped.modeSources).toContainEqual(
      expect.objectContaining({ mode: 'advantage' }),
    );
  });

  /**
   * **A Wisdom check is not a Wisdom save.** The ability filter and the family
   * filter are two different narrowings and both have to hold; this is the one
   * that a single shared code path in `checks.ts` would have leaked.
   */
  it('does not reach a Wisdom ability check, nor a save of another ability', () => {
    const log = hopeful();
    expect(test(log, ALLY, { kind: 'ability-check', ability: 'wis', dc: 12 }).mode).toBe('normal');
    expect(test(log, ALLY, { kind: 'saving-throw', ability: 'dex', dc: 12 }).mode).toBe('normal');
    expect(test(log, ALLY, { kind: 'saving-throw', ability: 'con', dc: 12 }).mode).toBe('normal');
  });

  /** `roller`, not `against-holder`: it helps its target and hampers nobody. */
  it('says nothing about an attack against its target', () => {
    expect(swing(hopeful(), ALLY).attack!.mode).toBe('normal');
  });

  /**
   * SRD writes "Wisdom saving throws **and Death Saving Throws**" in one
   * breath because they are two different rolls — a death save is tied to no
   * ability, so one ability-keyed grant could never have covered both.
   */
  it('reaches a Death Saving Throw, which no ability-keyed grant could', () => {
    /** Drop the ally, start a fight, and advance to the turn that owes the save. */
    const dying = (log: readonly GameEvent[]): readonly GameEvent[] => [
      ...log,
      { type: 'damage-taken', id: ALLY, amount: 60, source: 'the ogre' },
      { type: 'condition-applied', id: ALLY, condition: 'unconscious', source: '0 hit points' },
      {
        type: 'combat-started',
        combatants: [
          { id: OGRE, initiative: 20, speed: 30 },
          { id: ALLY, initiative: 10, speed: 30 },
        ],
      },
    ];

    // The generator offers a 3 and then an 18. A normal roll takes the 3 and
    // fails; Advantage takes the 18 and succeeds — so the recorded die says
    // which mode the save was made under, which no amount of reading state can.
    const save = (log: readonly GameEvent[]) => {
      const out = unwrap(
        resolveTurn(fold('seed', dying(log)), {
          issuer: createRollIssuer('r'),
          rng: scripted([3, 18]),
          content: SRD_CONTENT,
        }),
        'turn',
      );
      return out.events.find((e) => e.type === 'death-save-recorded');
    };

    expect(save(SETUP)?.natural).toBe(3);
    expect(save(hopeful())?.natural).toBe(18);
  });
});

// — composition, which is the rule that must stay in one place ————————————————

/**
 * The SRD's presence rule, reached through a granted mode.
 *
 * `combineRollModes` has settled this correctly since the day it was written
 * and nothing here changes it — which is the claim being tested. A standing
 * modifier joins the same list a condition and a caller's situational mode
 * join, and one function decides the answer for all three. If a granted mode
 * had brought its own arithmetic, this is where it would show.
 */
describe('modes compose by the SRD’s presence rule, however many sources there are', () => {
  const blurred = (): readonly GameEvent[] =>
    cast(SETUP, WIZARD, { spellId: 'blur', targets: [WIZARD], slotLevel: 2 });

  const hopeful = (): readonly GameEvent[] =>
    cast(SETUP, CLERIC, { spellId: 'beacon-of-hope', targets: [ALLY], slotLevel: 3 }, 'hope');

  /**
   * Two Advantages is one Advantage: two dice, not three, and both sources
   * named — a granted one and a situational one the caller supplied, which is
   * the composition across subsystems that had to keep working.
   */
  it('takes a granted Advantage and a situational one as Advantage', () => {
    const both = test(hopeful(), ALLY, {
      kind: 'saving-throw',
      ability: 'wis',
      dc: 12,
      modes: [{ source: 'higher ground', mode: 'advantage' }],
    });
    expect(both.mode).toBe('advantage');
    expect(both.rolls).toHaveLength(2);
    expect(both.modeSources.filter((m: ModeSource) => m.mode === 'advantage').length).toBeGreaterThanOrEqual(2);
  });

  /**
   * And the same for a bonus, which was dropped in the same place.
   *
   * `TestCommand` declares `modes` and `bonuses`; the ability-check branch
   * honoured both and the saving-throw branch handed `savingSupport` the
   * *operation's* supply and nothing else. A DM imposing a penalty on one save
   * was silently ignored — invisible, because the roll still happened and
   * still looked reasonable.
   */
  it('lets a caller’s bonus reach a saving throw, which it used to not', () => {
    const plain = test(SETUP, ALLY, { kind: 'saving-throw', ability: 'wis', dc: 12 });
    const helped = test(SETUP, ALLY, {
      kind: 'saving-throw',
      ability: 'wis',
      dc: 12,
      bonuses: [{ source: 'a sacred site', flat: 5 }],
    });
    expect(helped.total).toBe(plain.total + 5);
    expect(helped.bonuses.map((b) => b.source)).not.toContain('a sacred site');
    expect(helped.modifier).toBe(plain.modifier + 5);
  });

  /**
   * Two Disadvantages is one Disadvantage — here a granted one on the target
   * and a condition on the attacker, which are read by two different readers
   * and settled by one rule.
   */
  it('takes a granted Disadvantage and a condition as Disadvantage, and names both', () => {
    const poisoned: readonly GameEvent[] = [
      ...blurred(),
      { type: 'condition-applied', id: OGRE, condition: 'poisoned', source: 'a draught' },
    ];
    const hampered = swing(poisoned, WIZARD).attack!;
    expect(hampered.mode).toBe('disadvantage');
    expect(hampered.roll.rolls).toHaveLength(2);
  });

  /**
   * SRD: "Advantage and Disadvantage on the same roll cancel each other." One
   * of each is a normal roll — **one** die, which is the observable half.
   */
  it('cancels one Advantage against one Disadvantage', () => {
    const blurredAndBlinded: readonly GameEvent[] = [
      ...blurred(),
      // SRD Blinded: attack rolls against the blinded creature have Advantage.
      { type: 'condition-applied', id: WIZARD, condition: 'blinded', source: 'a flash' },
    ];
    const roll = swing(blurredAndBlinded, WIZARD).attack!;
    expect(roll.mode).toBe('normal');
    expect(roll.roll.rolls).toHaveLength(1);
  });

  /**
   * **Presence, not arithmetic.** Two sources of Advantage against one of
   * Disadvantage is a normal roll, not Advantage — counting sources and taking
   * the difference is the classic way to get this wrong, and it silently
   * favours whoever has more effects running.
   */
  it('still comes out normal with two Advantages against one Disadvantage', () => {
    const many: readonly GameEvent[] = [
      ...blurred(),
      { type: 'condition-applied', id: WIZARD, condition: 'blinded', source: 'a flash' },
      { type: 'condition-applied', id: WIZARD, condition: 'restrained', source: 'a net' },
    ];
    const roll = swing(many, WIZARD).attack!;
    // Both advantages are really in play, and there is exactly one disadvantage.
    const sources = roll.roll;
    expect(sources.rolls).toHaveLength(1);
    expect(roll.mode).toBe('normal');

    const gathered = rollModesFor(fold('seed', many), {
      family: 'attack',
      roller: OGRE,
      against: WIZARD,
    }).modes;
    expect(gathered.filter((m) => m.mode === 'disadvantage')).toHaveLength(1);
  });

  /** And three Disadvantages against one Advantage is still just normal. */
  it('comes out normal with one Advantage against two Disadvantages', () => {
    const many: readonly GameEvent[] = [
      ...blurred(),
      { type: 'condition-applied', id: OGRE, condition: 'poisoned', source: 'a draught' },
      { type: 'condition-applied', id: WIZARD, condition: 'blinded', source: 'a flash' },
    ];
    const roll = swing(many, WIZARD).attack!;
    expect(roll.mode).toBe('normal');
    expect(roll.roll.rolls).toHaveLength(1);
  });
});

// — lifetime ——————————————————————————————————————————————————————————————————

/**
 * **One door, and it already existed.**
 *
 * A durable modifier carries its casting in its `source`, which is the same
 * link a condition, a bonus and a granted Armour Class already use — so every
 * way a spell can end reaches it through `releaseCasting` and
 * `releaseOnTarget` rather than through a lifecycle of its own. A second
 * lifecycle is how a mode ends up outliving the spell that granted it.
 */
describe('a granted mode lasts exactly as long as the effect that granted it', () => {
  const blurred = (): readonly GameEvent[] =>
    cast(SETUP, WIZARD, { spellId: 'blur', targets: [WIZARD], slotLevel: 2 });

  it('goes when the caster stops concentrating', () => {
    const log = blurred();
    expect(fold('seed', log).creatures.wizard?.rollModifiers).toHaveLength(1);

    const ended = [...log, ...unwrap(endConcentration(fold('seed', log), WIZARD, 'voluntary'), 'end')];
    expect(fold('seed', ended).creatures.wizard?.rollModifiers).toEqual([]);
    expect(swing(ended, WIZARD).attack!.mode).toBe('normal');
  });

  /**
   * SRD Concentration: "Your Concentration ends if you have the Incapacitated
   * condition or you die." Derived, so nothing has to remember it — and the
   * modifier goes with the casting through the door that already existed.
   */
  it('goes when the Concentration breaks without anybody ending it', () => {
    const stunned: readonly GameEvent[] = [
      ...blurred(),
      { type: 'condition-applied', id: WIZARD, condition: 'stunned', source: 'a Stunning Strike' },
    ];
    expect(fold('seed', stunned).creatures.wizard?.concentration).toBeNull();
    expect(fold('seed', stunned).creatures.wizard?.rollModifiers).toEqual([]);
    expect(swing(stunned, WIZARD).attack!.mode).toBe('advantage'); // Stunned, not Blurred.
  });

  /** And when the minute simply runs out. */
  it('goes when the spell’s own deadline arrives', () => {
    const later: readonly GameEvent[] = [
      ...blurred(),
      { type: 'time-advanced', seconds: 61, reason: 'the party regroups' },
    ];
    expect(fold('seed', later).creatures.wizard?.rollModifiers).toEqual([]);
    expect(fold('seed', later).ongoing).toEqual({});
    expect(swing(later, WIZARD).attack!.mode).toBe('normal');
  });

  /** And when the caster leaves the game, taking their casting with them. */
  it('goes when the caster leaves', () => {
    const hopeful = cast(SETUP, CLERIC, { spellId: 'beacon-of-hope', targets: [ALLY], slotLevel: 3 }, 'hope');
    expect(fold('seed', hopeful).creatures.ally?.rollModifiers).toHaveLength(2);

    const gone: readonly GameEvent[] = [...hopeful, { type: 'creature-removed', id: CLERIC }];
    expect(fold('seed', gone).creatures.ally?.rollModifiers).toEqual([]);
  });

  /**
   * Dodge's benefit ends at the start of its own next turn, as it always did.
   *
   * Dodge was `against-holder` before there was a word for it, so this is the
   * regression that says the unification changed nothing about it: same
   * clause, same deadline, same answer.
   */
  it('is unchanged for the action that already worked this way', () => {
    const dodged = nextTurn([
      ...IN_COMBAT,
      ...unwrap(takeDodge(fold('seed', IN_COMBAT), WIZARD, {}), 'dodge'),
    ]);
    expect(swing(dodged, WIZARD).attack!.mode).toBe('disadvantage');
    // Round the order to the wizard's own next turn, where the benefit lapses,
    // and on to the ogre's again.
    expect(swing(nextTurn(nextTurn(dodged)), WIZARD).attack!.mode).toBe('normal');
  });
});

// — the log is the state ——————————————————————————————————————————————————————

describe('the modifier is event-sourced like everything else', () => {
  const blurred = (): readonly GameEvent[] =>
    cast(SETUP, WIZARD, { spellId: 'blur', targets: [WIZARD], slotLevel: 2 });

  it('writes an event the fold rebuilds the state from', () => {
    const events = blurred().slice(SETUP.length);
    const granted = events.filter((e) => e.type === 'roll-modifier-granted');
    expect(granted).toHaveLength(1);

    // Through the shape a database would store and hand back.
    const stored = JSON.parse(JSON.stringify(blurred())) as GameEvent[];
    expect(fold('seed', stored).creatures.wizard?.rollModifiers).toHaveLength(1);
  });

  /**
   * The same log folds to the same state, and a **different seed** folds it
   * identically — a replay applies recorded outcomes and never rolls again, so
   * the generator's own seed is the one field that may differ.
   */
  it('replays byte for byte, whatever the seed', () => {
    const log = blurred();
    // Everything but the generator's own seed, which a replay never reads:
    // events carry resolved outcomes, so folding applies numbers rather than
    // rolling them.
    const without = (state: GameState): string =>
      JSON.stringify(Object.fromEntries(Object.entries(state).filter(([k]) => k !== 'seed')));
    expect(without(fold('other-seed', log))).toBe(without(fold('seed', log)));
    expect(without(fold('seed', [...log]))).toBe(without(fold('seed', log)));
  });

  /** And the roll it produces is the same roll, from the same seed. */
  it('produces the same roll from the same seed', () => {
    const log = blurred();
    const once = swing(log, WIZARD, 'fixed').attack!;
    const twice = swing(log, WIZARD, 'fixed').attack!;
    expect(once.roll.rolls).toEqual(twice.roll.rolls);
    expect(once.total).toBe(twice.total);
  });

  /** Re-granting from the same source replaces rather than stacks. */
  it('does not stack a second grant from the same casting', () => {
    const log = blurred();
    const source = fold('seed', log).creatures.wizard!.rollModifiers[0]!.source;
    const again: readonly GameEvent[] = [
      ...log,
      {
        type: 'roll-modifier-granted',
        id: WIZARD,
        modifier: {
          source,
          modifier: { mode: 'disadvantage', selector: { roll: 'attack', relation: 'against-holder' } },
        },
      },
    ];
    expect(fold('seed', again).creatures.wizard?.rollModifiers).toHaveLength(1);
  });
});

// — the claims this pass makes about itself ——————————————————————————————————

describe('the mechanic is the mechanic, not the spells that use it', () => {
  /**
   * No spell-name special case anywhere in the runtime — the claim
   * `spell-catalogue.test.ts` already makes about the engine as a whole,
   * narrowed to the two spells this batch added so it cannot be weakened by
   * them.
   */
  it('names no spell in the code that resolves a mode', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const here = fileURLToPath(new URL('.', import.meta.url));
    for (const file of ['roll-modifiers.ts', 'standing.ts', 'checks.ts', 'attack.ts']) {
      const source = readFileSync(`${here}${file}`, 'utf8')
        // Docstrings name spells constantly and should: what must not happen
        // is a *branch* on one.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const spell of ['Blur', 'blur', 'Beacon of Hope', 'beacon-of-hope']) {
        expect(source, `${file} branches on ${spell}`).not.toContain(spell);
      }
    }
  });

  /** Both definitions are ordinary data that the validator accepts. */
  it('adds two definitions the schema validates like any other', () => {
    for (const id of ['blur', 'beacon-of-hope']) {
      const definition = SPELL_DEFINITIONS.find((d) => d.id === id) as SpellDefinition;
      expect(definition, id).toBeDefined();
      expect(checkSpellDefinition(definition)).toEqual([]);
    }
  });

  /**
   * And nothing reaches a roll unless it is in state. A creature nobody has
   * cast anything on carries nothing, so an empty answer is the default rather
   * than a thing to remember.
   */
  it('gives an untouched creature nothing', () => {
    for (const family of ['attack', 'ability-check', 'saving-throw', 'initiative', 'death-save'] as const) {
      expect(grantedRollModes(base(), { family, roller: OGRE, against: WIZARD })).toEqual([]);
    }
  });

  /**
   * A refused casting grants nothing — the validate-before-rolling rule, which
   * a durable grant makes newly worth stating: a modifier that reached state
   * ahead of the refusal would be one nothing could take away again, because
   * there would be no casting for `releaseCasting` to end.
   */
  it('grants nothing when the casting is refused', () => {
    // A caster who has not prepared it and knows it from nothing else.
    const unprepared = resolveSpell(base(), CLERIC, { spellId: 'blur', targets: [CLERIC], slotLevel: 2 }, supply());
    expect(isErr(unprepared)).toBe(true);
    expect(base().creatures.cleric?.rollModifiers).toEqual([]);

    // And one with no spell slots at all.
    const mundane = resolveSpell(base(), OGRE, { spellId: 'blur', targets: [OGRE], slotLevel: 2 }, supply());
    expect(isErr(mundane)).toBe(true);
    expect(base().creatures.ogre?.rollModifiers).toEqual([]);
  });
});
