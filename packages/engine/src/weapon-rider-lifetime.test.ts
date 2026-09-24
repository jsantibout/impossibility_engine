import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { extendContent, parseClassDefinition, type Content } from './content.js';
import {
  activateFeature,
  advanceTime,
  dropItem,
  endFeature,
  resolveAttack,
  resolveSpell,
} from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import type { Rng, RngState } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { lightAt } from './positioning.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import type { CharacterSheet } from './character.js';

/**
 * **A benefit keyed to one object, and what happens when the object is gone.**
 *
 * `weapon-rider.test.ts` beside this one drives what a casting's rider *does*
 * to a swing. This drives the two lifetimes around it:
 *
 * - **A feature may imbue one object**, the way a casting already does. SRD
 *   Sacred Weapon — "imbue **one** Melee weapon that you are holding" — is the
 *   sentence, and until now the nearest a feature reached was a standing grant
 *   narrowed to a *kind* of weapon, which imbued every Longsword in the pack.
 *   The activation names the weapon, the command checks it against the kind the
 *   feature prints and against what the holder is carrying, and what it hangs
 *   is the same `GrantedWeaponRider` a casting hangs — sourced to the feature
 *   rather than to a casting.
 * - **A rider may end when its weapon is no longer carried.** SRD Sacred
 *   Weapon: "This effect also ends if you aren't carrying the weapon." The
 *   rider pins an item id and the inventory holds item ids, so the fold
 *   compares two ids it already has and opens no catalogue.
 *
 * The class below is not the SRD's writer, which is the point: it is loaded
 * from JSON text through the public door, sized by a different ability, and
 * nothing in the engine names it.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const TEMPLAR = id('templar');
const DUMMY = id('dummy');
const BLESSED_BLADE = 'templar:blessed-blade';

const TEMPLAR_CLASS = {
  id: 'templar',
  name: 'Templar',
  primaryAbility: 'cha',
  hitDie: 10,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['athletics', 'religion', 'insight', 'persuasion'] },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'longsword', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    tools: [],
  },
  features: [
    {
      id: BLESSED_BLADE,
      name: 'Blessed Blade',
      level: 1,
      automation: 'engine',
      note: 'The Templar imbues one Melee weapon they are carrying for ten minutes: their Charisma modifier on its attack rolls with a floor of +1, its own damage type or Radiant at each hit, and a light it sheds. It ends early if they use the feature again or stop carrying the weapon.',
      grants: {
        kind: 'activated',
        action: 'none',
        pool: 'blessed-blade',
        usesByLevel: Array.from({ length: 20 }, () => 2),
        poolLabel: 'Blessed Blade',
        recovers: 'long-rest',
        lastsSeconds: 600,
        imbuesWeapon: {
          weapons: { weapons: [{ kind: 'melee' }] },
          attackBonusFrom: { ability: 'cha', minimum: 1 },
          damageTypes: ['radiant'],
        },
        whileActive: [{ kind: 'light', level: 'bright', radius: 20, dimBeyond: 20 }],
      },
    },
  ],
};

const parsed = unwrap(
  parseClassDefinition(JSON.parse(JSON.stringify(TEMPLAR_CLASS))),
  'parse',
);
const content: Content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

const templar = (): CharacterChoices =>
  ({
    name: 'Iselle',
    classId: 'templar',
    level: 1,
    speciesId: 'human',
    backgroundId: 'acolyte',
    abilities: {
      method: 'standard-array',
      assignment: { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 15 },
    },
    abilityIncreases: { cha: 2, wis: 1 },
    classSkills: ['athletics', 'religion'],
    languages: ['Draconic', 'Elvish'],
    alignment: 'Lawful Good',
    cantrips: [],
    spellbook: [],
    preparedSpells: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'human:versatile': { featId: 'alert' },
      'acolyte:magic-initiate-cleric': {
        featId: 'magic-initiate',
        spellList: 'cleric',
        spellcastingAbility: 'wis',
        cantrips: ['guidance', 'sacred-flame'],
        levelOneSpell: 'bless',
      },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  }) as CharacterChoices;

const plain = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

const field = (): readonly GameEvent[] => [
  ...(unwrap(createCharacter(content, templar(), TEMPLAR), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: TEMPLAR, side: 'party' },
  {
    type: 'creature-added',
    id: DUMMY,
    name: 'a straw dummy',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'dummies',
  },
  {
    type: 'items-gained',
    id: TEMPLAR,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'dagger', quantity: 1 },
      { id: 'longbow', quantity: 1 },
      { id: 'arrow', quantity: 20 },
    ],
    source: 'the chapter house',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the chapel', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: TEMPLAR, placement: { from: { landmark: 'the chapel' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: DUMMY,
    placement: { from: { creature: TEMPLAR }, feet: 5, bearing: 0 },
  },
];

/** The d20 is fixed and every die after it is maximal, as the rider tests do. */
const scripted = (d20: number): Rng => {
  let thrown = 0;
  return {
    int: (sides: number) => (thrown++ === 0 ? d20 : sides),
    snapshot: (): RngState => [0, 0, 0, 0],
  };
};

const supply = (state: GameState, d20 = 18) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: scripted(d20),
  content,
});

const at = (log: readonly GameEvent[]): GameState => fold('the chapel', log);

const imbue = (
  log: readonly GameEvent[],
  weapon: string | undefined,
  commandId?: string,
): readonly GameEvent[] =>
  unwrap(
    activateFeature(
      at(log),
      TEMPLAR,
      {
        feature: BLESSED_BLADE,
        ...(weapon === undefined ? {} : { weapon }),
        ...(commandId === undefined ? {} : { commandId }),
      },
      content,
    ),
    'imbuing',
  );

const imbued = (weapon = 'longsword'): readonly GameEvent[] => {
  const log = field();
  return [...log, ...imbue(log, weapon)];
};

const swing = (log: readonly GameEvent[], weapon: string, featureDamageTypes?: Record<string, string>) =>
  resolveAttack(
    at(log),
    TEMPLAR,
    {
      target: DUMMY,
      weapon,
      free: true,
      ...(featureDamageTypes === undefined ? {} : { featureDamageTypes }),
    },
    supply(at(log)),
  );

const contributionsOf = (events: readonly GameEvent[]): Record<string, number> => {
  const record = events.find((e) => e.type === 'roll-recorded');
  if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
  return Object.fromEntries(record.contributions.map((c) => [c.source, c.amount]));
};

const typesOf = (events: readonly GameEvent[]): readonly string[] => {
  const record = events.find((event) => event.type === 'damage-dice-recorded');
  if (record?.type !== 'damage-dice-recorded') throw new Error('no damage dice were recorded');
  return record.components.map((component) => component.type);
};

const ridersOn = (log: readonly GameEvent[]): readonly { weapon: string }[] =>
  at(log).creatures[TEMPLAR]?.weaponRiders ?? [];

const drop = (log: readonly GameEvent[], item: string): readonly GameEvent[] => [
  ...log,
  ...unwrap(
    dropItem(at(log), content, TEMPLAR, { items: [{ id: item, quantity: 1 }] }),
    `dropping the ${item}`,
  ),
];

describe('a feature imbues the one weapon its activation names', () => {
  it('hangs a rider on that weapon and on nothing else', () => {
    expect(ridersOn(imbued()).map((rider) => rider.weapon)).toEqual(['longsword']);
  });

  /** "you add your Charisma modifier ... (minimum bonus of +1)", on that weapon. */
  it('adds the ability-sized bonus to a swing with it', () => {
    const hit = unwrap(swing(imbued(), 'longsword'), 'a swing');
    expect(contributionsOf(hit.events)['Blessed Blade']).toBe(3);
  });

  /**
   * **The clause the standing grant could not say.** A Templar carrying two
   * Melee weapons imbued one of them, and the other is an ordinary dagger.
   */
  it('adds nothing to a swing with the other Melee weapon in the pack', () => {
    const hit = unwrap(swing(imbued(), 'dagger'), 'a swing');
    expect(contributionsOf(hit.events)['Blessed Blade']).toBeUndefined();
  });

  it('offers its damage type on the imbued weapon and on no other', () => {
    const radiant = unwrap(swing(imbued(), 'longsword', { [BLESSED_BLADE]: 'radiant' }), 'a swing');
    expect(typesOf(radiant.events)).toEqual(['radiant']);

    const refused = swing(imbued(), 'dagger', { [BLESSED_BLADE]: 'radiant' });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_such_feature_choice');
  });

  it('deals the weapon’s own type where the swing names none', () => {
    const hit = unwrap(swing(imbued(), 'longsword'), 'a swing');
    expect(typesOf(hit.events)).toEqual(['slashing']);
  });
});

describe('the weapon an imbuing may name', () => {
  const refusal = (weapon: string | undefined) =>
    activateFeature(
      at(field()),
      TEMPLAR,
      { feature: BLESSED_BLADE, ...(weapon === undefined ? {} : { weapon }) },
      content,
    );

  it('refuses a weapon of the wrong kind before the use is spent', () => {
    const out = refusal('longbow');
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('weapon_not_of_kind');
    expect(remaining(at(field()).creatures[TEMPLAR]!.resources, 'blessed-blade')).toBe(2);
  });

  it('refuses a weapon the holder is not carrying', () => {
    const out = refusal('greatsword');
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('weapon_not_held');
  });

  it('refuses an id that is no weapon at all', () => {
    const out = refusal('arrow');
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('unknown_weapon');
  });

  it('will not choose which weapon for the holder', () => {
    const out = refusal(undefined);
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('weapon_required');
  });

  it('refuses a weapon named on a feature that imbues none', () => {
    const log = field();
    const out = activateFeature(
      at(log),
      TEMPLAR,
      { feature: 'human:heroic-inspiration', weapon: 'longsword' },
      content,
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).not.toBe('weapon_not_of_kind');
  });
});

describe('what a second use of the feature does to the first', () => {
  /** SRD Sacred Weapon: "or until you use this feature again". */
  it('moves the imbuing to the new weapon and spends a second use', () => {
    const once = imbued('longsword');
    const twice = [...once, ...imbue(once, 'dagger', 'second')];
    expect(ridersOn(twice).map((rider) => rider.weapon)).toEqual(['dagger']);
    expect(remaining(at(twice).creatures[TEMPLAR]!.resources, 'blessed-blade')).toBe(0);
    const hit = unwrap(swing(twice, 'longsword'), 'a swing');
    expect(contributionsOf(hit.events)['Blessed Blade']).toBeUndefined();
  });
});

describe('the imbuing ends with the activation, by every door', () => {
  it('takes the rider with it when the holder ends it early', () => {
    const log = imbued();
    const ended = [...log, ...unwrap(endFeature(at(log), TEMPLAR, { feature: BLESSED_BLADE }), 'end')];
    expect(ridersOn(ended)).toEqual([]);
  });

  it('takes the rider with it when the printed span runs out', () => {
    const log = imbued();
    const later = [...log, ...unwrap(advanceTime(at(log), 600, 'the ten minutes'), 'time')];
    expect(at(later).creatures[TEMPLAR]?.activeFeatures).not.toContain(BLESSED_BLADE);
    expect(ridersOn(later)).toEqual([]);
  });
});

describe('a rider ends when its weapon is no longer carried', () => {
  /**
   * SRD Sacred Weapon: "This effect also ends if you aren't carrying the
   * weapon." The activation goes with the rider, the light it shed goes with
   * the activation, and the use stays spent — nothing in the book gives it back.
   */
  it('ends the activation, the rider and the light, and refunds nothing', () => {
    const dropped = drop(imbued(), 'longsword');
    const state = at(dropped);
    expect(ridersOn(dropped)).toEqual([]);
    expect(state.creatures[TEMPLAR]?.activeFeatures).not.toContain(BLESSED_BLADE);
    expect(remaining(state.creatures[TEMPLAR]!.resources, 'blessed-blade')).toBe(1);
  });

  it('leaves the deadline behind it, so the next use is not cut short', () => {
    const dropped = drop(imbued(), 'longsword');
    expect(
      Object.values(at(dropped).timers).some(
        (timer) => timer.target.kind === 'feature' && timer.target.feature === BLESSED_BLADE,
      ),
    ).toBe(false);
  });

  it('runs on when something else is put down', () => {
    const dropped = drop(imbued(), 'dagger');
    expect(ridersOn(dropped).map((rider) => rider.weapon)).toEqual(['longsword']);
    expect(at(dropped).creatures[TEMPLAR]?.activeFeatures).toContain(BLESSED_BLADE);
  });

  it('puts the light out with it', () => {
    const lit = at(imbued());
    const here = { x: 200, y: 200, z: 0 };
    expect(lightAt(lit, here).level).toBe('bright');
    expect(lightAt(at(drop(imbued(), 'longsword')), here).level).toBeNull();
  });
});

// — the other half: a casting's rider ——————————————————————————————————————

const DRUID = id('druid');

/**
 * A caster with a Quarterstaff, a Club and a Mace, and the two SRD spells that
 * imbue one of them.
 */
const grove = (): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: DRUID,
    name: DRUID,
    sheet: {
      level: 1,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 18, cha: 10 },
      skills: {},
      saveProficiencies: [],
      armor: null,
      shield: null,
      armorTraining: { light: true, medium: true, heavy: true, shields: true },
      baseSpeed: 30,
      spellcastingAbility: 'wis',
      weaponProficiencies: ['simple', 'martial'],
    },
    maxHp: 40,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'party',
  },
  ...[1, 2, 3].map(
    (level): GameEvent => ({
      type: 'resource-pool-declared',
      id: DRUID,
      pool: {
        key: spellSlotKey(level),
        label: `level ${level} spell slot`,
        max: 4,
        recovers: 'long-rest',
      },
    }),
  ),
  {
    type: 'spellcasting-declared',
    id: DRUID,
    spellcasting: declaredCasting({
      ability: 'wis',
      cantrips: ['shillelagh'],
      prepared: ['magic-weapon'],
    }),
  },
  {
    type: 'items-gained',
    id: DRUID,
    items: [
      { id: 'quarterstaff', quantity: 1 },
      { id: 'club', quantity: 1 },
    ],
    source: 'the grove',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the stones', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the stones' }, feet: 0 } },
];

const druidSupply = (state: GameState) => ({
  issuer: createRollIssuer('d', state.rollsIssued),
  rng: scripted(15),
  content: SRD_CONTENT,
});

const grown = (log: readonly GameEvent[]): GameState => fold('the grove', log);

/**
 * Cast the spell, then restate its rider with the clause the definition cannot
 * yet print.
 *
 * SRD Shillelagh ends "if you let go of the weapon"; a `SpellDefinition` has
 * no field for that sentence and adding one is a change to the spell
 * vocabulary, which is another track's this batch. The rule underneath it is
 * the engine's and is what this asserts: a rider that says it ends when the
 * weapon is let go takes its casting with it, and one that does not — SRD
 * Magic Weapon, which prints no such clause — runs on.
 */
const castImbuing = (spellId: string, weapon: string, letGo: boolean): readonly GameEvent[] => {
  const log = grove();
  const cast = unwrap(
    resolveSpell(
      grown(log),
      DRUID,
      { spellId, targets: [DRUID], weapon, ...(spellId === 'magic-weapon' ? { slotLevel: 2 } : {}) },
      druidSupply(grown(log)),
    ),
    'the casting',
  ).events;
  const granted = cast.find((event) => event.type === 'weapon-rider-granted');
  if (granted?.type !== 'weapon-rider-granted') throw new Error('no rider was hung');
  return [
    ...log,
    ...cast,
    ...(letGo
      ? [
          {
            ...granted,
            rider: { ...granted.rider, endsWhenLetGo: true },
          } as GameEvent,
        ]
      : []),
  ];
};

const putDown = (log: readonly GameEvent[], item: string): readonly GameEvent[] => [
  ...log,
  ...unwrap(
    dropItem(grown(log), SRD_CONTENT, DRUID, { items: [{ id: item, quantity: 1 }] }),
    `dropping the ${item}`,
  ),
];

describe('a casting whose rider ends when the weapon is let go', () => {
  it('ends the whole casting, not merely the rider', () => {
    const log = castImbuing('shillelagh', 'quarterstaff', true);
    expect(Object.keys(grown(log).ongoing)).toHaveLength(1);
    const dropped = putDown(log, 'quarterstaff');
    expect(grown(dropped).creatures[DRUID]?.weaponRiders).toEqual([]);
    expect(Object.keys(grown(dropped).ongoing)).toEqual([]);
  });

  it('runs on when a different thing is put down', () => {
    const dropped = putDown(castImbuing('shillelagh', 'quarterstaff', true), 'club');
    expect(grown(dropped).creatures[DRUID]?.weaponRiders).toHaveLength(1);
    expect(Object.keys(grown(dropped).ongoing)).toHaveLength(1);
  });

  /**
   * And the spell that prints no such clause keeps running. SRD Magic Weapon
   * says "that weapon becomes a magic weapon" and nothing about letting go of
   * it, so a weapon put down is still enchanted when it is picked up again.
   */
  it('leaves a casting that never said so alone', () => {
    const dropped = putDown(castImbuing('magic-weapon', 'quarterstaff', false), 'quarterstaff');
    expect(grown(dropped).creatures[DRUID]?.weaponRiders).toHaveLength(1);
    expect(Object.keys(grown(dropped).ongoing)).toHaveLength(1);
  });
});
