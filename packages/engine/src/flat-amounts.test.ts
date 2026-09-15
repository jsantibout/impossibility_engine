import { describe, expect, it } from 'vitest';
import {
  asCharacterId,
  expect as unwrap,
  type CharacterId,
} from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { itemSource } from './catalogue.js';
import { loadContent, type Content } from './content.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent } from './events.js';
import { createRollIssuer } from './rolls.js';
import { spellSlotKey } from './resources.js';
import { scaledDiceFor, scaledFlatFor } from './spell-definitions.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell, useItem } from './commands.js';

/**
 * **An amount with no dice in it.**
 *
 * `DiceScaling.dice` was a required string and `parseNotation` refuses a
 * notation that rolls nothing, so a printed number — SRD Potion of Heroism's
 * "you gain 10 Temporary Hit Points" — could not be written anywhere an
 * amount was expected. The notation is optional now, and this file holds the
 * two halves of what that has to mean:
 *
 * 1. the number lands, whole and exactly, wherever an amount is read;
 * 2. **nothing is thrown for it.** An amount that rolls nothing must not move
 *    the generator, because a stray `rolls-issued` of zero would be invisible
 *    until a frozen fixture moved a year later.
 *
 * The refusals belong to the validator and are in `spell-schema.test.ts`: an
 * amount that is neither dice nor a number, and the two scaling fields that
 * add dice to a notation there is none of.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const CASTER = id('caster');
const TARGET = id('target');

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 100,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

// — the helpers themselves ——————————————————————————————————————————————————

describe('the two halves of a scaled amount, when one half is absent', () => {
  it('scales no dice at all, rather than an invented zero-die notation', () => {
    expect(scaledDiceFor({ flat: 10 }, 1, 5, 1)).toBeUndefined();
    expect(scaledDiceFor({ flat: 10 }, 0, 11, 0)).toBeUndefined();
  });

  it('still reads the flat half, and still grows it with the slot', () => {
    expect(scaledFlatFor({ flat: 10 }, 1, 1)).toBe(10);
    expect(scaledFlatFor({ flat: 10, flatPerSlotLevelAbove: 5 }, 1, 3)).toBe(20);
  });

  /** And the dice half is untouched where there is one. */
  it('scales the dice it does have exactly as it always did', () => {
    expect(scaledDiceFor({ dice: '2d6', perSlotLevelAbove: '1d6' }, 1, 5, 3)).toBe('4d6');
  });
});

// — a spell whose damage is a printed number ————————————————————————————————

/**
 * A homebrew spell that deals a flat seven and rolls nothing for it. No SRD
 * spell is written this way — the book prints its numbers beside dice — but
 * the item text this change was made for is full of them, and a spell is the
 * one host where the attack path can be reached.
 */
const CINDER_MARK = JSON.stringify({
  id: 'cinder-mark',
  name: 'Cinder Mark',
  level: 1,
  school: 'evocation',
  castingTime: 'action',
  concentration: false,
  range: { kind: 'ranged', feet: 60 },
  targets: { count: 1 },
  effects: [{ kind: 'attack', attack: 'ranged', damage: { flat: 7 }, damageType: 'fire' }],
});

const table = (content: Content): readonly GameEvent[] => [
  added(CASTER),
  added(TARGET),
  {
    type: 'resource-pool-declared',
    id: CASTER,
    pool: { key: spellSlotKey(1), label: 'level 1 spell slot', max: 2, recovers: 'long-rest' },
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'here', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: CASTER, placement: { from: { landmark: 'here' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: CASTER }, feet: 30, bearing: 0 },
  },
  { type: 'sight-declared', from: CASTER, to: TARGET, seen: true },
  {
    type: 'spellcasting-declared',
    id: CASTER,
    spellcasting: declaredCasting({
      ability: 'int',
      cantrips: [],
      prepared: content.spells.map((spell) => spell.id),
    }),
  },
];

describe('a spell attack whose damage is a printed number', () => {
  const content = unwrap(loadContent({ spells: [JSON.parse(CINDER_MARK)] }), 'load');
  const log = table(content);

  /** Forced to hit, so the assertion is about the amount and not the die. */
  const cast = () => {
    const issuer = createRollIssuer('r');
    const out = unwrap(
      resolveSpell(
        fold('seed', log),
        CASTER,
        { spellId: 'cinder-mark', targets: [TARGET], slotLevel: 1 },
        {
          issuer,
          rng: createRng('cinder') as Rng,
          content,
          bonuses: [{ source: 'the test insists', flat: 40 }],
        },
      ),
      'cast',
    );
    return { out, issuer };
  };

  it('deals exactly the number it prints', () => {
    const { out } = cast();
    const after = fold('seed', [...log, ...out.events]);
    expect(after.creatures[TARGET]?.vitals.hp).toBe(100 - 7);
  });

  /**
   * **The whole point of the half of this that is not arithmetic.** One D20
   * Test was thrown — the attack — and nothing at all for the damage, so the
   * generator stands exactly where the attack left it.
   */
  it('throws the attack and nothing else', () => {
    const { out, issuer } = cast();
    expect(issuer.count).toBe(1);
    const issued = out.events.filter((event) => event.type === 'rolls-issued');
    expect(issued.map((event) => event.count)).toEqual([1]);
  });
});

// — a potion whose every number is printed ——————————————————————————————————

const DRAUGHT = JSON.stringify({
  id: 'draught-of-plain-numbers',
  name: 'Draught of Plain Numbers',
  kind: 'potion',
  weightLb: 0.5,
  costCp: null,
  armor: null,
  weapon: null,
  contents: [],
  grants: [
    {
      kind: 'confers',
      action: 'bonus-action',
      durationSeconds: 3600,
      effects: [
        { kind: 'heal', healing: { flat: 6 }, addSpellcastingModifier: false },
        { kind: 'temp-hp', amount: { flat: 10 }, addSpellcastingModifier: false },
        {
          kind: 'buff',
          bonus: { source: 'Draught of Plain Numbers', flat: 2 },
          applies: ['save'],
          direction: 'add',
        },
      ],
    },
  ],
});

describe('a potion that heals, wards and helps, all by printed numbers', () => {
  const content = unwrap(loadContent({ items: [JSON.parse(DRAUGHT)] }), 'load');
  const DRAFT = 'draught-of-plain-numbers';

  const log: readonly GameEvent[] = [
    added(CASTER),
    { type: 'items-gained', id: CASTER, items: [{ id: DRAFT, quantity: 1 }], source: 'the hoard' },
    { type: 'damage-taken', id: CASTER, amount: 20, source: 'a spear' },
  ];

  const drink = () => {
    const issuer = createRollIssuer('r');
    const out = unwrap(
      useItem(fold('seed', log), CASTER, { item: DRAFT }, {
        issuer,
        rng: createRng('draught') as Rng,
        content,
      }),
      'drink',
    );
    return { out, issuer };
  };

  it('hands over exactly what it prints, and no more', () => {
    const { out } = drink();
    const after = fold('seed', [...log, ...out.events]);
    const drinker = after.creatures[CASTER]!;

    expect(drinker.vitals.hp).toBe(100 - 20 + 6);
    expect(drinker.vitals.temporaryHp).toBe(10);
    expect(
      drinker.bonuses.map((granted) => ({
        flat: granted.bonus.flat,
        dice: granted.bonus.dice,
        applies: granted.applies,
      })),
    ).toEqual([{ flat: 2, dice: undefined, applies: ['save'] }]);
    expect(drinker.bonuses[0]?.source).toBe(itemSource(DRAFT));
  });

  /**
   * **Not one die, and no record of one.** Three amounts, all of them printed
   * numbers, so the generator is exactly where it was and the batch carries no
   * `rolls-issued` at all — not even a zero, which would be a number in the
   * log that no die produced.
   */
  it('moves the generator not at all', () => {
    const { out, issuer } = drink();
    expect(issuer.count).toBe(0);
    expect(out.events.some((event) => event.type === 'rolls-issued')).toBe(false);
  });

  /** Rule 5: the log stands on its own, under any catalogue or none. */
  it('folds the same with the catalogue and without it', () => {
    const { out } = drink();
    const whole = [...log, ...out.events];
    expect(fold('seed', whole)).toStrictEqual(fold('seed', whole, content));
  });
});
