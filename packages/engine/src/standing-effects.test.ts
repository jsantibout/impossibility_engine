import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type Ability, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { damageCreature } from './commands.js';
import {
  defensesOf,
  effectiveConditions,
  standingFor,
  standingSaveBonuses,
  standingDefenses,
  rollModesFor,
  suppressedConditions,
} from './standing.js';

/**
 * The Advantage and Disadvantage reaching a saving throw, read the way every
 * roll in the engine now reads it: one query, one gatherer, one predicate.
 */
const saveModes = (state: GameState, who: CharacterId, ability: Ability) =>
  rollModesFor(state, { family: 'saving-throw', roller: who, ability }).modes;


/**
 * Modifiers a class feature grants for as long as its rule holds.
 *
 * Three things separate these from the bonuses a spell hangs on a creature,
 * and all three come straight from the SRD text:
 *
 * - **They are conditional, and the condition is read from state.** Danger
 *   Sense is Advantage on Dexterity saves "unless you have the Incapacitated
 *   condition"; Aura of Protection "is inactive while you have the
 *   Incapacitated condition". A benefit that survived its own condition would
 *   be an unconditional bonus wearing a feature's name.
 * - **They reach other creatures by distance.** An aura is an Emanation, so
 *   who is in it changes every time anybody moves, and nothing is stored on
 *   the creatures it reaches.
 * - **They are derived, never applied.** Nothing writes a `bonus-applied`
 *   event for an aura, because there is no moment at which it starts: it is a
 *   fact about where two creatures are standing.
 *
 * The features here, quoted rather than recalled:
 *
 * | Feature | SRD |
 * |---|---|
 * | Danger Sense (Barbarian 2) | "Advantage on Dexterity saving throws unless you have the Incapacitated condition" |
 * | Aura of Protection (Paladin 6) | "10-foot Emanation... You and your allies in the aura gain a bonus to saving throws equal to your Charisma modifier (minimum bonus of +1)" |
 * | Aura of Courage (Paladin 10) | "Immunity to the Frightened condition while in your Aura of Protection" |
 * | Aura of Devotion (Devotion 7) | "Immunity to the Charmed condition while in your Aura of Protection" |
 * | Aura Expansion (Paladin 18) | "Your Aura of Protection is now a 30-foot Emanation" |
 */

const id = (s: string) => asCharacterId(s);
const KESS = id('kess');
const ALLY = id('ally');
const FOE = id('foe');
const OTHER = id('other');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 6,
  abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 18 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

/** SRD Aura of Protection, as a feature would hand it to the sheet. */
const auraOfProtection = {
  feature: 'paladin:aura-of-protection',
  name: 'Aura of Protection',
  reach: { kind: 'aura' as const, feet: 10 },
  grant: { kind: 'save-bonus' as const, fromAbility: 'cha' as const, minimum: 1 },
  requires: [{ kind: 'not-incapacitated' as const }],
};

const auraOfCourage = {
  feature: 'paladin:aura-of-courage',
  name: 'Aura of Courage',
  reach: { kind: 'aura' as const, feet: 10 },
  grant: { kind: 'condition-immunity' as const, condition: 'frightened' as const },
  requires: [{ kind: 'not-incapacitated' as const }],
};

const dangerSense = {
  feature: 'barbarian:danger-sense',
  name: 'Danger Sense',
  reach: { kind: 'self' as const },
  grant: {
    kind: 'roll-mode' as const,
    modifier: {
      mode: 'advantage' as const,
      selector: { roll: 'saving-throw' as const, relation: 'roller' as const, ability: 'dex' as const },
    },
  },
  requires: [{ kind: 'not-incapacitated' as const }],
};

const added = (
  who: CharacterId,
  over: Partial<CharacterSheet> = {},
  side?: string,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  ...(side === undefined ? {} : { side }),
});

const at = (who: CharacterId, feet: number, bearing: number): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: KESS }, feet, bearing },
});

const SETUP: readonly GameEvent[] = [
  added(KESS, { standing: [auraOfProtection] }, 'party'),
  added(ALLY, {}, 'party'),
  added(FOE, {}, 'goblins'),
  added(OTHER),
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the altar', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: KESS, placement: { from: { landmark: 'the altar' }, feet: 0 } },
  at(ALLY, 10, 0),
  at(FOE, 10, 90),
  at(OTHER, 10, 180),
];

const base = (): GameState => fold('seed', SETUP);

const flatOf = (bonuses: readonly { flat?: number }[]): number =>
  bonuses.reduce((sum, b) => sum + (b.flat ?? 0), 0);

describe('an aura is a fact about where people are standing', () => {
  /** SRD: "You and your allies in the aura". Charisma 18 is +4. */
  it('reaches the paladin and an ally inside it', () => {
    expect(flatOf(standingSaveBonuses(base(), KESS, 'wis'))).toBe(4);
    expect(flatOf(standingSaveBonuses(base(), ALLY, 'wis'))).toBe(4);
  });

  /** "You and your **allies**" — an enemy standing in it gains nothing. */
  it('reaches nobody on another side', () => {
    expect(standingSaveBonuses(base(), FOE, 'wis')).toEqual([]);
  });

  /** And nobody the table has not placed on a side at all. */
  it('reaches nobody whose allegiance nobody declared', () => {
    expect(standingSaveBonuses(base(), OTHER, 'wis')).toEqual([]);
  });

  /** It is a bonus to saving throws — all of them, not one ability's. */
  it('applies to every saving throw', () => {
    for (const ability of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
      expect(flatOf(standingSaveBonuses(base(), ALLY, ability))).toBe(4);
    }
  });

  /** A 10-foot Emanation measured the way everything else is measured. */
  it('stops at its own edge', () => {
    const far = fold('seed', [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === ALLY)),
      at(ALLY, 15, 0),
    ]);
    expect(standingSaveBonuses(far, ALLY, 'wis')).toEqual([]);
  });

  /** And follows the creature: walking in earns it, walking out loses it. */
  it('appears and disappears as the ally moves', () => {
    const walkedOut: readonly GameEvent[] = [
      ...SETUP,
      { type: 'creature-moved', id: ALLY, placement: { from: { creature: KESS }, feet: 30, bearing: 0 } },
    ];
    expect(standingSaveBonuses(fold('seed', walkedOut), ALLY, 'wis')).toEqual([]);

    const walkedBack: readonly GameEvent[] = [
      ...walkedOut,
      { type: 'creature-moved', id: ALLY, placement: { from: { creature: KESS }, feet: 5, bearing: 0 } },
    ];
    expect(flatOf(standingSaveBonuses(fold('seed', walkedBack), ALLY, 'wis'))).toBe(4);
  });

  /** Nobody is in an aura whose owner has not been placed. */
  it('reaches nobody at all when nothing has a position', () => {
    const nowhere = fold('seed', [added(KESS, { standing: [auraOfProtection] }, 'party'), added(ALLY, {}, 'party')]);
    expect(standingSaveBonuses(nowhere, ALLY, 'wis')).toEqual([]);
    // The holder still has it: SRD puts them in their own aura, and where they
    // are standing cannot change that.
    expect(flatOf(standingSaveBonuses(nowhere, KESS, 'wis'))).toBe(4);
  });
});

describe('the source has to be able to sustain it', () => {
  /** SRD: "The aura is inactive while you have the Incapacitated condition." */
  it('goes out while the paladin is Incapacitated', () => {
    const stunned = fold('seed', [
      ...SETUP,
      { type: 'condition-applied', id: KESS, condition: 'stunned', source: 'a spell' },
    ]);
    expect(standingSaveBonuses(stunned, ALLY, 'wis')).toEqual([]);
    expect(standingSaveBonuses(stunned, KESS, 'wis')).toEqual([]);
  });

  /** Dropping to 0 hit points is Unconscious, which is Incapacitated. */
  it('goes out when the paladin drops, through the damage command', () => {
    const hit = unwrap(
      damageCreature(base(), KESS, { amount: 40, source: 'an ogre' }),
      'damage',
    );
    const down = fold('seed', [...SETUP, ...hit]);

    // Dropping to 0 is Unconscious, which is Incapacitated, which the SRD
    // names as the thing that puts the aura out.
    expect(down.creatures.kess!.conditions.conditions).toContain('unconscious');
    expect(standingSaveBonuses(down, ALLY, 'wis')).toEqual([]);
  });

  /**
   * And when the paladin dies. The SRD names only Incapacitated because it
   * does not contemplate a corpse radiating protection.
   */
  it('goes out when the paladin dies', () => {
    const dead = fold('seed', [...SETUP, { type: 'creature-died', id: KESS, cause: 'a dragon' }]);
    expect(standingSaveBonuses(dead, ALLY, 'wis')).toEqual([]);
  });
});

describe('two paladins are one aura', () => {
  /**
   * SRD: "If another Paladin is present, a creature can benefit from only one
   * Aura of Protection at a time; the creature chooses which aura while in
   * them." A higher bonus costs nothing and gives up nothing, so the better
   * one is taken and named rather than a question being asked whose answer is
   * arithmetic.
   */
  it('takes the better of two and not their sum', () => {
    const pair = fold('seed', [
      ...SETUP,
      added(id('lesser'), { standing: [auraOfProtection], abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 12 } }, 'party'),
      { type: 'creature-placed', id: id('lesser'), placement: { from: { creature: KESS }, feet: 5, bearing: 45 } },
    ]);
    const bonuses = standingSaveBonuses(pair, ALLY, 'wis');
    expect(flatOf(bonuses)).toBe(4);
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0]?.source).toContain('Aura of Protection');
  });

  /** SRD: "minimum bonus of +1" — a paladin with a Charisma penalty gives +1. */
  it('never gives less than +1', () => {
    const grim = fold('seed', [
      added(KESS, { standing: [auraOfProtection], abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 6 } }, 'party'),
      added(ALLY, {}, 'party'),
      { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
      { type: 'landmark-added', name: 'the altar', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: KESS, placement: { from: { landmark: 'the altar' }, feet: 0 } },
      at(ALLY, 5, 0),
    ]);
    expect(flatOf(standingSaveBonuses(grim, ALLY, 'wis'))).toBe(1);
  });
});

describe('Danger Sense is conditional on the creature that has it', () => {
  const raging = (): GameState =>
    fold('seed', [added(id('grum'), { standing: [dangerSense] }, 'party')]);

  /** SRD: "Advantage on Dexterity saving throws". */
  it('grants Advantage on a Dexterity save', () => {
    expect(saveModes(raging(), id('grum'), 'dex')).toEqual([
      { source: 'Danger Sense', mode: 'advantage' },
    ]);
  });

  it('grants nothing on any other save', () => {
    expect(saveModes(raging(), id('grum'), 'wis')).toEqual([]);
  });

  /** SRD: "unless you have the Incapacitated condition". */
  it('stops while Incapacitated', () => {
    const stunned = fold('seed', [
      added(id('grum'), { standing: [dangerSense] }, 'party'),
      { type: 'condition-applied', id: id('grum'), condition: 'stunned', source: 'a spell' },
    ]);
    expect(saveModes(stunned, id('grum'), 'dex')).toEqual([]);
  });

  /** It reaches nobody else, however close they stand. */
  it('is not an aura', () => {
    const pair = fold('seed', [
      added(KESS, { standing: [dangerSense] }, 'party'),
      added(ALLY, {}, 'party'),
      { type: 'scene-set', extent: { width: 100, depth: 100, height: 40 } },
      { type: 'landmark-added', name: 'here', at: { x: 50, y: 50, z: 0 } },
      { type: 'creature-placed', id: KESS, placement: { from: { landmark: 'here' }, feet: 0 } },
      at(ALLY, 5, 0),
    ]);
    expect(saveModes(pair, ALLY, 'dex')).toEqual([]);
  });
});

describe('an aura can suppress a condition without removing it', () => {
  const withCourage: readonly GameEvent[] = [
    added(KESS, { standing: [auraOfProtection, auraOfCourage] }, 'party'),
    added(ALLY, {}, 'party'),
    added(FOE, {}, 'goblins'),
    { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
    { type: 'landmark-added', name: 'the altar', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: KESS, placement: { from: { landmark: 'the altar' }, feet: 0 } },
    at(ALLY, 5, 0),
    at(FOE, 5, 90),
    { type: 'condition-applied', id: ALLY, condition: 'frightened', source: 'a dragon' },
  ];

  /**
   * SRD: "If a Frightened ally enters the aura, that condition **has no effect
   * on that ally while there**." Not "cannot be applied", and not "is removed"
   * — the condition is still on them, and it comes back the moment they leave.
   */
  it('leaves the condition on the creature', () => {
    const state = fold('seed', withCourage);
    expect(state.creatures.ally!.conditions.conditions).toContain('frightened');
    expect(suppressedConditions(state, ALLY)).toContain('frightened');
  });

  it('stops it having any effect while inside', () => {
    const state = fold('seed', withCourage);
    const effective = effectiveConditions(state, ALLY);
    expect(effective.conditions).not.toContain('frightened');
  });

  it('lets it bite again the moment they step out', () => {
    const outside = fold('seed', [
      ...withCourage,
      { type: 'creature-moved', id: ALLY, placement: { from: { creature: KESS }, feet: 30, bearing: 0 } },
    ]);
    expect(effectiveConditions(outside, ALLY).conditions).toContain('frightened');
  });

  /** The aura protects allies, so a Frightened enemy standing in it is not helped. */
  it('does not suppress anything for an enemy', () => {
    const scaredFoe = fold('seed', [
      ...withCourage,
      { type: 'condition-applied', id: FOE, condition: 'frightened', source: 'a dragon' },
    ]);
    expect(effectiveConditions(scaredFoe, FOE).conditions).toContain('frightened');
  });
});

describe('nothing about this is stored on the creature it reaches', () => {
  /**
   * The load-bearing property: a conditional benefit must not become an
   * unconditional one. Nothing writes a `bonus-applied` event for an aura, so
   * there is no stale copy to go wrong when the paladin walks away.
   */
  it('hangs no bonus on anybody', () => {
    const state = base();
    expect(state.creatures.ally!.bonuses).toEqual([]);
    expect(state.creatures.kess!.bonuses).toEqual([]);
  });

  it('is derived, so the same log folds to the same answer twice', () => {
    expect(standingFor(base(), ALLY)).toEqual(standingFor(base(), ALLY));
    expect(fold('seed', SETUP).creatures).toEqual(fold('other-seed', SETUP).creatures);
  });

  it('survives JSON, because it is not in the state at all', () => {
    const state = base();
    const round = JSON.parse(JSON.stringify(state)) as GameState;
    expect(standingSaveBonuses(round, ALLY, 'wis')).toEqual(
      standingSaveBonuses(state, ALLY, 'wis'),
    );
  });

  it('replays prefix by prefix', () => {
    for (let n = 0; n <= SETUP.length; n += 1) {
      expect(fold('seed', SETUP.slice(0, n))).toEqual(fold('seed', SETUP.slice(0, n)));
    }
  });
});

/**
 * Resistance a feature grants, and the correction that writing it required.
 *
 * The first version of this module gated *every* standing effect on the holder
 * not being Incapacitated, which is what Danger Sense and the Paladin auras
 * say and is not a general rule. SRD Elemental Affinity says only "You have
 * Resistance to that damage type" — a stunned Sorcerer still resists fire, and
 * baking one feature's clause into the mechanism would have quietly rewritten
 * another feature.
 *
 * So the requirement is declared per effect, from that feature's own text.
 */
describe('a feature can grant Resistance, on its own terms', () => {
  const elementalAffinity = {
    feature: 'draconic-sorcery:elemental-affinity',
    name: 'Elemental Affinity',
    reach: { kind: 'self' as const },
    grant: { kind: 'damage-resistance' as const, damageTypes: ['fire'] },
  };

  const scaled = (extra: readonly GameEvent[] = []): GameState =>
    fold('seed', [added(id('veska'), { standing: [elementalAffinity] }, 'party'), ...extra]);

  it('resists the type it named', () => {
    expect(standingDefenses(scaled(), id('veska')).fire).toEqual({ resistant: true });
  });

  it('resists nothing else', () => {
    expect(standingDefenses(scaled(), id('veska')).cold).toBeUndefined();
  });

  /** SRD says nothing about Incapacitated here, so nothing takes it away. */
  it('keeps resisting while Stunned, because its text does not say otherwise', () => {
    const stunned = scaled([
      { type: 'condition-applied', id: id('veska'), condition: 'stunned', source: 'a spell' },
    ]);
    expect(standingDefenses(stunned, id('veska')).fire).toEqual({ resistant: true });
  });

  /** Where Danger Sense, whose text *does* say so, stops. */
  it('is not how Danger Sense behaves, which is the point of declaring it', () => {
    const stunned = fold('seed', [
      added(id('grum'), { standing: [dangerSense] }, 'party'),
      { type: 'condition-applied', id: id('grum'), condition: 'stunned', source: 'a spell' },
    ]);
    expect(saveModes(stunned, id('grum'), 'dex')).toEqual([]);
  });

  /**
   * SRD: "multiple instances of Resistance to the same damage type count as
   * one", so a feature's resistance and a stat block's are still one halving.
   */
  it('does not double up with a resistance the creature already had', () => {
    const both = fold('seed', [
      {
        type: 'creature-added',
        id: id('veska'),
        name: 'veska',
        sheet: sheet({ standing: [elementalAffinity] }),
        maxHp: 40,
        diesAtZero: false,
        creatureType: 'Humanoid',
        defenses: { fire: { resistant: true } },
        side: 'party',
      },
    ]);
    expect(defensesOf(both, id('veska')).fire).toEqual({ resistant: true });
  });

  /** An Immunity the creature already had is not weakened into Resistance. */
  it('does not overwrite a stronger defence', () => {
    const immune = fold('seed', [
      {
        type: 'creature-added',
        id: id('veska'),
        name: 'veska',
        sheet: sheet({ standing: [elementalAffinity] }),
        maxHp: 40,
        diesAtZero: false,
        creatureType: 'Humanoid',
        defenses: { fire: { immune: true } },
        side: 'party',
      },
    ]);
    expect(defensesOf(immune, id('veska')).fire).toMatchObject({ immune: true });
  });
});
