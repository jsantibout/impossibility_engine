import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  activateDevice,
  armorClassOf,
  createCharacter,
  createDevice,
  damageCreature,
  dismantleDevice,
  dismissStrandedSummons,
  fold,
  strandedSummons,
  type CharacterChoices,
  type GameEvent,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * SRD Gnomish Lineage, Rock Gnome:
 *
 * > "you can spend 10 minutes casting Prestidigitation to create a Tiny
 * > clockwork device (AC 5, 1 HP), such as a toy, fire starter, or music box.
 * > When you create the device, you determine its function by choosing one
 * > effect from the Prestidigitation spell ... the device produces that effect
 * > whenever you or another creature takes a Bonus Action to activate it with
 * > a touch ... You can have three such devices in existence at a time, and
 * > each falls apart 8 hours after its creation or when it is dismantled by
 * > you or another creature. Each device also stops working if you die."
 *
 * A thing with an Armour Class and a hit point that nobody could make. The
 * object vocabulary was already here — `objects.ts` says an object arrives the
 * way a goblin does, with a stated sheet and no ability scores — and what was
 * missing was a **feature** that makes one. So the device is a `creature-added`
 * with the numbers the trait prints, a bond saying whose it is and how long it
 * stands, and a record of what it does, which is prose the table narrates.
 *
 * What the engine does **not** do is produce the effect: the function is one of
 * Prestidigitation's printed bullets, pinned at the making and handed back at
 * the Bonus Action. That is the same reading `take_printed_action` takes of a
 * stat block's sentence, and it is the honest one — the engine holds no soap,
 * no candle and no thimbleful of flavour.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const NIM = id('nim');
const BIRD = id('bird');
const BOX = id('box');
const TOP = id('top');
const FOURTH = id('fourth');
const THUG = id('thug');

const gnome = (): CharacterChoices =>
  ({
    name: 'Nim',
    classId: 'fighter',
    level: 1,
    speciesId: 'gnome',
    size: 'Small',
    backgroundId: 'soldier',
    abilities: {
      method: 'standard-array',
      assignment: { str: 15, dex: 13, con: 14, int: 12, wis: 10, cha: 8 },
    },
    abilityIncreases: { str: 2, dex: 1 },
    classSkills: ['acrobatics', 'animal-handling'],
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    cantrips: [],
    spellbook: [],
    preparedSpells: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'gnome:gnomish-lineage': ['Rock Gnome'] },
    featureSpellcasting: { 'gnome:gnomish-lineage': 'int' },
    feats: {
      'fighter:fighting-style': { featId: 'defense' },
      'soldier:savage-attacker': { featId: 'savage-attacker' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  }) as CharacterChoices;

const LINEAGE = 'gnome:gnomish-lineage';

/** SRD Prestidigitation's fire-starting bullet, which is what a fire starter is. */
const IGNITE = 'You instantaneously light or snuff out a candle, a torch, or a small campfire.';

const field = (): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, gnome(), NIM), 'create') as GameEvent[]),
  {
    type: 'creature-added',
    id: THUG,
    name: 'a thug',
    sheet: {
      level: 1,
      abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      skills: {},
      saveProficiencies: [],
      armor: null,
      shield: null,
      armorTraining: { light: false, medium: false, heavy: false, shields: false },
      baseSpeed: 30,
      spellcastingAbility: null,
    },
    maxHp: 20,
    diesAtZero: false,
    creatureType: 'Humanoid',
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the workshop', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: NIM, placement: { from: { landmark: 'the workshop' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: NIM }, feet: 5, bearing: 90 } },
];

/** Each one is put down on its own side of the Gnome, so three fit on the map. */
const BEARINGS: Readonly<Record<string, number>> = { bird: 0, box: 180, top: 270, fourth: 45 };

const made = (
  log: readonly GameEvent[],
  device: CharacterId,
  name: string,
  what = IGNITE,
  detail?: string,
): readonly GameEvent[] =>
  unwrap(
    createDevice(fold('seed', log), NIM, {
      feature: LINEAGE,
      device,
      name,
      function: what,
      ...(detail === undefined ? {} : { detail }),
      placement: { from: { creature: NIM }, feet: 5, bearing: BEARINGS[device] ?? 0 },
      commandId: `make-${device}`,
    }),
    'make the device',
  );

const withDevice = (device: CharacterId, name: string): readonly GameEvent[] => {
  const log = field();
  return [...log, ...made(log, device, name)];
};

describe('SRD Rock Gnome: a clockwork device with statistics of its own', () => {
  it('declares the making on the trait, with the numbers the book prints', () => {
    const species = SRD_CONTENT.species.find((one) => one.id === 'gnome');
    const feature = species?.features.find((one) => one.id === LINEAGE);
    const grants = Array.isArray(feature?.grants) ? feature.grants : [feature?.grants];
    const makes = grants.find((one) => one?.kind === 'creates-object');
    expect(makes).toBeDefined();
    if (makes === undefined || makes.kind !== 'creates-object') throw new Error('unreachable');
    expect(makes.onlyIfChoice).toBe('Rock Gnome');
    // "spend 10 minutes casting Prestidigitation", "(AC 5, 1 HP)", "Tiny",
    // "three such devices", "8 hours".
    expect(makes.castingSeconds).toBe(600);
    expect(makes.spell).toBe('prestidigitation');
    expect(makes.object).toEqual({ size: 'tiny', armorClass: 5, hitPoints: 1 });
    expect(makes.atOnce).toBe(3);
    expect(makes.lastsSeconds).toBe(8 * 3600);
    expect(makes.activation).toBe('bonus-action');
    expect(makes.functions.length).toBeGreaterThan(3);
    expect(feature?.automation).toBe('engine');
  });

  it('stands in the scene at AC 5 with one hit point, and the ten minutes are spent', () => {
    const before = fold('seed', field());
    const events = made(field(), BIRD, 'a tin bird');
    const state = fold('seed', [...field(), ...events]);

    const bird = state.creatures[BIRD];
    expect(bird).toBeDefined();
    expect(armorClassOf(state, BIRD)).toBe(5);
    expect(bird!.vitals.hpMax).toBe(1);
    expect(bird!.size).toBe('tiny');
    // SRD: "An object is destroyed when it has 0 Hit Points."
    expect(bird!.vitals.diesAtZero).toBe(true);
    // "spend 10 minutes casting Prestidigitation" — the price is on the clock.
    expect(state.elapsed).toBe(before.elapsed + 600);
    // And it is the Gnome's, on the terms the trait prints.
    expect(bird!.summonedBy).toMatchObject({ by: NIM, castingId: null });
  });

  it('breaks to a blow, and is owed a departure the moment it does', () => {
    const log = withDevice(BIRD, 'a tin bird');
    const hit = unwrap(
      damageCreature(fold('seed', log), BIRD, { amount: 3, source: 'a boot' }),
      'stamp on it',
    );
    const after = fold('seed', [...log, ...hit]);
    expect(after.creatures[BIRD]!.vitals.hp).toBe(0);
    expect(strandedSummons(after)).toContain(BIRD);
  });

  it('falls apart eight hours after its creation', () => {
    const log = withDevice(BIRD, 'a tin bird');
    const standing = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 8 * 3600 - 1, reason: 'the day goes by' },
    ]);
    expect(strandedSummons(standing)).toEqual([]);

    const lapsed = fold('seed', [
      ...log,
      { type: 'time-advanced', seconds: 8 * 3600, reason: 'the day goes by' },
    ]);
    expect(strandedSummons(lapsed)).toContain(BIRD);

    const swept = unwrap(dismissStrandedSummons(lapsed), 'sweep');
    expect(fold('seed', [...log, { type: 'time-advanced', seconds: 8 * 3600, reason: 'the day goes by' }, ...swept]).creatures[BIRD]).toBeUndefined();
  });

  it('is dismantled by anybody who can reach it, and leaves the game', () => {
    const log = withDevice(BIRD, 'a tin bird');
    const taken = unwrap(
      dismantleDevice(fold('seed', log), THUG, { device: BIRD, commandId: 'dismantle' }),
      'dismantle',
    );
    expect(fold('seed', [...log, ...taken]).creatures[BIRD]).toBeUndefined();
  });

  it('reports the function it was made with when a Bonus Action activates it', () => {
    const log = withDevice(BIRD, 'a tin bird');
    const used = unwrap(
      activateDevice(fold('seed', log), THUG, { device: BIRD, commandId: 'press' }),
      'press the button',
    );
    expect(used.function).toBe(IGNITE);
    expect(used.detail).toBeNull();

    // "If the chosen effect has options within it, you choose one of those
    // options for the device when you create it."
    const chosen = field();
    const box = [...chosen, ...made(chosen, BOX, 'a music box', IGNITE, 'it lights, never snuffs')];
    const again = unwrap(
      activateDevice(fold('seed', box), NIM, { device: BOX, commandId: 'wind' }),
      'wind it',
    );
    expect(again.detail).toBe('it lights, never snuffs');
  });

  it('refuses an effect the spell does not print', () => {
    const refused = createDevice(fold('seed', field()), NIM, {
      feature: LINEAGE,
      device: BIRD,
      name: 'a tin bird',
      function: 'it throws lightning',
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_such_function');
  });

  it('refuses a fourth device while three stand', () => {
    let log = field();
    for (const [device, name] of [
      [BIRD, 'a tin bird'],
      [BOX, 'a music box'],
      [TOP, 'a spinning top'],
    ] as const) {
      log = [...log, ...made(log, device, name)];
    }
    const refused = createDevice(fold('seed', log), NIM, {
      feature: LINEAGE,
      device: FOURTH,
      name: 'one too many',
      function: IGNITE,
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('too_many_devices');

    // And a fourth is allowed the moment one of the three is dismantled.
    const taken = unwrap(
      dismantleDevice(fold('seed', log), NIM, { device: TOP, commandId: 'dismantle-top' }),
      'dismantle',
    );
    const room = [...log, ...taken];
    expect(
      createDevice(fold('seed', room), NIM, {
        feature: LINEAGE,
        device: FOURTH,
        name: 'a replacement',
        function: IGNITE,
      }).ok,
    ).toBe(true);
  });

  /** "Each device also stops working if you die." */
  it('stops working when the gnome dies', () => {
    const log = withDevice(BIRD, 'a tin bird');
    const killed = fold('seed', [...log, { type: 'creature-died', id: NIM, cause: 'a rockfall' } as GameEvent]);
    const refused = activateDevice(killed, THUG, { device: BIRD, commandId: 'press' });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('device_stopped');
  });

  it('refuses to activate or dismantle anything that is not a device', () => {
    const log = withDevice(BIRD, 'a tin bird');
    const state = fold('seed', log);
    const pressed = activateDevice(state, NIM, { device: THUG, commandId: 'press-a-thug' });
    expect(isErr(pressed)).toBe(true);
    if (isErr(pressed)) expect(pressed.code).toBe('not_a_device');

    const taken = dismantleDevice(state, NIM, { device: THUG, commandId: 'dismantle-a-thug' });
    expect(isErr(taken)).toBe(true);
    if (isErr(taken)) expect(taken.code).toBe('not_a_device');
  });

  it('refuses a making by a Gnome whose lineage grants none', () => {
    const forest = fold(
      'seed',
      unwrap(
        createCharacter(
          SRD_CONTENT,
          {
            ...gnome(),
            featureChoices: { 'gnome:gnomish-lineage': ['Forest Gnome'] },
          } as CharacterChoices,
          NIM,
        ),
        'create',
      ) as GameEvent[],
    );
    const refused = createDevice(forest, NIM, {
      feature: LINEAGE,
      device: BIRD,
      name: 'a tin bird',
      function: IGNITE,
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) expect(refused.code).toBe('no_such_feature');
  });
});
