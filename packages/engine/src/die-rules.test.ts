import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { loadContent, type Content } from './content.js';
import { resolveSpell } from './commands.js';
import { type Rng, type RngState } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { checkSpellDefinitionValue } from './spell-schema.js';
import { declaredCasting } from './spellcasting.js';

/**
 * **A die rule is vocabulary, not a spell the engine has heard of.**
 *
 * `dice.ts` has had per-die effects since it was written and nothing in any
 * catalogue could ask for one: `treatLowRollsAs`, `explodeOnMax` and
 * `rerollDice` were built, tested and reached by no definition, which is a
 * pure function nothing calls standing in for a rule nothing enforces.
 * `SpellDefinition.dieRule` is the door, and this file is `content.test.ts`'s
 * argument applied to it — a spell nobody printed, loaded from JSON text
 * through the public call, exploding its dice with no engine change at all.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const KEEN = id('keen');
const DULL = id('dull');
const TARGET = id('target');

/**
 * A generator scripted **by die size**, because a casting throws a d20 for the
 * attack and then d6s for the damage, and a flat list of faces makes the
 * assertion depend on the order two unrelated rolls happen to come in.
 */
const scripted = (faces: Readonly<Record<number, readonly number[]>>): Rng => {
  const queues = new Map<number, number[]>(
    Object.entries(faces).map(([sides, values]) => [Number(sides), [...values]]),
  );
  return {
    int: (sides: number): number => {
      const queue = queues.get(sides);
      if (queue === undefined || queue.length === 0) {
        throw new Error(`the script has no d${sides} left to throw`);
      }
      return queue.shift()!;
    },
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const sheet = (int: number): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId, int: number): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(int),
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/**
 * A homebrew spell whose dice explode, written as the JSON a DM's file holds.
 *
 * Deliberately not Sorcerous Burst in a false moustache: a d6 rather than a
 * d8, two dice rather than one, and a level 1 slot rather than a cantrip. If
 * any of the wiring branched on a spell id, none of this would roll.
 */
const EMBER_CASCADE = JSON.stringify({
  id: 'ember-cascade',
  name: 'Ember Cascade',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  dieRule: { kind: 'bonus-die-on-max', cap: 'spellcasting-modifier' },
  effects: [
    {
      kind: 'attack',
      attack: 'ranged',
      damage: { dice: '1d6' },
      damageType: 'fire',
    },
  ],
});

const table = (content: Content): readonly GameEvent[] => [
  added(KEEN, 18),
  added(DULL, 12),
  added(TARGET, 10),
  ...[KEEN, DULL].map(
    (who): GameEvent => ({
      type: 'resource-pool-declared',
      id: who,
      pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 4, recovers: 'long-rest' },
    }),
  ),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: KEEN, placement: { from: { landmark: 'here' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: DULL,
    placement: { from: { landmark: 'here' }, feet: 5, bearing: 180 },
  },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: KEEN }, feet: 30, bearing: 0 },
  },
  { type: 'sight-declared', from: KEEN, to: TARGET, seen: true },
  { type: 'sight-declared', from: DULL, to: TARGET, seen: true },
  ...[KEEN, DULL].map(
    (who): GameEvent => ({
      type: 'spellcasting-declared',
      id: who,
      spellcasting: declaredCasting({
        ability: 'int',
        cantrips: [],
        prepared: content.spells.map((spell) => spell.id),
      }),
    }),
  ),
];

const homebrew = unwrap(loadContent({ spells: [JSON.parse(EMBER_CASCADE)] }), 'load');

/** Cast Ember Cascade at the dummy on a scripted generator, and report the damage. */
const cast = (who: CharacterId, faces: Readonly<Record<number, readonly number[]>>): number => {
  const log = table(homebrew);
  const state = fold('seed', log);
  const result = unwrap(
    resolveSpell(
      state,
      who,
      { spellId: 'ember-cascade', targets: [TARGET], slotLevel: 1 },
      { issuer: createRollIssuer('r'), rng: scripted(faces), content: homebrew },
    ),
    'cast',
  );
  return result.outcomes.find((one) => one.target === TARGET)?.damage ?? -1;
};

describe('a spell declares how its own dice behave', () => {
  it('is loaded from JSON and validated beside the book', () => {
    expect(checkSpellDefinitionValue(JSON.parse(EMBER_CASCADE))).toEqual([]);
    expect(homebrew.spell('ember-cascade')?.dieRule).toEqual({
      kind: 'bonus-die-on-max',
      cap: 'spellcasting-modifier',
    });
  });

  /**
   * SRD Sorcerous Burst's sentence, in a homebrew spell's words: a die showing
   * its maximum adds another, and the added die can do it again.
   */
  it('adds another die when one shows its maximum, up to the cap', () => {
    // Intelligence 18 is a +4 modifier, so four bonus dice and no more: the
    // fifth 6 in the script is thrown by nothing.
    expect(cast(KEEN, { 20: [15, 15], 6: [6, 6, 6, 6, 6, 6] })).toBe(5 * 6);
  });

  /** And a roll with no maximum on it adds nothing at all. */
  it('adds nothing when no die shows its maximum', () => {
    expect(cast(KEEN, { 20: [15, 15], 6: [3] })).toBe(3);
  });

  /**
   * **The cap is the caster's, and the engine is what derives it.**
   *
   * The declaration names a derivation — `spellcasting-modifier` — rather than
   * a number, because "the maximum number of these d8s you can add equals your
   * spellcasting ability modifier" is a fact about whoever is casting. Two
   * casters, one spell, one script, two answers.
   */
  it('caps the bonus dice at the casting creature’s own modifier', () => {
    const script = { 20: [15, 15], 6: [6, 6, 6, 6, 6, 6] } as const;
    // +4: one initial die and four more.
    expect(cast(KEEN, script)).toBe(5 * 6);
    // +1: one initial die and one more, off the same script.
    expect(cast(DULL, script)).toBe(2 * 6);
  });
});

describe('the validator judges a die rule like every other member', () => {
  const withRule = (rule: unknown): unknown => ({
    ...JSON.parse(EMBER_CASCADE),
    dieRule: rule,
  });

  it('refuses a rule of a kind the engine has no behaviour for', () => {
    expect(
      checkSpellDefinitionValue(withRule({ kind: 'reroll-everything', cap: 'spellcasting-modifier' })).map(
        (p) => p.code,
      ),
    ).toContain('unknown_die_rule');
  });

  it('refuses a cap the engine cannot derive', () => {
    expect(
      checkSpellDefinitionValue(withRule({ kind: 'bonus-die-on-max', cap: 3 })).map((p) => p.code),
    ).toContain('unknown_die_rule_cap');
  });

  /**
   * A rule about a spell's damage dice on a spell that rolls none is a line in
   * the book that quietly does nothing — the failure every other reachability
   * rule in this validator exists to prevent.
   */
  it('refuses a rule on a spell that rolls no damage', () => {
    const tracked = {
      ...JSON.parse(EMBER_CASCADE),
      effects: [],
    };
    expect(checkSpellDefinitionValue(tracked).map((p) => p.code)).toContain('die_rule_rolls_nothing');
  });

  /**
   * **The cap is per casting, and the engine spends it per damage roll.**
   *
   * SRD caps "the maximum number of these d8s you can add to **the spell's
   * damage**", which is one budget for the whole casting. `roll()` keys its own
   * per-effect counter to the call it is in, so a casting that rolls its damage
   * more than once — several targets, an area, a payload printed in two damage
   * types — would be allowed the cap once per roll and deal more than the book
   * permits. Refused at the door rather than answered wrongly: the shapes that
   * roll twice are named, and the day the budget is carried across them this
   * rule is what has to be deleted for them to be admitted.
   */
  it('refuses a rule on a spell that rolls its damage more than once', () => {
    const several = { ...JSON.parse(EMBER_CASCADE), targets: { count: 3 } };
    expect(checkSpellDefinitionValue(several).map((p) => p.code)).toContain(
      'die_rule_rolls_more_than_once',
    );

    const twoTypes = {
      ...JSON.parse(EMBER_CASCADE),
      effects: [
        {
          kind: 'save-damage',
          ability: 'dex',
          damage: { dice: '2d6' },
          damageType: 'fire',
          onSuccess: 'half',
          plus: [{ damage: { dice: '1d6' }, damageType: 'cold' }],
        },
      ],
    };
    expect(checkSpellDefinitionValue(twoTypes).map((p) => p.code)).toContain(
      'die_rule_rolls_more_than_once',
    );

    const spread = {
      ...JSON.parse(EMBER_CASCADE),
      area: { kind: 'sphere', radiusFeet: 20, origin: 'point' },
    };
    expect(checkSpellDefinitionValue(spread).map((p) => p.code)).toContain(
      'die_rule_rolls_more_than_once',
    );
  });

  it('is content with the rule on a spell whose save deals damage', () => {
    const saving = {
      ...JSON.parse(EMBER_CASCADE),
      effects: [
        {
          kind: 'save-damage',
          ability: 'dex',
          damage: { dice: '2d6' },
          damageType: 'fire',
          onSuccess: 'half',
        },
      ],
    };
    expect(checkSpellDefinitionValue(saving)).toEqual([]);
  });
});

describe('a die rule reaches the spell’s own dice and no rider’s', () => {
  /**
   * SRD Sorcerous Burst says "for **this spell**", and a casting's damage roll
   * is not all one spell's: SRD Hunter's Mark hangs a d6 on the caster that
   * rides along with every attack they make, and that die is the Ranger's
   * rather than this casting's. So the rule is declared on the component the
   * spell's own notation rolls, and a rider in the same roll is untouched.
   */
  it('leaves a rider hung by another casting alone', () => {
    const log = [
      ...table(homebrew),
      {
        type: 'attack-rider-granted',
        id: KEEN,
        rider: { source: 'Hunter’s Mark#cast:9', dice: '1d6', damageType: 'force' },
      } satisfies GameEvent,
    ];
    const state = fold('seed', log);
    const result = unwrap(
      resolveSpell(
        state,
        KEEN,
        { spellId: 'ember-cascade', targets: [TARGET], slotLevel: 1 },
        {
          issuer: createRollIssuer('r'),
          // The spell's own d6 shows 3 and adds nothing; the rider's d6 shows
          // its maximum and must add nothing either, because the rule is not
          // about the rider's die.
          rng: scripted({ 20: [15, 15], 6: [3, 6] }),
          content: homebrew,
        },
      ),
      'cast',
    );
    expect(result.outcomes.find((one) => one.target === TARGET)?.damage).toBe(3 + 6);
  });
});
