import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { armorClass, type CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';

/**
 * A weapon attack the engine runs, rather than one a caller assembles.
 *
 * `rollAttack` has existed since attacks landed and it is pure: hand it a
 * sheet, a target Armour Class, some modes and some bonuses, and it rolls
 * correctly. What it cannot do is *find* any of those, so every one of them
 * was the caller's to work out — which meant nothing in the engine ever
 * checked them, and a fixture could quietly attack a target fifty feet away
 * with a longsword.
 *
 * `resolveAttack` derives all of it from state and spends what the attack
 * costs: the target's Armour Class and cover, both creatures' conditions —
 * after a feature has had its say about which of them bite — the distance and
 * what the weapon can reach, whether an enemy is close enough to hamper a bow,
 * and whether the attacker is even proficient with what they are holding.
 *
 * It is also the hook a pile of class features have been waiting on. Rage
 * Damage, Sneak Attack and Radiant Strikes all add damage to a weapon's roll,
 * and none of them could, because no weapon attack passed through the engine.
 */

const id = (s: string) => asCharacterId(s);
const FIGHTER = id('fighter');
const GOBLIN = id('goblin');
const ALLY = id('ally');

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  weaponProficiencies: ['simple', 'martial'],
  ...over,
});

const added = (
  who: CharacterId,
  side: string,
  over: Partial<CharacterSheet> = {},
  maxHp = 40,
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(over),
  maxHp,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const at = (who: CharacterId, feet: number, bearing: number): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: FIGHTER }, feet, bearing },
});

const SETUP: readonly GameEvent[] = [
  added(FIGHTER, 'party'),
  added(GOBLIN, 'goblins', { abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 } }, 20),
  added(ALLY, 'party'),
  {
    type: 'items-gained',
    id: FIGHTER,
    items: [
      { id: 'longsword', quantity: 1 },
      { id: 'glaive', quantity: 1 },
      { id: 'longbow', quantity: 1 },
      { id: 'dagger', quantity: 1 },
    ],
    source: 'kit',
  },
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 500, y: 500, z: 0 } },
  { type: 'creature-placed', id: FIGHTER, placement: { from: { landmark: 'the road' }, feet: 0 } },
  at(GOBLIN, 5, 0),
  at(ALLY, 5, 180),
];

const base = (): GameState => fold('seed', SETUP);

/** The same table, with a fighter trained only in Simple weapons. */
const simpleOnly = (): readonly GameEvent[] =>
  SETUP.map((e) =>
    e.type === 'creature-added' && e.id === FIGHTER
      ? { ...e, sheet: sheet({ weaponProficiencies: ['simple'] }) }
      : e,
  );
const supply = (seed = 'swing') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng });

/** Swing, and hand back the events and the state they fold to. */
const swing = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveAttack>[2],
  seed = 'swing',
) => {
  const out = unwrap(resolveAttack(fold('seed', log), FIGHTER, request, supply(seed)), 'attack');
  const next = [...log, ...out.events];
  return { ...out, log: next, state: fold('seed', next) };
};

describe('the attack finds its own numbers', () => {
  it('rolls against the target’s own Armour Class', () => {
    const out = swing(SETUP, { target: GOBLIN, weapon: 'longsword' });
    expect(out.attack!.targetAc).toBe(armorClass(base().creatures.goblin!.sheet));
  });

  /** SRD: Half Cover is +2 to AC, Three-Quarters +5. */
  it('adds declared cover to the Armour Class it rolls against', () => {
    const behind: readonly GameEvent[] = [
      ...SETUP,
      { type: 'cover-declared', from: FIGHTER, to: GOBLIN, degree: 'three-quarters' },
    ];
    const bare = swing(SETUP, { target: GOBLIN, weapon: 'longsword' });
    const covered = swing(behind, { target: GOBLIN, weapon: 'longsword' });
    expect(covered.attack!.targetAc - bare.attack!.targetAc).toBe(5);
  });

  /** SRD Total Cover: the target "can't be targeted directly". */
  it('refuses a target behind Total Cover', () => {
    const out = resolveAttack(
      fold('seed', [
        ...SETUP,
        { type: 'cover-declared', from: FIGHTER, to: GOBLIN, degree: 'total' },
      ]),
      FIGHTER,
      { target: GOBLIN, weapon: 'longsword' },
      supply(),
    );
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('total_cover');
  });

  it('deals the weapon’s own damage, and takes it off the target', () => {
    const out = swing(SETUP, { target: GOBLIN, weapon: 'longsword' }, 'hit');
    expect(out.attack!.hit).toBe(true);
    expect(out.damage).toBeGreaterThan(0);
    expect(out.state.creatures.goblin!.vitals.hp).toBe(20 - out.damage!);
  });

  /** The target's defences are the creature's, not the caller's. */
  it('halves the damage a resistant target takes', () => {
    const resistant: readonly GameEvent[] = SETUP.map((e) =>
      e.type === 'creature-added' && e.id === GOBLIN
        ? { ...e, defenses: { slashing: { resistant: true } } }
        : e,
    );
    const bare = swing(SETUP, { target: GOBLIN, weapon: 'longsword' }, 'hit');
    const tough = swing(resistant, { target: GOBLIN, weapon: 'longsword' }, 'hit');
    expect(tough.damage).toBe(Math.floor(bare.damage! / 2));
  });
});

describe('reach and range are measured, not asserted', () => {
  /** SRD: a melee weapon reaches 5 feet. */
  it('refuses a melee swing at something ten feet away', () => {
    const far: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === GOBLIN)),
      at(GOBLIN, 10, 0),
    ];
    const out = resolveAttack(fold('seed', far), FIGHTER, { target: GOBLIN, weapon: 'longsword' }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('out_of_reach');
  });

  /** SRD Reach: "adds 5 feet to your reach when you attack with it." */
  it('lets a Reach weapon hit at ten feet', () => {
    const far: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === GOBLIN)),
      at(GOBLIN, 10, 0),
    ];
    expect(isErr(resolveAttack(fold('seed', far), FIGHTER, { target: GOBLIN, weapon: 'glaive', twoHanded: true }, supply()))).toBe(false);
  });

  /** SRD: "Disadvantage when your target is beyond normal range." */
  it('takes Disadvantage beyond a bow’s normal range', () => {
    const distant: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === GOBLIN)),
      at(GOBLIN, 200, 0),
    ];
    const out = swing(distant, { target: GOBLIN, weapon: 'longbow', twoHanded: true });
    expect(out.attack!.mode).toBe('disadvantage');
  });

  /** And beyond long range it is not an attack at all. */
  it('refuses a shot beyond long range', () => {
    const gone: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === GOBLIN)),
      at(GOBLIN, 700, 0),
    ];
    const out = resolveAttack(fold('seed', gone), FIGHTER, { target: GOBLIN, weapon: 'longbow', twoHanded: true }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('out_of_range');
  });

  /**
   * SRD: a ranged attack has Disadvantage while "an enemy is within 5 feet of
   * you". The goblin standing next to the fighter is exactly that, and the
   * engine can see it now.
   */
  it('finds the enemy hampering a bow without being told', () => {
    const far: readonly GameEvent[] = [
      ...SETUP,
      added(id('archer-target'), 'goblins', {}, 20),
      {
        type: 'creature-placed',
        id: id('archer-target'),
        placement: { from: { creature: FIGHTER }, feet: 60, bearing: 90 },
      },
    ];
    const out = swing(far, { target: id('archer-target'), weapon: 'longbow', twoHanded: true });
    expect(out.attack!.mode).toBe('disadvantage');
  });

  /** An ally standing just as close does not, because an ally is not an enemy. */
  it('is not hampered by a friend standing beside them', () => {
    const alone: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === GOBLIN)),
      at(GOBLIN, 60, 90),
    ];
    const out = swing(alone, { target: GOBLIN, weapon: 'longbow', twoHanded: true });
    expect(out.attack!.mode).toBe('normal');
  });
});

describe('proficiency is read off the sheet', () => {
  /** SRD: the Proficiency Bonus applies "if you have proficiency with it". */
  it('drops the Proficiency Bonus for a weapon the attacker cannot use', () => {
    const trained = swing(SETUP, { target: GOBLIN, weapon: 'longsword' });
    const not = swing(simpleOnly(), { target: GOBLIN, weapon: 'longsword' });
    // A level 5 character's Proficiency Bonus is +3.
    expect(trained.attack!.roll.modifier - not.attack!.roll.modifier).toBe(3);
  });

  it('keeps it for a Simple weapon the same attacker is trained in', () => {
    const withDagger = swing(simpleOnly(), { target: GOBLIN, weapon: 'dagger' });
    const withSword = swing(simpleOnly(), { target: GOBLIN, weapon: 'longsword' });
    expect(withDagger.attack!.roll.modifier - withSword.attack!.roll.modifier).toBe(3);
  });
});

describe('conditions on both sides, after features have had their say', () => {
  /**
   * SRD Prone: "An attack roll against you has Advantage if the attacker is
   * within 5 feet of you. Otherwise, that attack roll has Disadvantage." Both
   * halves, derived from the distance the engine already knows.
   */
  it('reads Prone the way the SRD writes it, in both directions', () => {
    const prone: readonly GameEvent[] = [
      ...SETUP,
      { type: 'condition-applied', id: GOBLIN, condition: 'prone', source: 'a shove' },
    ];
    expect(swing(prone, { target: GOBLIN, weapon: 'longsword' }).attack!.mode).toBe('advantage');

    const distant: readonly GameEvent[] = [
      ...SETUP.filter((e) => !(e.type === 'creature-placed' && e.id === GOBLIN)),
      at(GOBLIN, 60, 90),
      { type: 'condition-applied', id: GOBLIN, condition: 'prone', source: 'a shove' },
      // Nobody beside the archer, so only Prone is in play.
      { type: 'creature-unplaced', id: ALLY },
    ];
    expect(swing(distant, { target: GOBLIN, weapon: 'longbow', twoHanded: true }).attack!.mode).toBe(
      'disadvantage',
    );
  });

  it('gives the attacker’s own conditions their say', () => {
    const blinded: readonly GameEvent[] = [
      ...SETUP,
      { type: 'condition-applied', id: FIGHTER, condition: 'blinded', source: 'ash' },
    ];
    expect(swing(blinded, { target: GOBLIN, weapon: 'longsword' }).attack!.mode).toBe('disadvantage');
  });
});

describe('the attack costs an action, once', () => {
  const fighting = (): readonly GameEvent[] => [
    ...SETUP,
    {
      type: 'combat-started',
      combatants: [
        { id: FIGHTER, initiative: 20, speed: 30 },
        { id: GOBLIN, initiative: 10, speed: 30 },
      ],
    },
  ];

  it('spends the Attack action', () => {
    const out = swing(fighting(), { target: GOBLIN, weapon: 'longsword' });
    expect(out.state.combat?.budgets.fighter?.action).toBe(false);
  });

  /**
   * This sheet has no Extra Attack, so its Attack action holds exactly one —
   * and the refusal names the attacks rather than the action, because the
   * action is gone either way and only one of those tells you why.
   */
  it('refuses a second one in the same turn', () => {
    const first = swing(fighting(), { target: GOBLIN, weapon: 'longsword' });
    const again = resolveAttack(first.state, FIGHTER, { target: GOBLIN, weapon: 'longsword' }, supply());
    expect(isErr(again)).toBe(true);
    if (isErr(again)) expect(again.code).toBe('no_attacks_left');
  });

  /** Outside combat there is no economy to spend, so a swing simply happens. */
  it('spends nothing outside combat', () => {
    const out = swing(SETUP, { target: GOBLIN, weapon: 'longsword' });
    expect(out.events.some((e) => e.type === 'action-spent')).toBe(false);
  });
});

describe('it refuses what it cannot do, and costs nothing when it does', () => {
  it('refuses a weapon the attacker does not have', () => {
    const out = resolveAttack(base(), FIGHTER, { target: GOBLIN, weapon: 'greatsword' }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_owned');
  });

  it('refuses an unknown weapon', () => {
    const out = resolveAttack(base(), FIGHTER, { target: GOBLIN, weapon: 'moonblade' }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('unknown_item');
  });

  it('refuses a stranger', () => {
    const out = resolveAttack(base(), FIGHTER, { target: id('nobody'), weapon: 'longsword' }, supply());
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('unknown_creature');
  });

  /** SRD Incapacitated: "You can't take any action." */
  it('refuses an Incapacitated attacker', () => {
    const stunned = fold('seed', [
      ...SETUP,
      { type: 'combat-started', combatants: [{ id: FIGHTER, initiative: 20, speed: 30 }] },
      { type: 'condition-applied', id: FIGHTER, condition: 'stunned', source: 'a spell' },
    ]);
    const out = resolveAttack(stunned, FIGHTER, { target: GOBLIN, weapon: 'longsword' }, supply());
    expect(isErr(out)).toBe(true);
  });

  it('leaves the target untouched when it refuses', () => {
    resolveAttack(base(), FIGHTER, { target: GOBLIN, weapon: 'greatsword' }, supply());
    expect(base().creatures.goblin!.vitals.hp).toBe(20);
  });
});

describe('an Unarmed Strike is an attack with no weapon', () => {
  /** SRD: "1 plus your Strength modifier" Bludgeoning damage. Strength 18 is +4. */
  it('deals the flat damage the SRD prints', () => {
    const out = swing(SETUP, { target: GOBLIN, weapon: null }, 'hit');
    expect(out.attack!.hit).toBe(true);
    expect(out.damage).toBe(5);
  });
});

describe('it settles what the damage puts at risk', () => {
  it('rolls the target’s Concentration save without being asked', () => {
    const concentrating: readonly GameEvent[] = [
      ...SETUP,
      {
        type: 'spell-cast',
        castingId: 'cast:1',
        id: GOBLIN,
        spell: 'Hex',
        level: 1,
        slot: null,
        slotless: 'special-ability',
        castingTime: 'action',
        concentration: true,
      },
      { type: 'concentration-started', id: GOBLIN, castingId: 'cast:1', spell: 'Hex', level: 1 },
    ];
    const out = swing(concentrating, { target: GOBLIN, weapon: 'longsword' }, 'hit');
    expect(out.concentration?.kind).toBe('resolved');
  });
});

describe('it retries and replays like every other command', () => {
  it('is a no-op on a retried command id', () => {
    const first = swing(SETUP, { target: GOBLIN, weapon: 'longsword', commandId: 'a1' }, 'hit');
    const retry = unwrap(
      resolveAttack(first.state, FIGHTER, { target: GOBLIN, weapon: 'longsword', commandId: 'a1' }, supply('hit')),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(retry.duplicate).toBe(true);
    expect(retry.attack).toBeNull();
    expect(fold('seed', [...first.log, ...retry.events]).creatures.goblin!.vitals.hp).toBe(
      first.state.creatures.goblin!.vitals.hp,
    );
  });

  it('produces the same batch twice from the same state and seed', () => {
    const a = unwrap(resolveAttack(base(), FIGHTER, { target: GOBLIN, weapon: 'longsword' }, supply()), 'a');
    const b = unwrap(resolveAttack(base(), FIGHTER, { target: GOBLIN, weapon: 'longsword' }, supply()), 'b');
    expect(a).toEqual(b);
  });

  it('replays prefix by prefix', () => {
    const { log } = swing(SETUP, { target: GOBLIN, weapon: 'longsword' }, 'hit');
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });
});

/**
 * And the same thing for a character the engine made, rather than a sheet a
 * test wrote — which is where the weapon proficiencies come from at all.
 */
describe('a character made from choices swings with what their class allows', () => {
  const wizard = (): CharacterChoices => ({
    name: 'Kessa',
    classId: 'wizard',
    level: 3,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 14, dex: 13, con: 12, int: 15, wis: 10, cha: 8 },
    },
    abilityIncreases: { int: 2, con: 1 },
    classSkills: ['arcana', 'investigation'],
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    subclassId: 'evoker',
    cantrips: ['fire-bolt', 'ray-of-frost', 'light'],
    spellbook: [
      'magic-missile',
      'shield',
      'charm-person',
      'chromatic-orb',
      'ray-of-sickness',
      'grease',
      'misty-step',
      'mirror-image',
      'web',
      'invisibility',
    ].map((spellId) => ({ spellId, acquiredAt: 1, origin: 'level' as const })),
    preparedSpells: ['magic-missile', 'shield', 'grease', 'misty-step', 'web', 'invisibility'],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      'human:skillful': ['perception'],
      'wizard:scholar': ['arcana'],
      'evoker:evocation-savant': ['burning-hands', 'thunderwave'],
    },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'prestidigitation'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  });

  const KESSA = id('kessa');

  const table = (): readonly GameEvent[] => [
    ...(unwrap(createCharacter(wizard(), KESSA), 'create') as GameEvent[]),
    { type: 'creature-side-declared', id: KESSA, side: 'party' },
    added(GOBLIN, 'goblins', {}, 20),
    {
      type: 'items-gained',
      id: KESSA,
      items: [
        { id: 'longsword', quantity: 1 },
        { id: 'dagger', quantity: 1 },
      ],
      source: 'loot',
    },
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the study', at: { x: 50, y: 50, z: 0 } },
    { type: 'creature-placed', id: KESSA, placement: { from: { landmark: 'the study' }, feet: 0 } },
    { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: KESSA }, feet: 5, bearing: 0 } },
  ];

  /** SRD Wizard: "Weapon Proficiencies: Simple weapons." */
  it('takes its weapon proficiencies from the class', () => {
    expect(fold('seed', table()).creatures.kessa!.sheet.weaponProficiencies).toEqual(['simple']);
  });

  it('is proficient with a dagger and not with a longsword', () => {
    const withDagger = unwrap(
      resolveAttack(fold('seed', table()), KESSA, { target: GOBLIN, weapon: 'dagger' }, supply()),
      'dagger',
    );
    const withSword = unwrap(
      resolveAttack(fold('seed', table()), KESSA, { target: GOBLIN, weapon: 'longsword' }, supply()),
      'longsword',
    );
    // A level 3 character's Proficiency Bonus is +2.
    expect(withDagger.attack!.roll.modifier - withSword.attack!.roll.modifier).toBe(2);
  });
});
