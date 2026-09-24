import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import {
  activateFeature,
  checkCharacter,
  createCharacter,
  createRng,
  createRollIssuer,
  fold,
  resolveAttack,
  type CharacterChoices,
  type GameEvent,
  type GameState,
  type Rng,
} from '@ie/engine';

/**
 * SRD Pact of the Blade, the second of the two Pacts:
 *
 * > "As a Bonus Action, you can conjure a pact weapon in your hand—a Simple or
 * > Martial Melee weapon of your choice with which you bond—or create a bond
 * > with a magic weapon you touch ... Until the bond ends, you have proficiency
 * > with the weapon, and you can use it as a Spellcasting Focus. Whenever you
 * > attack with the bonded weapon, you can use your Charisma modifier for the
 * > attack and damage rolls instead of using Strength or Dexterity; and you can
 * > cause the weapon to deal Necrotic, Psychic, or Radiant damage or its normal
 * > damage type. Your bond with the weapon ends if you use this feature's Bonus
 * > Action again, if the weapon is more than 5 feet away from you for 1 minute
 * > or more, or if you die. A conjured weapon disappears when the bond ends."
 *
 * What is executed is the conjuring and everything the bond does: proficiency
 * in that one weapon, Charisma offered on both rolls, the three-type offer, and
 * the two endings that are facts about state — a second use of the Bonus Action
 * and death. The feature's own note says what is left: bonding a magic weapon
 * you touch, the five-feet-for-a-minute ending, and the Spellcasting Focus.
 */

const WHO = asCharacterId('kael');
const OTHER = asCharacterId('mira');
const TARGET = asCharacterId('ogre');
const FIEND = 'warlock:eldritch-invocations';

const base = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Kael',
  classId: 'warlock',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    // Strength 8 and Charisma 15: the offer is worth taking, which is what
    // makes "instead of using Strength" observable at all.
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
  },
  abilityIncreases: { con: 2, int: 1 },
  classSkills: ['arcana', 'deception'],
  languages: ['Draconic', 'Goblin'],
  alignment: 'Neutral Evil',
  subclassId: 'fiend-patron',
  cantrips: ['eldritch-blast', 'chill-touch', 'poison-spray'],
  spellbook: [],
  preparedSpells: ['hex', 'charm-person', 'hold-person', 'hypnotic-pattern', 'mind-spike', 'fear'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['leather-armor'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['fire-bolt', 'light'],
      levelOneSpell: 'magic-missile',
    },
    'human:versatile': { featId: 'alert' },
    'warlock:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const bladed = (over: Partial<CharacterChoices> = {}): CharacterChoices =>
  base({
    featureChoices: {
      'human:skillful': ['perception'],
      [FIEND]: [
        'Pact of the Blade',
        'Armor of Shadows',
        'Eldritch Mind',
        "Devil's Sight",
        'Fiendish Vigor',
      ],
    },
    ...over,
  });

const codes = (choices: CharacterChoices): readonly string[] =>
  checkCharacter(SRD_CONTENT, choices).map((problem) => problem.code);

const supply = (seed: string) => ({
  issuer: createRollIssuer(seed),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/** The Warlock, an ogre twenty feet away, and a fight that has begun. */
const table = (choices: CharacterChoices = bladed()): GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, choices, WHO), 'creation') as GameEvent[]),
  {
    type: 'creature-added',
    id: TARGET,
    name: 'an ogre',
    maxHp: 200,
    diesAtZero: true,
    creatureType: 'Giant',
    sheet: {
      level: 1,
      abilities: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
      skills: {},
      saveProficiencies: [],
      armor: null,
      shield: null,
      armorTraining: { light: false, medium: false, heavy: false, shields: false },
      baseSpeed: 40,
      spellcastingAbility: null,
      // Armour Class 1, so every swing lands and the damage is what is read.
      stated: { armorClass: 1, proficiencyBonus: 2, initiative: -1 },
    },
  },
  { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 } },
  { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: WHO, placement: { from: { landmark: 'the well' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: TARGET,
    placement: { from: { creature: WHO }, feet: 5, bearing: 90 },
  },
  { type: 'sight-declared', from: WHO, to: TARGET, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: WHO, initiative: 20, speed: 30 },
      { id: TARGET, initiative: 1, speed: 40 },
    ],
  },
];

const conjure = (state: GameState, weapon: string, commandId: string): GameEvent[] =>
  unwrap(
    activateFeature(state, WHO, { feature: FIEND, weapon, commandId }, SRD_CONTENT),
    `conjure ${weapon}`,
  );

/** Everything a swing took off the ogre, and of what type. */
const damage = (events: readonly GameEvent[]) =>
  events.filter(
    (event): event is Extract<GameEvent, { type: 'damage-taken' }> =>
      event.type === 'damage-taken' && event.id === TARGET,
  );

const held = (state: GameState, item: string): number =>
  (state.creatures[WHO]?.inventory ?? [])
    .filter((line) => line.id === item)
    .reduce((sum, line) => sum + line.quantity, 0);

describe('Pact of the Blade', () => {
  it('is an invocation a Warlock 1 may take, and prints no Prerequisite', () => {
    expect(codes(bladed())).toEqual([]);
  });

  /** "you can conjure a pact weapon in your hand" — as a Bonus Action. */
  it('conjures a Glaive as a Bonus Action', () => {
    const log = table();
    const before = fold('seed', log);
    expect(held(before, 'glaive')).toBe(0);

    const events = conjure(before, 'glaive', 'one');
    expect(events.some((event) => event.type === 'bonus-action-spent')).toBe(true);

    const after = fold('seed', [...log, ...events]);
    expect(held(after, 'glaive')).toBe(1);
    expect(after.creatures[WHO]?.activeFeatures).toContain(FIEND);
  });

  /** "a Simple or Martial **Melee** weapon of your choice." */
  it('refuses a Longbow, which is neither', () => {
    const refused = activateFeature(
      fold('seed', table()),
      WHO,
      { feature: FIEND, weapon: 'longbow', commandId: 'bow' },
      SRD_CONTENT,
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('weapon_not_of_kind');
  });

  /** And a thing that is not a weapon at all. */
  it('refuses a Torch', () => {
    const refused = activateFeature(
      fold('seed', table()),
      WHO,
      { feature: FIEND, weapon: 'torch', commandId: 'torch' },
      SRD_CONTENT,
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('unknown_weapon');
  });

  /**
   * And a weapon with charges of its own.
   *
   * A conjured line is a stack rather than a labelled copy, so a thing with a
   * record would arrive with a pool nobody declared and lose it the moment the
   * bond ended. The rule and the refusal are `checkContent`'s, which says the
   * same of a spell that conjures one: a thing that lasts exactly as long as
   * the magic that made it has nothing to remember.
   */
  it('refuses to conjure a Hammer of Thunderbolts, which keeps charges', () => {
    const refused = activateFeature(
      fold('seed', table()),
      WHO,
      { feature: FIEND, weapon: 'hammer-of-thunderbolts', commandId: 'hammer' },
      SRD_CONTENT,
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('conjured_item_has_charges');
  });

  /**
   * "Until the bond ends, you have proficiency with the weapon." A Warlock is
   * trained in Simple weapons and a Glaive is Martial, so the Proficiency
   * Bonus on the swing is the whole of what the bond added.
   */
  it('makes its holder proficient with the one weapon it bonded', () => {
    const log = table();

    const modifierOf = (events: readonly GameEvent[], weapon: string): number => {
      const swung = unwrap(
        resolveAttack(
          fold('seed', events),
          WHO,
          { target: TARGET, weapon, commandId: 'swing' },
          supply('one seed for every swing'),
        ),
        'swing',
      );
      const record = swung.events.find((event) => event.type === 'roll-recorded');
      if (record?.type !== 'roll-recorded') throw new Error('no roll was recorded');
      return record.contributions.reduce((sum, one) => sum + one.amount, 0);
    };

    /** The same weapon in the same hands, simply given rather than conjured. */
    const given = (item: string): GameEvent[] => [
      ...log,
      { type: 'items-gained', id: WHO, items: [{ id: item, quantity: 1 }], source: 'a gift' },
    ];
    const bonded = (item: string): GameEvent[] => [
      ...log,
      ...conjure(fold('seed', log), item, `bond-${item}`),
    ];

    // A **Glaive** is Martial and a Warlock is trained in Simple weapons only,
    // so the bond is worth two things at once: the Proficiency Bonus of +3 at
    // level 5, and the swap from Strength (−1) to Charisma (+2).
    expect(modifierOf(bonded('glaive'), 'glaive') - modifierOf(given('glaive'), 'glaive')).toBe(6);

    // A **Sickle** is Simple, so the Warlock was already proficient with it and
    // the bond is worth the ability alone. That is the half of the claim that
    // says the three points above were the training rather than anything else.
    expect(modifierOf(bonded('sickle'), 'sickle') - modifierOf(given('sickle'), 'sickle')).toBe(3);
  });

  /**
   * "you can use your Charisma modifier for the attack and damage rolls
   * instead of using Strength or Dexterity." Charisma 15 is +2 and Strength 8
   * is −1, so the offer is worth three points on the damage.
   */
  it('offers Charisma for the attack and the damage both', () => {
    const log = table();
    const bonded = [...log, ...conjure(fold('seed', log), 'glaive', 'one')];
    const given = [
      ...log,
      { type: 'items-gained', id: WHO, items: [{ id: 'glaive', quantity: 1 }], source: 'a gift' },
    ] as GameEvent[];

    const dealt = (events: readonly GameEvent[], seed: string): number =>
      damage(
        unwrap(
          resolveAttack(
            fold('seed', events),
            WHO,
            { target: TARGET, weapon: 'glaive', commandId: 'swing' },
            supply(seed),
          ),
          'swing',
        ).events,
      ).reduce((sum, event) => sum + event.amount, 0);

    expect(dealt(bonded, 'k') - dealt(given, 'k')).toBe(3);
  });

  /**
   * "you can cause the weapon to deal Necrotic, Psychic, or Radiant damage or
   * its normal damage type." Naming none deals the Glaive's Slashing.
   */
  it('offers three damage types and deals Slashing when none is named', () => {
    const log = table();
    const bonded = [...log, ...conjure(fold('seed', log), 'glaive', 'one')];

    const swing = (types?: Record<string, string>) =>
      unwrap(
        resolveAttack(
          fold('seed', bonded),
          WHO,
          {
            target: TARGET,
            weapon: 'glaive',
            commandId: 'swing',
            ...(types === undefined ? {} : { featureDamageTypes: types }),
          },
          supply('types'),
        ),
        'swing',
      );

    const typesOf = (events: readonly GameEvent[]): readonly string[] => {
      const record = events.find((event) => event.type === 'damage-dice-recorded');
      if (record?.type !== 'damage-dice-recorded') throw new Error('no damage dice were recorded');
      return record.components.map((component) => component.type);
    };

    expect(typesOf(swing().events)).toEqual(['slashing']);
    expect(typesOf(swing({ [FIEND]: 'psychic' }).events)).toEqual(['psychic']);
    expect(typesOf(swing({ [FIEND]: 'necrotic' }).events)).toEqual(['necrotic']);
    expect(typesOf(swing({ [FIEND]: 'radiant' }).events)).toEqual(['radiant']);

    const refused = resolveAttack(
      fold('seed', bonded),
      WHO,
      {
        target: TARGET,
        weapon: 'glaive',
        commandId: 'swing',
        featureDamageTypes: { [FIEND]: 'acid' },
      },
      supply('types'),
    );
    expect(refused.ok).toBe(false);
  });

  /**
   * "Your bond with the weapon ends if you use this feature's Bonus Action
   * again ... A conjured weapon disappears when the bond ends."
   */
  it('loses the Glaive when the Bonus Action is used again on a Longsword', () => {
    const log = table();
    const first = [...log, ...conjure(fold('seed', log), 'glaive', 'one')];
    // A fresh turn, so the Bonus Action is there to spend a second time.
    const round = [
      ...first,
      { type: 'turn-advanced' },
      { type: 'turn-advanced' },
    ] as GameEvent[];
    const second = [...round, ...conjure(fold('seed', round), 'longsword', 'two')];

    const after = fold('seed', second);
    expect(held(after, 'glaive')).toBe(0);
    expect(held(after, 'longsword')).toBe(1);
    // And the rider went with it: the Glaive is nobody's pact weapon now.
    expect(after.creatures[WHO]?.weaponRiders.map((rider) => rider.weapon)).toEqual(['longsword']);
  });

  /** "... or if you die." */
  it('loses the Glaive when the Warlock dies', () => {
    const log = table();
    const bonded = [...log, ...conjure(fold('seed', log), 'glaive', 'one')];
    const dead = [...bonded, { type: 'creature-died', id: WHO }] as GameEvent[];

    const after = fold('seed', dead);
    expect(after.creatures[WHO]?.activeFeatures ?? []).not.toContain(FIEND);
    expect(held(after, 'glaive')).toBe(0);
    expect(after.creatures[WHO]?.weaponRiders ?? []).toEqual([]);
  });

  /** A Warlock who never took the invocation has no such Bonus Action. */
  it('is not offered to a Warlock who took something else', () => {
    const other = base({
      featureChoices: {
        'human:skillful': ['perception'],
        [FIEND]: [
          'Misty Visions',
          'Armor of Shadows',
          'Eldritch Mind',
          "Devil's Sight",
          'Fiendish Vigor',
        ],
      },
    });
    const refused = activateFeature(
      fold('seed', table(other)),
      asCharacterId('kael'),
      { feature: FIEND, weapon: 'glaive', commandId: 'nope' },
      SRD_CONTENT,
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('no_such_feature');
  });

  /**
   * Two Warlocks with two Glaives are two bonds, and neither is the other's.
   *
   * **Out of combat on purpose**, because that is where the claim is: what the
   * engine keys a bond by is the holder and the weapon's catalogue id, so two
   * holders are two riders. What it cannot key a bond by is the *copy* — an
   * inventory line is a count of interchangeable things and an attack names a
   * weapon by its catalogue id — which is why the book's "you can't bond with a
   * magic weapon if ... another Warlock is bonded with it" is filed rather than
   * refused: refusing on the id would refuse two Warlocks with two Glaives.
   */
  it('binds one holder at a time and says nothing about anybody else', () => {
    const log = [
      ...(unwrap(createCharacter(SRD_CONTENT, bladed(), WHO), 'the first warlock') as GameEvent[]),
      ...(unwrap(
        createCharacter(SRD_CONTENT, { ...bladed(), name: 'Mira' }, OTHER),
        'the second warlock',
      ) as GameEvent[]),
    ];
    const first = [...log, ...conjure(fold('seed', log), 'glaive', 'one')];
    const second = unwrap(
      activateFeature(
        fold('seed', first),
        OTHER,
        { feature: FIEND, weapon: 'glaive', commandId: 'mira' },
        SRD_CONTENT,
      ),
      'the second bond',
    );

    const after = fold('seed', [...first, ...second]);
    expect(after.creatures[WHO]?.weaponRiders).toHaveLength(1);
    expect(after.creatures[OTHER]?.weaponRiders).toHaveLength(1);
  });
});
