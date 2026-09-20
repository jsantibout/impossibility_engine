import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  addCreature,
  createCharacter,
  createContent,
  createRng,
  createRollIssuer,
  fold,
  remaining,
  usePoolOption,
  type CharacterChoices,
  type ClassDefinition,
  type GameEvent,
  type GameState,
  type Rng,
  type SubclassDefinition,
} from '@ie/engine';

/**
 * A subclass feature that adds a form to another feature's menu.
 *
 * The owner's ruling: **Channel Divinity is a shell with one shared pool**,
 * and each option is a form the shell takes. A level 3 Life Cleric has three
 * of them — Divine Spark, Turn Undead, Preserve Life — drawing on one pool,
 * spent in any combination. So Preserve Life is not a pool of its own and not
 * a use of its own; it is a **door onto a menu the base feature prints**, and
 * the door is what was missing: a pool grant carries its own options and no
 * grant could hand one to a feature declared somewhere else.
 *
 * And what the door delivers here is SRD Preserve Life:
 *
 * > "As a Magic action, you present your Holy Symbol and evoke healing energy
 * > that can restore a number of Hit Points equal to five times your Cleric
 * > level. Choose Bloodied creatures within 30 feet of yourself (which can
 * > include you), and divide those Hit Points among them. This feature can
 * > restore a creature to no more than half its Hit Point maximum. You can't
 * > use this feature on an Undead or a Construct."
 *
 * A budget off the class table, a reach, a cap, and a list of shares the
 * caller divides — which is the one thing about the use the engine cannot
 * decide, exactly as the slot a trade burns is the caster's to name.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const BRANNOR = id('brannor');
const NEAR = id('near-knight');
const ALSO_NEAR = id('also-near-knight');
const FAR = id('far-knight');
const RISEN = id('risen');

const cleric = (level: number): CharacterChoices => ({
  name: 'Brannor',
  classId: 'cleric',
  level,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 14, dex: 12, con: 13, int: 10, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['insight', 'religion'],
  languages: ['Dwarvish', 'Giant'],
  alignment: 'Lawful Good',
  subclassId: 'life-domain',
  cantrips: ['sacred-flame', 'guidance', 'light', 'thaumaturgy'].slice(0, level >= 4 ? 4 : 3),
  spellbook: [],
  preparedSpells: [
    'inflict-wounds',
    'healing-word',
    'bane',
    'blindness-deafness',
    'hold-person',
    'guiding-bolt',
    'aid',
    'lesser-restoration',
    'spiritual-weapon',
    'revivify',
  ].slice(0, level >= 6 ? 10 : 6),
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-shirt', 'shield'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'cleric:divine-order': ['Protector'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    ...(level >= 4 ? { 'cleric:ability-score-improvement': { featId: 'savage-attacker' } } : {}),
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const supply = () => ({
  issuer: createRollIssuer('r'),
  rng: createRng('preserve') as Rng,
  content: SRD_CONTENT,
});

/** A room, four landmarks, and whoever is standing on each. */
const SCENE: readonly GameEvent[] = [
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the altar', at: { x: 50, y: 50, z: 0 } },
  { type: 'landmark-added', name: 'the pew', at: { x: 50, y: 70, z: 0 } },
  { type: 'landmark-added', name: 'the font', at: { x: 50, y: 75, z: 0 } },
  { type: 'landmark-added', name: 'the door', at: { x: 50, y: 110, z: 0 } },
];

const placed = (who: CharacterId, landmark: string): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { landmark }, feet: 0 },
});

const hurt = (who: CharacterId, amount: number): GameEvent => ({
  type: 'damage-taken',
  id: who,
  amount,
  source: 'the ogre',
});

/** The Cleric, three Knights and a Skeleton, all standing somewhere. */
const assembled = (level: number): readonly GameEvent[] => {
  const log: GameEvent[] = [
    ...(unwrap(createCharacter(SRD_CONTENT, cleric(level), BRANNOR), 'create') as GameEvent[]),
    ...SCENE,
  ];
  for (const [who, monster] of [
    [NEAR, 'knight'],
    [ALSO_NEAR, 'knight'],
    [FAR, 'knight'],
    [RISEN, 'skeleton'],
  ] as const) {
    const added = unwrap(addCreature(fold('seed', log), SRD_CONTENT, who, monster), monster);
    log.push(...(added.events as GameEvent[]));
  }
  log.push(
    placed(BRANNOR, 'the altar'),
    placed(NEAR, 'the pew'),
    placed(ALSO_NEAR, 'the font'),
    placed(FAR, 'the door'),
    placed(RISEN, 'the pew'),
  );
  return log;
};

const hp = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hp;
const hpMax = (state: GameState, who: CharacterId): number => state.creatures[who]!.vitals.hpMax;

const use = (
  state: GameState,
  option: string,
  over: Record<string, unknown> = {},
) =>
  usePoolOption(
    state,
    BRANNOR,
    { feature: 'cleric:channel-divinity', option, ...over },
    supply(),
  );

describe('a level 3 Life Cleric holds three forms on one pool', () => {
  const sheet = () =>
    fold('seed', assembled(3)).creatures[BRANNOR]!.sheet;

  /**
   * SRD's "you can use it in the following ways", with the Life Domain's own
   * way on the same list. Divine Spark is one printed option offered as two,
   * because "either ... or" is a choice made at the moment of use — which is
   * the Cleric file's own reading and not this feature's business.
   */
  it('offers Preserve Life beside Turn Undead and Divine Spark', () => {
    const offered = (sheet().poolOptions ?? []).filter(
      (one) => one.feature === 'cleric:channel-divinity',
    );
    expect(offered.map((one) => one.option).sort()).toEqual([
      'divine-spark-harm',
      'divine-spark-restore',
      'preserve-life',
      'turn-undead',
    ]);
  });

  /** One pool, and the subclass's form is priced in it like the rest. */
  it('prices every form in the Channel Divinity pool', () => {
    const offered = sheet().poolOptions ?? [];
    expect([...new Set(offered.map((one) => one.pool))]).toEqual(['channel-divinity']);
  });

  /**
   * The menu belongs to the base feature, so the command that spends a use
   * names **Channel Divinity** and not the subclass feature that added the
   * form.
   */
  it('files the form under the feature whose menu it joined', () => {
    const preserve = (sheet().poolOptions ?? []).find((one) => one.option === 'preserve-life');
    expect(preserve?.feature).toBe('cleric:channel-divinity');
    expect(preserve?.featureName).toBe('Channel Divinity');
  });
});

describe('Preserve Life divides a pool of hit points', () => {
  /** "five times your Cleric level" — fifteen at level 3, thirty at six. */
  it('mints five hit points per Cleric level', () => {
    const at = (level: number) =>
      (fold('seed', assembled(level)).creatures[BRANNOR]!.sheet.poolOptions ?? []).find(
        (one) => one.option === 'preserve-life',
      )?.distributes?.hitPoints;
    expect(at(3)).toBe(15);
    expect(at(6)).toBe(30);
  });

  /** "divide those Hit Points among them", and the division is the caller's. */
  it('restores what the caller divided, one use for the lot', () => {
    const log = [...assembled(3), hurt(NEAR, 40), hurt(ALSO_NEAR, 42)];
    const before = fold('seed', log);
    expect(hp(before, NEAR)).toBe(hpMax(before, NEAR) - 40);

    const done = unwrap(
      use(before, 'preserve-life', {
        among: [
          { target: NEAR, hitPoints: 10 },
          { target: ALSO_NEAR, hitPoints: 5 },
        ],
      }),
      'preserve',
    );
    const now = fold('seed', [...log, ...(done.events as GameEvent[])]);

    expect(hp(now, NEAR)).toBe(hp(before, NEAR) + 10);
    expect(hp(now, ALSO_NEAR)).toBe(hp(before, ALSO_NEAR) + 5);
    expect(remaining(now.creatures[BRANNOR]!.resources, 'channel-divinity')).toBe(1);
  });

  /** "within 30 feet of yourself" — sixty is not thirty. */
  it('refuses a creature past its reach', () => {
    const log = [...assembled(3), hurt(FAR, 40)];
    const refused = use(fold('seed', log), 'preserve-life', {
      among: [{ target: FAR, hitPoints: 10 }],
    });
    expect(isErr(refused) && refused.code).toBe('out_of_reach');
  });

  /** "can restore a creature to no more than half its Hit Point maximum." */
  it('refuses a share that would carry a creature past the cap', () => {
    // A Knight on 20 of 52 is six short of half its maximum.
    const log = [...assembled(3), hurt(NEAR, 32)];
    const state = fold('seed', log);
    expect(hp(state, NEAR)).toBe(20);

    const refused = use(state, 'preserve-life', {
      among: [{ target: NEAR, hitPoints: 10 }],
    });
    expect(isErr(refused) && refused.code).toBe('past_the_cap');

    // And exactly to the cap is legal, which is what makes the refusal a cap
    // rather than an off-by-one.
    const done = unwrap(
      use(state, 'preserve-life', { among: [{ target: NEAR, hitPoints: 6 }] }),
      'to the cap',
    );
    const now = fold('seed', [...log, ...(done.events as GameEvent[])]);
    expect(hp(now, NEAR)).toBe(Math.floor(hpMax(now, NEAR) / 2));
  });

  /**
   * A creature already above half its maximum has no room at all, which is the
   * same line "Choose **Bloodied** creatures" draws — so the sentence needs no
   * check of its own.
   */
  it('refuses a creature that is not Bloodied, because it has no room', () => {
    const refused = use(fold('seed', assembled(3)), 'preserve-life', {
      among: [{ target: NEAR, hitPoints: 1 }],
    });
    expect(isErr(refused) && refused.code).toBe('past_the_cap');
  });

  /** "You can't use this feature on an Undead or a Construct." */
  it('refuses an Undead', () => {
    const log = [...assembled(3), hurt(RISEN, 10)];
    const refused = use(fold('seed', log), 'preserve-life', {
      among: [{ target: RISEN, hitPoints: 2 }],
    });
    expect(isErr(refused) && refused.code).toBe('cannot_be_restored');
  });

  /** The budget is a budget: the shares are added up before any is paid. */
  it('refuses a division that adds up to more than it mints', () => {
    const log = [...assembled(3), hurt(NEAR, 40), hurt(ALSO_NEAR, 42)];
    const refused = use(fold('seed', log), 'preserve-life', {
      among: [
        { target: NEAR, hitPoints: 10 },
        { target: ALSO_NEAR, hitPoints: 10 },
      ],
    });
    expect(isErr(refused) && refused.code).toBe('too_much_divided');
  });

  /** A share of nothing buys nothing, and half a hit point is not a thing. */
  it('refuses a share that is not a whole number of at least one', () => {
    const state = fold('seed', [...assembled(3), hurt(NEAR, 40)]);
    for (const hitPoints of [0, -1, 2.5]) {
      const refused = use(state, 'preserve-life', { among: [{ target: NEAR, hitPoints }] });
      expect(isErr(refused) && refused.code).toBe('bad_share');
    }
  });

  /** One creature takes one share, or the cap is measured against the wrong total. */
  it('refuses a creature named twice', () => {
    const state = fold('seed', [...assembled(3), hurt(NEAR, 40)]);
    const refused = use(state, 'preserve-life', {
      among: [
        { target: NEAR, hitPoints: 2 },
        { target: NEAR, hitPoints: 3 },
      ],
    });
    expect(isErr(refused) && refused.code).toBe('duplicate_share');
  });

  /** A form that divides hit points is not one that aims at a creature. */
  it('refuses a target where it asks for a division', () => {
    const refused = use(fold('seed', assembled(3)), 'preserve-life', { target: NEAR });
    expect(isErr(refused) && refused.code).toBe('division_required');
  });

  /** And the other way: nothing else on the menu divides anything. */
  it('refuses a division on a form that mints nothing to divide', () => {
    const refused = use(fold('seed', assembled(3)), 'turn-undead', {
      among: [{ target: NEAR, hitPoints: 1 }],
    });
    expect(isErr(refused) && refused.code).toBe('nothing_to_divide');
  });
});

describe('a level 6 Life Cleric spends its uses in any combination', () => {
  const log = () => [...assembled(6), hurt(NEAR, 40), hurt(ALSO_NEAR, 42)];

  /**
   * One pool, three forms, and nothing in the engine that says a subclass's
   * form is a different currency from the base feature's.
   */
  it('spends one use on Preserve Life and one on Divine Spark', () => {
    const first = log();
    const preserved = unwrap(
      use(fold('seed', first), 'preserve-life', {
        among: [{ target: NEAR, hitPoints: 10 }],
      }),
      'preserve',
    );
    const second = [...first, ...(preserved.events as GameEvent[])];

    const sparked = unwrap(
      use(fold('seed', second), 'divine-spark-restore', {
        target: ALSO_NEAR,
        commandId: 'spark',
      }),
      'spark',
    );
    const now = fold('seed', [...second, ...(sparked.events as GameEvent[])]);

    // A level 6 Cleric has three uses, and two of them are gone.
    expect(remaining(now.creatures[BRANNOR]!.resources, 'channel-divinity')).toBe(1);
  });

  /** And twice on the same form, which a shared pool has no reason to refuse. */
  it('spends two uses on Preserve Life alone', () => {
    const first = log();
    const once = unwrap(
      use(fold('seed', first), 'preserve-life', {
        among: [{ target: NEAR, hitPoints: 10 }],
      }),
      'first',
    );
    const second = [...first, ...(once.events as GameEvent[])];

    const twice = unwrap(
      use(fold('seed', second), 'preserve-life', {
        among: [{ target: ALSO_NEAR, hitPoints: 10 }],
        commandId: 'again',
      }),
      'second',
    );
    const now = fold('seed', [...second, ...(twice.events as GameEvent[])]);

    expect(remaining(now.creatures[BRANNOR]!.resources, 'channel-divinity')).toBe(1);
    expect(hp(now, NEAR)).toBe(12 + 10);
    expect(hp(now, ALSO_NEAR)).toBe(10 + 10);
  });
});

describe('a form is refused when the menu it joins is not held', () => {
  /**
   * The failure `feature-schema.ts` exists to catch, one grant along: a
   * subclass feature that names a menu nobody prints, or one its holder does
   * not have yet, is a line on a class table that looks executed and is
   * inert. `free_casting_pool_arrives_later` is the same rule about a pool,
   * written the day a free casting could be spent before its pool existed.
   */
  const table = Array.from({ length: 20 }, (_unused, index) => ({
    level: index + 1,
    proficiencyBonus: 2,
  }));

  const HOST: ClassDefinition = {
    id: 'oracle',
    name: 'Oracle',
    primaryAbility: 'wis',
    hitDie: 8,
    multiclass: {
      weapons: [],
      armorTraining: { light: false, medium: false, heavy: false, shields: false },
      tools: [],
    },
    saveProficiencies: ['wis', 'cha'],
    skillChoices: { choose: 1, from: ['insight'] },
    weaponProficiencies: ['simple'],
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    subclassLevel: 3,
    table,
    startingEquipment: [{ option: 'A', items: [], goldPieces: 10 }],
    features: [
      {
        id: 'oracle:visions',
        name: 'Visions',
        // The menu arrives at level 5 — later than the subclass form below.
        level: 5,
        automation: 'engine',
        note: 'A pool of visions, with one thing a use buys.',
        grants: {
          kind: 'pool',
          key: 'visions',
          label: 'Visions',
          minimum: 2,
          recovers: 'long-rest',
          options: [
            {
              id: 'foresee',
              name: 'Foresee',
              action: 'action',
              effects: [{ kind: 'heal', healing: { flat: 3 }, addSpellcastingModifier: false }],
            },
          ],
        },
      },
    ],
  };

  const subclassAt = (level: number): SubclassDefinition => ({
    id: 'seers',
    name: 'Seers',
    classId: 'oracle',
    features: [
      {
        id: 'seers:second-sight',
        name: 'Second Sight',
        level,
        automation: 'engine',
        note: 'A form the Visions menu takes.',
        grants: {
          kind: 'pool-options',
          feature: 'oracle:visions',
          options: [
            {
              id: 'second-sight',
              name: 'Second Sight',
              action: 'action',
              effects: [{ kind: 'heal', healing: { flat: 5 }, addSpellcastingModifier: false }],
            },
          ],
        },
      },
    ],
  });

  const loaded = (subclass: SubclassDefinition) =>
    createContent({
      ...SRD_CONTENT,
      classes: [...SRD_CONTENT.classes, HOST],
      subclasses: [...SRD_CONTENT.subclasses, subclass],
    });

  /** The form arrives at 3 and the menu at 5, so two levels of it are inert. */
  it('refuses a form offered before the menu it joins exists', () => {
    const refused = loaded(subclassAt(3));
    expect(isErr(refused) && refused.code).toBe('invalid_content');
    expect(isErr(refused) && refused.reason).toContain(
      'arrives at level 3 and joins a menu oracle:visions does not print until 5',
    );
  });

  /** And a form that names a feature nothing in scope prints at all. */
  it('refuses a form that names a menu nobody prints', () => {
    const stray = subclassAt(5);
    const refused = loaded({
      ...stray,
      features: [
        {
          ...stray.features[0]!,
          grants: {
            kind: 'pool-options',
            feature: 'oracle:dreams',
            options: [
              {
                id: 'second-sight',
                name: 'Second Sight',
                action: 'action',
                effects: [{ kind: 'heal', healing: { flat: 5 }, addSpellcastingModifier: false }],
              },
            ],
          },
        },
      ],
    });
    expect(isErr(refused) && refused.code).toBe('invalid_content');
    expect(isErr(refused) && refused.reason).toContain(
      'no feature of subclasses[seers] declares a pool by that name',
    );
  });

  /** The arrangement the SRD's own subclass is in loads, which is the control. */
  it('accepts a form offered at the level the menu arrives', () => {
    expect(loaded(subclassAt(5)).ok).toBe(true);
  });
});
