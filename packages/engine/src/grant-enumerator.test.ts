import { describe, expect, it } from 'vitest';
import { asCharacterId, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import {
  fold,
  grantSourcesOf,
  withoutGrants,
  type CreatureState,
  type GameEvent,
} from './events.js';

/**
 * One enumerator for the four sourced grant families.
 *
 * `CreatureState` carries four lists of grants that a running effect hung on a
 * creature — `bonuses`, `armorClasses`, `rollModifiers` and `grantedDefenses`
 * — and five functions used to walk all four by hand: `releaseCasting`,
 * `releaseOnTarget`, `releaseGrants`, `expireEffects` and `holdsNothingOf`.
 * The fourth family arrived in tranche 4 and had to be threaded through every
 * one of them; a fifth added to three of the five is how a grant ends up
 * released by a dispel and not by a deadline, silently, because each site is
 * correct on its own terms.
 *
 * **The fifth-family guard is the compiler, not a list here.** `GrantFamily`
 * is derived from the shape of `CreatureState` rather than written down, so a
 * fifth list of sourced grants joins it the day it is declared, and
 * `grantsOf`'s mapped-type literal then fails to compile until the enumerator
 * names it. That half is checked by `npm run typecheck`; what is checked here
 * is the runtime half — that the enumerator really reaches all four, with a
 * distinct source in each so dropping any one of them is visible.
 */

const id = (s: string) => asCharacterId(s);
const TARGET = id('target');
const SEED = 'ie-028';

const sheet = (): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 14, con: 14, int: 10, wis: 16, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'wis',
});

const added = (who: CharacterId): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 60,
  diesAtZero: false,
  creatureType: 'Humanoid',
});

/**
 * One grant from each family, each carrying a **different** source.
 *
 * Different sources are what make the enumerator's answer discriminating: with
 * one source shared by all four, a dropped family is invisible in the set of
 * sources that comes back.
 */
const ONE_OF_EACH: readonly GameEvent[] = [
  added(TARGET),
  {
    type: 'bonus-applied',
    id: TARGET,
    bonus: {
      source: 'Bless#cast:1',
      bonus: { source: 'Bless#cast:1', dice: '1d4' },
      applies: ['attack', 'save'],
      direction: 'add',
    },
  },
  {
    type: 'armor-class-granted',
    id: TARGET,
    armorClass: { source: 'Mage Armor#cast:2', base: 13, plusAbility: null, shieldAllowed: true },
  },
  {
    type: 'roll-modifier-granted',
    id: TARGET,
    modifier: {
      source: 'Blur#cast:3',
      modifier: {
        mode: 'disadvantage',
        selector: { roll: 'attack', relation: 'against-holder' },
      },
    },
  },
  {
    type: 'damage-defense-granted',
    id: TARGET,
    defense: {
      source: 'Stoneskin#cast:4',
      damageTypes: ['bludgeoning', 'piercing', 'slashing'],
      defense: 'resistant',
    },
  },
];

const creatureWithOneOfEach = (): CreatureState => {
  const state = fold(SEED, ONE_OF_EACH);
  const creature = state.creatures[TARGET];
  if (creature === undefined) throw new Error('the fixture did not add the creature');
  return creature;
};

describe('grantSourcesOf', () => {
  it('reaches every one of the four families', () => {
    // Sorted, so the answer does not depend on the order the families are
    // visited in: Bless (a bonus), Blur (a roll modifier), Mage Armor (an
    // Armour Class), Stoneskin (a defence).
    expect(grantSourcesOf(creatureWithOneOfEach())).toEqual([
      'Bless#cast:1',
      'Blur#cast:3',
      'Mage Armor#cast:2',
      'Stoneskin#cast:4',
    ]);
  });

  it('is sorted and deduplicated, so the family order is unobservable', () => {
    // One casting granting in three families is one source, once.
    const state = fold(SEED, [
      added(TARGET),
      {
        type: 'bonus-applied',
        id: TARGET,
        bonus: {
          source: 'Aid#cast:9',
          bonus: { source: 'Aid#cast:9', flat: 2 },
          applies: ['save'],
          direction: 'add',
        },
      },
      {
        type: 'armor-class-granted',
        id: TARGET,
        armorClass: { source: 'Aid#cast:9', base: 13, plusAbility: null, shieldAllowed: true },
      },
      {
        type: 'damage-defense-granted',
        id: TARGET,
        defense: { source: 'Aid#cast:9', damageTypes: ['fire'], defense: 'resistant' },
      },
    ]);
    const creature = state.creatures[TARGET];
    expect(creature && grantSourcesOf(creature)).toEqual(['Aid#cast:9']);
  });

  it('reports nothing for a creature nothing has been cast on', () => {
    const state = fold(SEED, [added(TARGET)]);
    const creature = state.creatures[TARGET];
    expect(creature && grantSourcesOf(creature)).toEqual([]);
  });

  it('sees both of one casting’s roll modifiers as one source', () => {
    // SRD Beacon of Hope grants "Advantage on Wisdom saving throws and Death
    // Saving Throws" — one casting, one source, two modifiers, because
    // `rollModifierKey` keys on the source *and the rolls it reaches*.
    const state = fold(SEED, [
      added(TARGET),
      {
        type: 'roll-modifier-granted',
        id: TARGET,
        modifier: {
          source: 'Beacon of Hope#cast:7',
          modifier: {
            mode: 'advantage',
            selector: { roll: 'saving-throw', relation: 'roller', ability: 'wis' },
          },
        },
      },
      {
        type: 'roll-modifier-granted',
        id: TARGET,
        modifier: {
          source: 'Beacon of Hope#cast:7',
          modifier: { mode: 'advantage', selector: { roll: 'death-save', relation: 'roller' } },
        },
      },
    ]);
    const creature = state.creatures[TARGET];
    expect(creature?.rollModifiers).toHaveLength(2);
    expect(creature && grantSourcesOf(creature)).toEqual(['Beacon of Hope#cast:7']);
  });
});

describe('withoutGrants', () => {
  it('removes from every one of the four families in one pass', () => {
    const creature = creatureWithOneOfEach();
    const stripped = withoutGrants(creature, () => true);
    expect(grantSourcesOf(stripped)).toEqual([]);
    expect(stripped.bonuses).toEqual([]);
    expect(stripped.armorClasses).toEqual([]);
    expect(stripped.rollModifiers).toEqual([]);
    expect(stripped.grantedDefenses).toEqual([]);
  });

  it('takes only what the predicate names, whichever family holds it', () => {
    const creature = creatureWithOneOfEach();
    const stripped = withoutGrants(creature, (source) => source === 'Blur#cast:3');
    expect(grantSourcesOf(stripped)).toEqual([
      'Bless#cast:1',
      'Mage Armor#cast:2',
      'Stoneskin#cast:4',
    ]);
  });

  it('returns the creature itself when nothing matched', () => {
    // Identity, not a copy: the fold compares by reference to decide whether a
    // derived pass changed anything at all.
    const creature = creatureWithOneOfEach();
    expect(withoutGrants(creature, () => false)).toBe(creature);
  });

  it('takes both of one casting’s roll modifiers, not just the first', () => {
    const state = fold(SEED, [
      added(TARGET),
      {
        type: 'roll-modifier-granted',
        id: TARGET,
        modifier: {
          source: 'Beacon of Hope#cast:7',
          modifier: {
            mode: 'advantage',
            selector: { roll: 'saving-throw', relation: 'roller', ability: 'wis' },
          },
        },
      },
      {
        type: 'roll-modifier-granted',
        id: TARGET,
        modifier: {
          source: 'Beacon of Hope#cast:7',
          modifier: { mode: 'advantage', selector: { roll: 'death-save', relation: 'roller' } },
        },
      },
    ]);
    const creature = state.creatures[TARGET];
    expect(creature).toBeDefined();
    if (creature === undefined) return;
    expect(withoutGrants(creature, (s) => s === 'Beacon of Hope#cast:7').rollModifiers).toEqual([]);
  });

  it('leaves an Initiative bonus alone, source and all', () => {
    // `initiativeBonuses` is the one field on `CreatureState` that matches the
    // grant shape — a list of things carrying a `source` — and is deliberately
    // excluded. SRD Alert's Proficiency Bonus is derived from the character's
    // own feat at creation; no casting hung it, and no casting, deadline or
    // dispel takes it away. A predicate that names every source must not.
    //
    // Built rather than folded: `initiativeBonuses` reaches state only through
    // `character-created`, which wants a whole `CharacterRecord`, and these are
    // pure functions over a `CreatureState`.
    const alert = { source: 'feat:alert', flat: 3 };
    const creature: CreatureState = {
      ...creatureWithOneOfEach(),
      initiativeBonuses: [alert],
      defenses: { fire: { resistant: true } },
    };

    expect(grantSourcesOf(creature)).not.toContain('feat:alert');

    const stripped = withoutGrants(creature, () => true);
    expect(stripped.initiativeBonuses).toEqual([alert]);
    // And the creature's own defence table, which carries no source at all and
    // is what `grantedDefenses` exists beside rather than inside.
    expect(stripped.defenses).toEqual({ fire: { resistant: true } });
    expect(stripped.conditions).toBe(creature.conditions);
  });
});
