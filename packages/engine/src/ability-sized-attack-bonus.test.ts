import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import { checkContent, extendContent, parseClassDefinition } from './content.js';
import { resolveAttack } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { createRng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { createRollIssuer } from './rolls.js';
import { standingBonuses } from './standing.js';

/**
 * A bonus to **attack rolls**, sized by a modifier on the holder's own sheet.
 *
 * The third family of the same derivation, and the one the union did not have.
 * `save-bonus` is SRD Aura of Protection — "a bonus to saving throws equal to
 * your Charisma modifier (minimum bonus of +1)", the *holder's* modifier — and
 * `check-bonus` beside it is the two Orders' bonus over the skills they name.
 * `flat-bonus` is "Flat, and only flat", so until `attack-bonus` there was no
 * way to write SRD Sacred Weapon's "you add your Charisma modifier to attack
 * rolls you make with that weapon (minimum bonus of +1)" as anything but a
 * number the caller passed in.
 *
 * The class below is not the SRD's writer, which is the point: it is loaded
 * from JSON text through the public door, sized by a different ability, and
 * gated on one option of a choice. Nothing in the engine names it.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const DUELLIST = id('duellist');
const DUMMY = id('dummy');

const BLADESINGER = {
  id: 'bladesinger',
  name: 'Bladesinger',
  primaryAbility: 'int',
  hitDie: 8,
  saveProficiencies: ['int', 'dex'],
  skillChoices: { choose: 2, from: ['athletics', 'arcana', 'acrobatics', 'insight'] },
  weaponProficiencies: ['martial'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'longsword', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'bladesinger:song-of-the-blade',
      name: 'Song of the Blade',
      level: 1,
      automation: 'engine',
      note: 'Singer adds your Intelligence modifier to attack rolls you make with a Melee weapon (minimum bonus of +1). Silent gives you nothing this engine reads.',
      choice: { kind: 'option', choose: 1, from: ['Singer', 'Silent'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Singer',
        effects: [
          {
            kind: 'attack-bonus',
            fromAbility: 'int',
            minimum: 1,
            onlyWithWeapon: { weapons: [{ kind: 'melee' }] },
          },
        ],
      },
    },
  ],
};

const parsed = unwrap(parseClassDefinition(JSON.parse(JSON.stringify(BLADESINGER))), 'parse');
const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

/** `dim` swaps the scores so the modifier is negative and the floor has work to do. */
const bladesinger = (option: string, dim = false): CharacterChoices =>
  ({
    name: 'Ilka',
    classId: 'bladesinger',
    level: 1,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: dim
        ? { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }
        : { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
    },
    abilityIncreases: dim ? { con: 2, wis: 1 } : { con: 2, int: 1 },
    classSkills: ['athletics', 'arcana'],
    languages: ['Draconic', 'Elvish'],
    alignment: 'Neutral',
    cantrips: [],
    spellbook: [],
    preparedSpells: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'], 'bladesinger:song-of-the-blade': [option] },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'ray-of-frost'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'medicine'] },
    },
  }) as CharacterChoices;

const dummy: GameEvent = {
  type: 'creature-added',
  id: DUMMY,
  name: 'a straw dummy',
  sheet: {
    level: 1,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: true, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
  },
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side: 'dummies',
};

const field = (option: string, dim = false): readonly GameEvent[] => [
  ...(unwrap(createCharacter(content, bladesinger(option, dim), DUELLIST), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: DUELLIST, side: 'party' },
  dummy,
  {
    type: 'items-gained',
    id: DUELLIST,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'shortbow', quantity: 1 },
      { id: 'arrow', quantity: 20 },
    ],
    source: 'the quartermaster',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: DUELLIST, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: DUMMY,
    placement: { from: { creature: DUELLIST }, feet: 5, bearing: 0 },
  },
];

const built = (option: string, dim = false): GameState => fold('seed', field(option, dim));

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: createRng('swing'),
  content,
});

const contributionsOf = (events: readonly GameEvent[]): Record<string, number> => {
  const record = events.find((e) => e.type === 'roll-recorded');
  if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
  return Object.fromEntries(record.contributions.map((c) => [c.source, c.amount]));
};

const swing = (state: GameState, weapon: string): readonly GameEvent[] =>
  unwrap(
    resolveAttack(state, DUELLIST, { target: DUMMY, weapon, free: true }, supply(state)),
    'attack',
  ).events;

describe('a bonus to attack rolls that an ability modifier sizes', () => {
  it('is validated beside the printed classes and adds no problem', () => {
    expect(checkContent({ classes: [parsed] })).toEqual([]);
  });

  /**
   * A bonus that could never be computed is refused at the door, which is the
   * rule the whole content validator follows.
   */
  it('refuses an ability the engine holds no score for, and a floor that is not points', () => {
    const rewritten = (over: Record<string, unknown>): readonly string[] => {
      const written = JSON.parse(JSON.stringify(BLADESINGER)) as typeof BLADESINGER;
      const grants = written.features[0]?.grants as { effects: Record<string, unknown>[] };
      grants.effects[0] = { ...grants.effects[0], ...over };
      return checkContent({ classes: [written as never] }).map(
        (problem) => `${problem.code} @ ${problem.field}`,
      );
    };
    expect(rewritten({ fromAbility: 'luck' })).toContain(
      'bad_attack_bonus @ classes[bladesinger].features[0].grants.effects[0].fromAbility',
    );
    expect(rewritten({ minimum: 'one' })).toContain(
      'bad_attack_bonus @ classes[bladesinger].features[0].grants.effects[0].minimum',
    );
  });

  it('is gathered off the holder’s own sheet, at the score they have', () => {
    const state = built('Singer');
    const longsword = content.item('longsword')?.weapon ?? null;
    expect(standingBonuses(state, DUELLIST, 'attack', { weapon: longsword })).toEqual([
      { source: 'Song of the Blade', flat: 3 },
    ]);
  });

  it('reaches the attack roll, named rather than folded in', () => {
    const out = swing(built('Singer'), 'longsword');
    expect(contributionsOf(out)['Song of the Blade']).toBe(3);
  });

  /** SRD's "(minimum bonus of +1)": a floor under the modifier, not a default. */
  it('floors at the number the feature prints when the modifier is worse', () => {
    const out = swing(built('Singer', true), 'longsword');
    expect(contributionsOf(out)['Song of the Blade']).toBe(1);
  });

  /** The narrowing is the one every other weapon clause reads. */
  it('is withheld from a swing with a weapon the sentence does not reach', () => {
    const out = swing(built('Singer'), 'shortbow');
    expect(contributionsOf(out)['Song of the Blade']).toBeUndefined();
  });

  it('is withheld from a holder who chose the other option', () => {
    const out = swing(built('Silent'), 'longsword');
    expect(contributionsOf(out)['Song of the Blade']).toBeUndefined();
  });

  /** Named rather than folded in: the pieces still account for the whole. */
  it('keeps the contributions summing to the modifier', () => {
    const state = built('Singer');
    const out = unwrap(
      resolveAttack(
        state,
        DUELLIST,
        { target: DUMMY, weapon: 'longsword', free: true },
        supply(state),
      ),
      'attack',
    );
    const total = Object.values(contributionsOf(out.events)).reduce((n, a) => n + a, 0);
    expect(total).toBe(out.attack?.roll.modifier);
  });
});
