import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap } from '@ie/shared';
import {
  activateFeature,
  checkCharacter,
  checkContent,
  createCharacter,
  createRng,
  createRollIssuer,
  equipItem,
  fold,
  itemInstanceFor,
  loseItems,
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
   * "a Simple or Martial **Melee** weapon of your choice" — a row of the
   * Weapons table, and not a magic weapon.
   *
   * A magic weapon is reached only by the other half of the sentence, "create a
   * bond with a magic weapon you touch", which prints two exclusions this
   * engine cannot check and which this feature therefore does not offer. A
   * conjuring that admitted one would be handing that half over for nothing,
   * at will, from level 1.
   */
  it.each(['vicious-weapon', 'frost-brand', 'defender'])(
    'refuses to conjure a %s, which is a magic item',
    (weapon) => {
      const refused = activateFeature(
        fold('seed', table()),
        WHO,
        { feature: FIEND, weapon, commandId: `magic-${weapon}` },
        SRD_CONTENT,
      );
      expect(refused.ok).toBe(false);
      expect(refused.ok ? '' : refused.code).toBe('weapon_is_magical');
    },
  );

  /**
   * "you can conjure a pact weapon **in your hand**", which is a hand a Warlock
   * has to have. The same question `resolveSpell` asks of Flame Blade, asked
   * before the Bonus Action is spent.
   */
  it('refuses to conjure a Glaive into hands that are full', () => {
    const full = [
      ...table(),
      {
        type: 'items-gained',
        id: WHO,
        items: [{ id: 'greatsword', quantity: 1 }],
        source: 'a gift',
      },
      { type: 'item-equipped', id: WHO, item: 'greatsword', armor: null },
    ] as GameEvent[];
    const refused = activateFeature(
      fold('seed', full),
      WHO,
      { feature: FIEND, weapon: 'glaive', commandId: 'full' },
      SRD_CONTENT,
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('no_free_hand');

    // And the two hands the Glaive takes are the Glaive's own: with nothing in
    // hand it appears, and a second conjuring then finds none free — until the
    // Bonus Action that ends the first bond frees them, which is the sentence
    // the book prints and the next test.
    const log = table();
    const held = [...log, ...conjure(fold('seed', log), 'glaive', 'one')];
    expect(fold('seed', held).creatures[WHO]?.inventory.find((l) => l.id === 'glaive')?.hands).toBe(
      2,
    );
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

  /**
   * "A conjured weapon disappears when the bond ends" — **that** weapon, and
   * not the one in the pack.
   *
   * A pact Longsword and a Longsword somebody bought are two lines with two
   * lifetimes, which is what `mergeKey` keys a conjured line by its bond for.
   * Merged into one stack they would be one line of two carrying the bond's
   * name, and the Warlock would lose their own sword with the pact weapon.
   */
  it('takes the weapon it conjured and leaves the one in the pack', () => {
    const log = [
      ...table(),
      {
        type: 'items-gained',
        id: WHO,
        items: [{ id: 'longsword', quantity: 1 }],
        source: 'bought in town',
      },
    ] as GameEvent[];
    const bonded = [...log, ...conjure(fold('seed', log), 'longsword', 'one')];
    expect(held(fold('seed', bonded), 'longsword')).toBe(2);

    const after = fold('seed', [...bonded, { type: 'creature-died', id: WHO }] as GameEvent[]);
    expect(held(after, 'longsword')).toBe(1);
    expect(after.creatures[WHO]?.inventory.some((line) => line.feature !== undefined)).toBe(false);
  });

  /**
   * And the one in the pack keeps being wielded, where it was.
   *
   * The fold takes a wielding away only when nothing that is left backs it:
   * `equipped` must never name something its holder does not own, and must go
   * on naming what they do.
   */
  it('leaves a wielded copy of the same weapon alone', () => {
    const log = [
      ...table(),
      {
        type: 'items-gained',
        id: WHO,
        items: [{ id: 'longsword', quantity: 1 }],
        source: 'bought in town',
      },
      { type: 'item-equipped', id: WHO, item: 'longsword', armor: null },
    ] as GameEvent[];
    const bonded = [...log, ...conjure(fold('seed', log), 'longsword', 'one')];

    const after = fold('seed', [...bonded, { type: 'creature-died', id: WHO }] as GameEvent[]);
    expect(after.creatures[WHO]?.equipped.map((one) => one.id)).toContain('longsword');
    expect(held(after, 'longsword')).toBe(1);
  });

  /**
   * And what the second line costs, pinned rather than discovered.
   *
   * Two lines of one kind are a question, and `copyNamed` refuses rather than
   * guessing — so the pack's Longsword cannot be dropped, given away or used
   * by the **kind's** name while a pact Longsword stands beside it. That is
   * the right answer: the alternative is the engine choosing which Longsword
   * the caller meant, and the one it chose wrongly would be the one that
   * vanishes. Swinging is untouched, because an attack names a weapon by its
   * catalogue id and never by its copy.
   *
   * What the conjured copy's own record changed is the test above: the pact
   * Longsword has a name of its own now, so the question has an answer for
   * one of the two. The pack's copy still has none, which is why this refusal
   * stands.
   */
  it('makes the kind ambiguous while the bond stands, and leaves the swing alone', () => {
    const log = [
      ...table(),
      {
        type: 'items-gained',
        id: WHO,
        items: [{ id: 'longsword', quantity: 1 }],
        source: 'bought in town',
      },
    ] as GameEvent[];
    const bonded = [...log, ...conjure(fold('seed', log), 'longsword', 'one')];
    const state = fold('seed', bonded);

    const refused = equipItem(state, SRD_CONTENT, WHO, 'longsword');
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('ambiguous_copy');

    // And the swing goes through, which is the half that matters at the table.
    expect(
      resolveAttack(
        state,
        WHO,
        { target: TARGET, weapon: 'longsword', commandId: 'swing' },
        supply('ambiguous'),
      ).ok,
    ).toBe(true);
  });

  /**
   * And the conjured weapon carries a record of its own, which is what makes
   * it nameable while its twin from the pack stands beside it.
   *
   * The item-instance door, asked by a feature: the id is computed from what
   * the log has issued, pinned on the event, and checked by the fold as the
   * next one — the same three steps a wand with charges goes through. So a
   * caller with two Longswords in front of them has a name for one of them,
   * and naming it takes that one and leaves the other.
   */
  it('gives what it conjures a record of its own, and the pack’s copy stays', () => {
    const log = [
      ...table(),
      {
        type: 'items-gained',
        id: WHO,
        items: [{ id: 'longsword', quantity: 1 }],
        source: 'bought in town',
      },
    ] as GameEvent[];
    const before = fold('seed', log);

    const events = conjure(before, 'longsword', 'one');
    const gained = events.find((event) => event.type === 'items-gained');
    const issued = itemInstanceFor(before.itemsIssued + 1);
    expect(gained?.type === 'items-gained' && gained.items[0]?.instance).toBe(issued);

    const bonded = [...log, ...events];
    const state = fold('seed', bonded);
    expect(state.itemsIssued).toBe(before.itemsIssued + 1);
    expect(held(state, 'longsword')).toBe(2);

    // The copy the caller means, where the kind of thing is a question:
    // `copyNamed` answers the record and the answer is the conjured one,
    // which is already in a hand.
    const named = equipItem(state, SRD_CONTENT, WHO, issued);
    expect(named.ok).toBe(false);
    expect(named.ok ? '' : named.code).toBe('already_in_hand');

    // And the name is enough to take it: the pact weapon goes and the one
    // bought in town is still in the pack.
    const taken = unwrap(
      loseItems(state, WHO, [{ id: 'longsword', quantity: 1, instance: issued }], 'a thief'),
      'lose',
    );
    const after = fold('seed', [...bonded, ...taken]);
    expect(held(after, 'longsword')).toBe(1);
    expect(after.creatures[WHO]?.inventory.find((line) => line.id === 'longsword')?.feature).toBe(
      undefined,
    );
  });

  /**
   * A conjured weapon is already in a hand, so there is nothing to take up.
   *
   * That is what makes `handsInUse` right: the line's own pinned hands are
   * added to what is worn, and a copy that could be both would be charged for
   * twice. SRD Flame Blade's blade answers the same way for the same reason.
   */
  it('refuses to equip what it conjured, which is already in hand', () => {
    const log = table();
    // A Mace, because the Warlock's starting kit holds a Sickle: two lines of
    // one kind is `ambiguous_copy`, which is a different answer to a different
    // question and would hide this one.
    const bonded = [...log, ...conjure(fold('seed', log), 'mace', 'one')];
    const refused = equipItem(fold('seed', bonded), SRD_CONTENT, WHO, 'mace');
    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.code).toBe('already_in_hand');
  });

  /**
   * And if a log assembled by hand puts one in the hand anyway, the wielding
   * goes with the weapon.
   *
   * The backstop rather than the rule — `equipItem` is the rule, and it
   * refuses — written because `equipped` naming something nobody owns charges
   * its hands for ever and `dropItem` cannot be asked to put down a weapon
   * that has ceased to exist.
   */
  it('takes a hand-written wielding with the weapon when the bond ends', () => {
    const log = table();
    const bonded = [
      ...log,
      ...conjure(fold('seed', log), 'glaive', 'one'),
      { type: 'item-equipped', id: WHO, item: 'glaive', armor: null },
    ] as GameEvent[];
    expect(fold('seed', bonded).creatures[WHO]?.equipped.map((one) => one.id)).toContain('glaive');

    const dead = [...bonded, { type: 'creature-died', id: WHO }] as GameEvent[];
    const after = fold('seed', dead);
    expect(after.creatures[WHO]?.inventory.some((line) => line.id === 'glaive')).toBe(false);
    expect(after.creatures[WHO]?.equipped.map((one) => one.id)).not.toContain('glaive');
    // And the armour the Warlock was actually wearing is untouched.
    expect(after.creatures[WHO]?.equipped.map((one) => one.id)).toContain('leather-armor');
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
   * The rows the validators grew with the feature.
   *
   * Each is a shape nothing downstream could recover from: an activation with
   * no deadline and no word saying so is a lifetime nobody wrote down, a
   * conjuring with no imbuing beside it has no narrowing to hold its weapon to
   * and hangs nothing on what appears, and an ability or a training that is not
   * one is arithmetic no reader can do.
   */
  it('refuses the shapes the new fields can be written wrong in', () => {
    const rewritten = (over: Record<string, unknown>): readonly string[] => {
      const warlock = JSON.parse(
        JSON.stringify(SRD_CONTENT.classes.find((one) => one.id === 'warlock')),
      ) as { features: { id: string; grants: Record<string, unknown>[] }[] };
      const feature = warlock.features.find((one) => one.id === FIEND)!;
      const index = feature.grants.findIndex((grant) => grant['kind'] === 'activated');
      feature.grants[index] = { ...feature.grants[index], ...over };
      return checkContent({ classes: [warlock as never] }).map(
        (problem) => `${problem.code} @ ${problem.field}`,
      );
    };
    const grantAt = (): string => {
      const warlock = SRD_CONTENT.classes.find((one) => one.id === 'warlock')!;
      const feature = warlock.features.find((one) => one.id === FIEND)!;
      const grants = feature.grants as readonly { readonly kind: string }[];
      return `classes[warlock].features[0].grants[${grants.findIndex((g) => g.kind === 'activated')}]`;
    };
    const at = grantAt();

    // One lifetime, in one of three spellings.
    expect(rewritten({ lastsSeconds: 600 })).toContain(`ambiguous_activation_span @ ${at}.lasts`);
    expect(rewritten({ lastsUntilEnded: undefined })).toContain(`no_activation_span @ ${at}.lasts`);
    expect(rewritten({ lastsUntilEnded: 'yes' })).toContain(
      `bad_activation_span @ ${at}.lastsUntilEnded`,
    );

    // A conjuring hangs on an imbuing.
    expect(rewritten({ imbuesWeapon: undefined })).toContain(
      `conjuring_without_an_imbuing @ ${at}.conjuresWeapon`,
    );

    // And the two clauses the imbuing grew.
    expect(rewritten({ imbuesWeapon: { offersAbility: 'luck' } })).toContain(
      `bad_imbued_weapon @ ${at}.imbuesWeapon.offersAbility`,
    );
    expect(rewritten({ imbuesWeapon: { grantsProficiency: 'sometimes' } })).toContain(
      `bad_imbued_weapon @ ${at}.imbuesWeapon.grantsProficiency`,
    );

    // And the catalogue as it stands says none of them. Filtered, because a
    // class judged on its own holds no spells: every `fixed` id it grants is
    // reported unknown, which is a fact about this fixture and not about the
    // feature — `content.test.ts` judges the catalogue whole.
    expect(
      rewritten({}).filter((said) => !said.startsWith('unknown_granted_spell')
        && !said.startsWith('unknown_free_casting')),
    ).toEqual([]);
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
