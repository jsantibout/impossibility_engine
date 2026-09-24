/**
 * SRD Oath of Devotion, Sacred Weapon — the two clauses beside the bonus.
 *
 * > "For 10 minutes or until you use this feature again, you add your Charisma
 * > modifier to attack rolls you make with that weapon (minimum bonus of +1),
 * > and **each time you hit with it, you cause it to deal its normal damage
 * > type or Radiant damage**. **The weapon also emits Bright Light in a
 * > 20-foot radius and Dim Light for an additional 20 feet.** You can end this
 * > effect early (no action required)."
 *
 * `sacred-weapon.test.ts` beside this one drives the first sentence — the use
 * out of the Channel Divinity pool, the ten minutes on the clock, the Charisma
 * modifier with its printed floor. This drives the other two.
 *
 * **Both are derived, and neither writes an event.** The light is a patch
 * carried by the holder and worked out on every read, beside a beetle's own
 * glow and never among the declared ones — so it moves when the Paladin moves,
 * and it is gone the instant the activation is, by whichever door the
 * activation left through. The damage type is answered per swing through
 * `AttackCommand.featureDamageTypes`, which is the door SRD Divine Strike's
 * "your choice" and SRD Shillelagh's "or the weapon's normal damage type"
 * already come through.
 */

import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  activateFeature,
  advanceTime,
  checkContent,
  createCharacter,
  createRollIssuer,
  endFeature,
  fold,
  lightAt,
  positionOf,
  resolveAttack,
  resolveAttackDamage,
  resolveMove,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type GameState,
  type Point,
  type Rng,
  type RngState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

const id = (s: string): CharacterId => asCharacterId(s);
const ARDAN = id('ardan');
const GHOUL = id('ghoul');
const SACRED_WEAPON = 'oath-of-devotion:sacred-weapon';
const SEED = 'the shrine';

const paladin = (): CharacterChoices =>
  ({
    name: 'Ardan',
    classId: 'paladin',
    level: 3,
    subclassId: 'oath-of-devotion',
    speciesId: 'human',
    backgroundId: 'acolyte',
    abilities: {
      method: 'standard-array',
      assignment: { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 15 },
    },
    abilityIncreases: { cha: 2, wis: 1 },
    classSkills: ['athletics', 'persuasion'],
    languages: ['Draconic', 'Elvish'],
    alignment: 'Lawful Good',
    cantrips: [],
    spellbook: [],
    preparedSpells: ['cure-wounds', 'heroism', 'divine-favor', 'bless'],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'human:versatile': { featId: 'alert' },
      'paladin:fighting-style': { featId: 'defense' },
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
  level: 3,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
});

/**
 * A Paladin on a dark shrine floor, a ghoul beside him, nobody has lit the room.
 *
 * `ghoulFeet` is how far off the ghoul stands, and it is a parameter for one
 * reason: a mover who leaves a hostile creature's reach only *declares* the
 * move and waits on the Opportunity Attack it provoked, so the test that walks
 * the Paladin across the room stands the ghoul out of reach rather than
 * settling a reaction it is not about.
 */
const field = (ghoulFeet = 5): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, paladin(), ARDAN), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: ARDAN, side: 'party' },
  {
    type: 'creature-added',
    id: GHOUL,
    name: 'a ghoul',
    sheet: plain(),
    maxHp: 60,
    diesAtZero: false,
    creatureType: 'Undead',
    side: 'undead',
  },
  {
    type: 'items-gained',
    id: ARDAN,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'shortbow', quantity: 1 },
      { id: 'arrow', quantity: 20 },
    ],
    source: 'the temple armoury',
  },
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 200, y: 200, z: 0 } },
  { type: 'creature-placed', id: ARDAN, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: GHOUL,
    placement: { from: { creature: ARDAN }, feet: ghoulFeet, bearing: 0 },
  },
];

/**
 * The d20 is whatever the test asks for and every die after it comes up on its
 * highest face — `weapon-rider.test.ts`'s rng, for its reason: a Longsword's
 * `1d8` is then 8, so which components were rolled is read off the total
 * rather than sampled.
 */
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
  content: SRD_CONTENT,
});

const imbued = (ghoulFeet = 5): readonly GameEvent[] => {
  const before = fold(SEED, field(ghoulFeet));
  return [
    ...field(ghoulFeet),
    ...unwrap(activateFeature(before, ARDAN, { feature: SACRED_WEAPON }), 'activate'),
  ];
};

const spaceOf = (state: GameState, who: CharacterId): Point => {
  const at = state.scene === null ? null : positionOf(state.scene, who);
  if (at === null) throw new Error(`${who} is not placed`);
  return at;
};

/** A point a stated number of feet east of the Paladin. */
const eastOfArdan = (state: GameState, feet: number): Point => {
  const at = spaceOf(state, ARDAN);
  return { x: at.x + feet, y: at.y, z: at.z };
};

const grantOf = (): Record<string, unknown> => {
  const oath = SRD_CONTENT.subclasses.find((one) => one.id === 'oath-of-devotion');
  const feature = oath?.features.find((one) => one.id === SACRED_WEAPON);
  const declared = feature?.grants;
  const grant = Array.isArray(declared) ? declared[0] : declared;
  if (grant === undefined) throw new Error('Sacred Weapon declares no grant');
  return grant as unknown as Record<string, unknown>;
};

const whileActive = (): readonly Record<string, unknown>[] =>
  (grantOf()['whileActive'] as readonly Record<string, unknown>[]) ?? [];

describe('SRD Sacred Weapon: "The weapon also emits Bright Light in a 20-foot radius"', () => {
  it('declares the light on the grant, both radii', () => {
    expect(whileActive()).toContainEqual({
      kind: 'light',
      level: 'bright',
      radius: 20,
      dimBeyond: 20,
    });
  });

  it('sheds nothing until the Paladin spends the Channel Divinity', () => {
    const state = fold(SEED, field());
    expect(lightAt(state, spaceOf(state, ARDAN)).level).toBeNull();
  });

  it('is bright to twenty feet and dim for twenty more', () => {
    const state = fold(SEED, imbued());
    expect(lightAt(state, spaceOf(state, ARDAN)).level).toBe('bright');
    expect(lightAt(state, eastOfArdan(state, 20)).level).toBe('bright');
    expect(lightAt(state, eastOfArdan(state, 25)).level).toBe('dim');
    expect(lightAt(state, eastOfArdan(state, 40)).level).toBe('dim');
    expect(lightAt(state, eastOfArdan(state, 45)).level).toBeNull();
  });

  /**
   * Nonmagical, which is the absence of a flag rather than a decision taken
   * here: the one rule that reads it compares *spell levels* to settle a
   * Darkness against a Daylight, and a feature has no level to compare with.
   * The six Illumination traits are read the same way.
   */
  it('names the Paladin as what lit the square, and claims no magic', () => {
    const state = fold(SEED, imbued());
    const here = lightAt(state, spaceOf(state, ARDAN));
    expect(here.patches.join(' ')).toContain(String(ARDAN));
    expect(here.magical).toBe(false);
  });

  /** The whole reason it is derived: the light goes where the Paladin goes. */
  it('moves with the Paladin, with nothing written down for the move', () => {
    const log = [...imbued(60)];
    const shrine: Point = { x: 200, y: 200, z: 0 };
    const thirtyOn: Point = { x: 230, y: 200, z: 0 };
    expect(lightAt(fold(SEED, log), shrine).level).toBe('bright');

    const state = fold(SEED, log);
    log.push(
      ...unwrap(
        resolveMove(
          state,
          ARDAN,
          {
            placement: { from: { landmark: 'the shrine' }, feet: 30, bearing: 90 },
            mode: 'walk',
          },
          supply(state),
        ),
        'walking away from the shrine',
      ).events,
    );

    expect(lightAt(fold(SEED, log), thirtyOn).level).toBe('bright');
    // Forty-five feet from where he now stands is unlit, and so is the shrine
    // he left: nothing had to remember to sweep a patch.
    expect(lightAt(fold(SEED, log), { x: 280, y: 200, z: 0 }).level).toBeNull();
  });

  /** SRD: "You can end this effect early (no action required)." */
  it('goes out when the Paladin ends the feature early', () => {
    const log = [...imbued()];
    const ended = [...log, ...unwrap(endFeature(fold(SEED, log), ARDAN, { feature: SACRED_WEAPON }), 'end')];
    const state = fold(SEED, ended);
    expect(state.creatures[ARDAN]?.activeFeatures).not.toContain(SACRED_WEAPON);
    expect(lightAt(state, spaceOf(state, ARDAN)).level).toBeNull();
  });

  /** And SRD's "For 10 minutes", which ends it with nobody deciding anything. */
  it('goes out when the ten minutes are up', () => {
    const log = [...imbued()];
    const later = [
      ...log,
      ...unwrap(advanceTime(fold(SEED, log), 600, 'the ten minutes'), 'time'),
    ];
    const state = fold(SEED, later);
    expect(state.creatures[ARDAN]?.activeFeatures).not.toContain(SACRED_WEAPON);
    expect(lightAt(state, spaceOf(state, ARDAN)).level).toBeNull();
  });
});

describe('SRD Sacred Weapon: "it deals its normal damage type or Radiant damage"', () => {
  const typesOf = (events: readonly GameEvent[]): readonly string[] => {
    const record = events.find((event) => event.type === 'damage-dice-recorded');
    if (record?.type !== 'damage-dice-recorded') throw new Error('no damage dice were recorded');
    return record.components.map((component) => component.type);
  };

  const swing = (
    log: readonly GameEvent[],
    weapon: string,
    damageTypes?: Record<string, string>,
  ) => {
    const state = fold(SEED, log);
    return resolveAttack(
      state,
      ARDAN,
      {
        target: GHOUL,
        weapon,
        free: true,
        ...(damageTypes === undefined ? {} : { featureDamageTypes: damageTypes }),
      },
      supply(state),
    );
  };

  it('declares the offer on the grant, narrowed to a Melee weapon', () => {
    expect(whileActive()).toContainEqual({
      kind: 'weapon-damage-type',
      damageTypes: ['radiant'],
      onlyWithWeapon: { weapons: [{ kind: 'melee' }] },
    });
  });

  it('deals the weapon’s own type where the swing names none', () => {
    expect(typesOf(unwrap(swing(imbued(), 'longsword'), 'a swing').events)).toEqual(['slashing']);
  });

  it('deals Radiant where the swing names it, in place of the weapon’s own', () => {
    const hit = unwrap(swing(imbued(), 'longsword', { [SACRED_WEAPON]: 'radiant' }), 'a swing');
    expect(typesOf(hit.events)).toEqual(['radiant']);
  });

  it('refuses a third type, before anything is spent', () => {
    const refused = swing(imbued(), 'longsword', { [SACRED_WEAPON]: 'necrotic' });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('bad_damage_type');
  });

  it('offers nothing while the feature is off', () => {
    const refused = swing(field(), 'longsword', { [SACRED_WEAPON]: 'radiant' });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_such_feature_choice');
  });

  /**
   * **And on the far side of a hold**, which is where the choice belongs for a
   * held blow: the type is named when the damage is rolled rather than when it
   * landed, so a Shield the ghoul answered with never reaches the question.
   */
  it('takes the type at the settlement of a held hit', () => {
    const log = [...imbued()];
    const held = unwrap(
      resolveAttack(
        fold(SEED, log),
        ARDAN,
        { target: GHOUL, weapon: 'longsword', free: true, hold: true },
        supply(fold(SEED, log)),
      ),
      'a held swing',
    );
    const landed = [...log, ...held.events];
    const settled = unwrap(
      resolveAttackDamage(
        fold(SEED, landed),
        ARDAN,
        { featureDamageTypes: { [SACRED_WEAPON]: 'radiant' } },
        supply(fold(SEED, landed)),
      ),
      'settling the hold',
    );
    expect(typesOf(settled.events)).toEqual(['radiant']);
  });

  /** "one **Melee** weapon": the Shortbow is not one, so it is offered nothing. */
  it('offers nothing on a ranged weapon', () => {
    const refused = swing(imbued(), 'shortbow', { [SACRED_WEAPON]: 'radiant' });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_such_feature_choice');
  });
});

/**
 * What a catalogue can write here that nothing downstream could recover from.
 *
 * Each member has one reader — `carriedLight` lays a sphere per radius,
 * `damageTypesOffered` gathers the types a swing may name — so a radius of
 * nothing and an offer of nothing are each a clause that validates, compiles
 * onto the sheet and is matched by nobody. Refused at authoring, where a
 * catalogue's mistakes belong, and on the spelling the SRD prints them in:
 * inside a feature the holder switches on.
 */
describe('the two clauses are refused at the door where they say nothing', () => {
  const rewritten = (whileActiveOver: readonly unknown[]): readonly string[] => {
    const oath = JSON.parse(
      JSON.stringify(SRD_CONTENT.subclasses.find((one) => one.id === 'oath-of-devotion')),
    ) as { features: { id: string; grants: Record<string, unknown> }[] };
    const feature = oath.features.find((one) => one.id === SACRED_WEAPON)!;
    feature.grants = { ...feature.grants, whileActive: whileActiveOver };
    return checkContent({ subclasses: [oath as never] }).map(
      (problem) => `${problem.code} @ ${problem.field}`,
    );
  };

  const at = 'subclasses[oath-of-devotion].features[1].grants.whileActive[0]';

  it('refuses a light of no radius, and one at a level the glossary does not print', () => {
    expect(rewritten([{ kind: 'light', level: 'bright', radius: 0 }])).toContain(
      `bad_light_radius @ ${at}.radius`,
    );
    expect(rewritten([{ kind: 'light', level: 'blinding', radius: 20 }])).toContain(
      `bad_light_level @ ${at}.level`,
    );
    expect(rewritten([{ kind: 'light', level: 'bright', radius: 20, dimBeyond: 2 }])).toContain(
      `bad_light_radius @ ${at}.dimBeyond`,
    );
  });

  it('refuses an offer of no damage types, which could never be answered', () => {
    expect(rewritten([{ kind: 'weapon-damage-type', damageTypes: [] }])).toContain(
      `offers_no_damage_type @ ${at}.damageTypes`,
    );
  });

  /**
   * And neither reaches an **item**, by name. A light on a worn thing is
   * gathered by nobody: `lightAt` reads the sheet alone and must, because
   * `requirementsHold` calls it and a reader that went back through the item's
   * grants would be asking a question of its own answer. An offer on a blade
   * would be the other failure and the worse one — it narrows by a *kind* of
   * weapon and has no "made with this item", so it would put Radiant on every
   * swing its wearer made with anything.
   */
  it('refuses both from an item, which reads neither', () => {
    const codesOf = (effect: unknown): readonly string[] =>
      checkContent({
        items: [
          {
            id: 'lantern-of-misplaced-hope',
            name: 'Lantern of Misplaced Hope',
            kind: 'wondrous',
            weightLb: 0,
            costCp: null,
            armor: null,
            weapon: null,
            contents: [],
            attunement: {},
            grants: [{ kind: 'standing', reach: 'self', effects: [effect] }],
          } as never,
        ],
      }).map((problem) => problem.code);

    expect(codesOf({ kind: 'light', level: 'bright', radius: 20 })).toContain('bad_item_effect');
    expect(codesOf({ kind: 'weapon-damage-type', damageTypes: ['radiant'] })).toContain(
      'bad_item_effect',
    );
  });
});
