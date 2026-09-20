import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type ConditionName } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack, resolveTurn, settleDamage, takeDamageReaction } from './commands.js';
import { createCharacter, planCharacter, type CharacterChoices } from './creation.js';
import { extendContent, parseClassDefinition } from './content.js';
import { remaining } from './resources.js';
import { spellSaveDcWith } from './character.js';

/**
 * An effect list bought by **a hit that has already landed**.
 *
 * A feature's pool use is the third host of an effect list and every option on
 * one is a purchase somebody makes with an action: SRD Channel Divinity is the
 * shape it was built to. What had no shape was the *trigger* — "Once per turn
 * when you hit a creature with a Monk weapon or an Unarmed Strike, you can
 * expend 1 Focus Point", and the same sentence on a Cunning Strike, an Open
 * Hand Technique and a Goliath's Hill's Tumble. The save and the condition
 * were expressible; nothing hung one on a hit an attack roll had settled.
 *
 * So the grant is the trigger and nothing else. What an option buys is the
 * effect list the engine already runs — one loop, `runEffects`, with the same
 * feature origin a pool option uses, so a rules fix in a resolver reaches this
 * without anybody remembering to.
 */

const id = (s: string) => asCharacterId(s);
const SHAN = id('shan');
const THUG = id('thug');

const plain = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: null,
  ...over,
});

const monk = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Shan',
  classId: 'monk',
  level: 5,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['acrobatics', 'stealth'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Lawful Neutral',
  subclassId: 'warrior-of-the-open-hand',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    // The level 4 feat, which a level 5 character has to have answered.
    'monk:ability-score-improvement': { featId: 'savage-attacker' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const FOCUS = 'focus-points';
const STUNNING = 'monk:stunning-strike';

const table = (over: Partial<CharacterChoices> = {}): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, monk(over), SHAN), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: SHAN, side: 'party' },
  {
    type: 'creature-added',
    id: THUG,
    name: 'thug',
    sheet: plain(),
    maxHp: 400,
    diesAtZero: false,
    creatureType: 'Humanoid',
    side: 'thugs',
  },
  {
    type: 'items-gained',
    id: SHAN,
    items: [
      { id: 'shortsword', quantity: 1 },
      { id: 'greatsword', quantity: 1 },
    ],
    source: 'loot',
  },
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the yard', at: { x: 50, y: 50, z: 0 } },
  { type: 'creature-placed', id: SHAN, placement: { from: { landmark: 'the yard' }, feet: 0 } },
  { type: 'creature-placed', id: THUG, placement: { from: { creature: SHAN }, feet: 5, bearing: 0 } },
  {
    type: 'combat-started',
    combatants: [
      { id: SHAN, initiative: 20, speed: 30 },
      { id: THUG, initiative: 10, speed: 30 },
    ],
  },
];

const supply = (seed: string) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

/**
 * Swing with the attack roll forced to land, so the test is about the rider.
 *
 * The same forced bonus `once-per-turn.test.ts` uses, and for the same reason:
 * a miss answers nothing about a rule that fires on a hit.
 */
const swing = (
  log: readonly GameEvent[],
  request: Parameters<typeof resolveAttack>[2],
  seed = 'stun',
) => {
  const out = unwrap(
    resolveAttack(
      fold('seed', log),
      SHAN,
      { ...request, attackBonuses: [{ source: 'forced', flat: 40 }] },
      supply(seed),
    ),
    'attack',
  );
  return { ...out, log: [...log, ...out.events], state: fold('seed', [...log, ...out.events]) };
};

/** The refusal a swing came back with, for the paths that must cost nothing. */
const refusal = (log: readonly GameEvent[], request: Parameters<typeof resolveAttack>[2]) => {
  const out = resolveAttack(
    fold('seed', log),
    SHAN,
    { ...request, attackBonuses: [{ source: 'forced', flat: 40 }] },
    supply('stun'),
  );
  if (!isErr(out)) throw new Error('the fixture meant this swing to be refused');
  return out;
};

const has = (state: GameState, condition: ConditionName): boolean =>
  state.creatures.thug!.conditions.conditions.includes(condition);

const stunned = (state: GameState): boolean => has(state, 'stunned');

/**
 * A seed the Constitution save fails on, and one it makes.
 *
 * The die is the engine's and the DC is the feature's, so which way a save
 * goes is a fact about the seed. These two are chosen to fall either side of
 * the DC by one — a natural 12 and a natural 13 — so that the pair *pins* the
 * number rather than agreeing with whatever the engine used: a DC of 12 or 14
 * would fail the test below.
 */
const FAILS = 's9';
const SAVES = 's51';

describe('Stunning Strike is bought by the hit rather than by an action', () => {
  /**
   * SRD: "Once per turn when you hit a creature with a Monk weapon or an
   * Unarmed Strike, you can expend 1 Focus Point to attempt a stunning strike.
   * The target must make a Constitution saving throw. On a failed save, the
   * target has the Stunned condition until the start of your next turn."
   */
  it('spends a Focus Point and Stuns on a failed save', () => {
    const out = swing(table(), { target: THUG, weapon: null, onHit: { feature: STUNNING, option: 'stun' } }, FAILS);
    expect(out.attack!.hit).toBe(true);
    // A level 5 Monk has five Focus Points, and this took exactly one.
    expect(remaining(fold('seed', table()).creatures.shan!.resources, FOCUS)).toBe(5);
    expect(remaining(out.state.creatures.shan!.resources, FOCUS)).toBe(4);
    expect(stunned(out.state)).toBe(true);
  });

  /** The save is the target's own, and making it leaves them standing. */
  it('leaves a creature that makes the save unstunned, and still spends the point', () => {
    const out = swing(table(), { target: THUG, weapon: null, onHit: { feature: STUNNING, option: 'stun' } }, SAVES);
    expect(stunned(out.state)).toBe(false);
    expect(remaining(out.state.creatures.shan!.resources, FOCUS)).toBe(4);
  });

  /**
   * The DC is the holder's own, derived rather than printed.
   *
   * SRD Monk's Focus: "Some features that use Focus Points require your target
   * to make a saving throw. The save DC equals 8 plus your Wisdom modifier and
   * Proficiency Bonus" — 8 + 2 + 3 for this Monk, which is the number asserted
   * here and the ability the sheet says it is read from. A Monk casts nothing,
   * so a rider that fell back to a spell save DC would be short by the Wisdom.
   */
  it('rolls against the Monk’s own save DC, and the target’s own modifier', () => {
    const sheet = fold('seed', table()).creatures.shan!.sheet;
    expect(sheet.hitOptions?.[0]?.ability).toBe('wis');
    expect(spellSaveDcWith(sheet, 'wis')).toBe(13);

    // And the rider rolls against *that* number: two seeds, one either side of
    // it, and the naturals are pinned so the pair says 13 rather than agreeing
    // with whatever the engine used.
    const failed = swing(table(), { target: THUG, weapon: null, onHit: { feature: STUNNING, option: 'stun' } }, FAILS);
    const made = swing(table(), { target: THUG, weapon: null, onHit: { feature: STUNNING, option: 'stun' } }, SAVES);
    const rolled = (out: { readonly events: readonly GameEvent[] }) => {
      const save = out.events.find((e) => e.type === 'roll-recorded' && e.who === THUG);
      if (save?.type !== 'roll-recorded') throw new Error('expected the target to have rolled');
      return save;
    };

    // The thug's Constitution is 10 and it is not proficient: nothing is added,
    // so the die is the whole of the total on both of them.
    for (const save of [rolled(failed), rolled(made)]) {
      expect(save.contributions.reduce((sum, one) => sum + one.amount, 0)).toBe(0);
      expect(save.total).toBe(save.natural);
    }
    expect(rolled(failed).natural).toBe(12);
    expect(rolled(failed).outcome).toBe('affected');
    expect(rolled(made).natural).toBe(13);
    expect(rolled(made).outcome).toBe('resisted');
  });

  /** SRD: "until the start of your next turn." */
  it('ends the Stunned condition at the start of the Monk’s next turn', () => {
    const out = swing(table(), { target: THUG, weapon: null, onHit: { feature: STUNNING, option: 'stun' } }, FAILS);
    let current = out.log;
    expect(stunned(fold('seed', current))).toBe(true);
    for (let n = 0; n < 2; n += 1) {
      current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply('turn')), 'turn').events];
    }
    expect(stunned(fold('seed', current))).toBe(false);
  });

  /** SRD: "a Monk weapon or an Unarmed Strike" — a Greatsword is neither. */
  it('refuses a weapon the feature does not name, before anything is spent', () => {
    const out = refusal(table(), {
      target: THUG,
      weapon: 'greatsword',
      twoHanded: true,
      onHit: { feature: STUNNING, option: 'stun' },
    });
    expect(out.code).toBe('weapon_not_covered');
    // And a Shortsword — a Simple Melee weapon is a Monk weapon — is fine.
    const fine = swing(table(), {
      target: THUG,
      weapon: 'shortsword',
      onHit: { feature: STUNNING, option: 'stun' },
    }, FAILS);
    expect(stunned(fine.state)).toBe(true);
  });

  /** SRD: "**Once per turn**." */
  it('is refused a second time in the same turn', () => {
    const first = swing(table(), { target: THUG, weapon: null, onHit: { feature: STUNNING, option: 'stun' } }, FAILS);
    const again = refusal(first.log, {
      target: THUG,
      weapon: null,
      free: true,
      onHit: { feature: STUNNING, option: 'stun' },
    });
    expect(again.code).toBe('already_used');
  });

  /** And nothing is spent by a swing that missed. */
  it('spends nothing on a miss', () => {
    const missed = unwrap(
      resolveAttack(
        fold('seed', table()),
        SHAN,
        {
          target: THUG,
          weapon: null,
          onHit: { feature: STUNNING, option: 'stun' },
          attackBonuses: [{ source: 'forced', flat: -40 }],
        },
        supply(FAILS),
      ),
      'attack',
    );
    expect(missed.attack!.hit).toBe(false);
    const after = fold('seed', [...table(), ...missed.events]);
    expect(remaining(after.creatures.shan!.resources, FOCUS)).toBe(5);
    expect(stunned(after)).toBe(false);
  });

  /** An empty pool is a refusal, and it arrives before the action is spent. */
  it('refuses when the pool is empty', () => {
    const spent: readonly GameEvent[] = [
      ...table(),
      { type: 'resource-spent', id: SHAN, key: FOCUS, amount: 5 },
    ];
    const out = refusal(spent, { target: THUG, weapon: null, onHit: { feature: STUNNING, option: 'stun' } });
    expect(out.code).toBe('exhausted');
  });

  /** A rider nobody asked for does not fire: SRD says "**you can** expend". */
  it('does nothing at all unless the swing asks for it', () => {
    const out = swing(table(), { target: THUG, weapon: null }, FAILS);
    expect(stunned(out.state)).toBe(false);
    expect(remaining(out.state.creatures.shan!.resources, FOCUS)).toBe(5);
  });

  /** An option the feature does not print is refused by name. */
  it('refuses an option the feature does not offer', () => {
    const out = refusal(table(), {
      target: THUG,
      weapon: null,
      onHit: { feature: STUNNING, option: 'decapitate' },
    });
    expect(out.code).toBe('no_such_option');
  });

  /** A feature this character does not have is refused the same way. */
  it('refuses a feature the character does not have', () => {
    const out = refusal(table(), {
      target: THUG,
      weapon: null,
      onHit: { feature: 'monk:quivering-palm', option: 'stun' },
    });
    expect(out.code).toBe('no_such_feature');
  });
});

// — and the same trigger, homebrewed ———————————————————————————————————————

/**
 * A homebrew class whose rider costs nothing, hangs a condition for a printed
 * span, and is loaded from JSON through the door the book goes through.
 */
const VENOMBLADE = JSON.stringify({
  id: 'venomblade',
  name: 'Venomblade',
  primaryAbility: 'dex',
  hitDie: 8,
  saveProficiencies: ['dex', 'int'],
  skillChoices: { choose: 2, from: ['acrobatics', 'stealth', 'nature', 'insight'] },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'shortsword', quantity: 1 }], goldPieces: 10 }],
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'venomblade:envenom',
      name: 'Envenom',
      level: 1,
      automation: 'engine',
      note: 'When you hit a creature with a Light weapon, it makes a Constitution saving throw or has the Poisoned condition for a minute. It costs nothing and there is no limit on it.',
      grants: {
        kind: 'on-hit',
        weapons: [{ properties: ['light'] }],
        options: [
          {
            id: 'venom',
            name: 'Envenom',
            effects: [{ kind: 'save', ability: 'con', condition: 'poisoned' }],
            durationSeconds: 60,
          },
        ],
      },
    },
  ],
});

describe('a homebrew feature buys an effect list with a hit and no engine change', () => {
  const parsed = unwrap(parseClassDefinition(JSON.parse(VENOMBLADE)), 'parse');
  const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');
  const WHO = id('rill');

  const venomblade = (): CharacterChoices => ({
    name: 'Rill',
    classId: 'venomblade',
    level: 1,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 12, dex: 15, con: 13, int: 14, wis: 10, cha: 8 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: ['acrobatics', 'stealth'],
    languages: ['Elvish', 'Orc'],
    alignment: 'Neutral',
    cantrips: [],
    spellbook: [],
    preparedSpells: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'light'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
    },
  });

  const scene = (): readonly GameEvent[] => [
    ...(unwrap(createCharacter(content, venomblade(), WHO), 'create') as GameEvent[]),
    { type: 'creature-side-declared', id: WHO, side: 'party' },
    {
      type: 'creature-added',
      id: THUG,
      name: 'thug',
      sheet: plain(),
      maxHp: 400,
      diesAtZero: false,
      creatureType: 'Humanoid',
      side: 'thugs',
    },
    { type: 'items-gained', id: WHO, items: [{ id: 'mace', quantity: 1 }], source: 'loot' },
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the road', at: { x: 50, y: 50, z: 0 } },
    { type: 'creature-placed', id: WHO, placement: { from: { landmark: 'the road' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: THUG,
      placement: { from: { creature: WHO }, feet: 5, bearing: 0 },
    },
  ];

  const stab = (weapon: string, seed: string) =>
    unwrap(
      resolveAttack(
        fold('seed', scene()),
        WHO,
        {
          target: THUG,
          weapon,
          onHit: { feature: 'venomblade:envenom', option: 'venom' },
          attackBonuses: [{ source: 'forced', flat: 40 }],
        },
        { issuer: createRollIssuer('r'), rng: createRng(seed) as Rng, content },
      ),
      'attack',
    );

  it('poisons on a failed save, for the span the option prints', () => {
    const out = stab('shortsword', 'two');
    const after = fold('seed', [...scene(), ...out.events]);
    expect(after.creatures.thug!.conditions.conditions).toContain('poisoned');
    // The minute it prints, filed as a deadline rather than left standing.
    expect(
      out.events.some((e) => e.type === 'effect-scheduled' && e.deadline.kind === 'elapsed'),
    ).toBe(true);
  });

  /**
   * And what a rider may not do, refused at authoring rather than at the swing:
   * the engine holds one damage roll at a time, and the attack the rider rides
   * on is already holding one whenever its target has a Reaction to it.
   */
  it('refuses a rider that deals damage of its own', () => {
    const greedy = JSON.parse(VENOMBLADE) as {
      features: { grants: { options: { effects: unknown[] }[] } }[];
    };
    greedy.features[0]!.grants.options[0]!.effects = [
      { kind: 'save-damage', ability: 'con', damage: { dice: '2d6' }, damageType: 'poison' },
    ];
    const parsedGreedy = unwrap(parseClassDefinition(greedy), 'parse');
    const refused = extendContent(SRD_CONTENT, { classes: [parsedGreedy] });
    expect(isErr(refused) && refused.reason).toContain('one damage roll at a time');
  });

  it('is refused on a weapon its own selector does not cover', () => {
    const out = resolveAttack(
      fold('seed', scene()),
      WHO,
      {
        target: THUG,
        weapon: 'mace',
        onHit: { feature: 'venomblade:envenom', option: 'venom' },
        attackBonuses: [{ source: 'forced', flat: 40 }],
      },
      { issuer: createRollIssuer('r'), rng: createRng(FAILS) as Rng, content },
    );
    expect(isErr(out) && out.code).toBe('weapon_not_covered');
  });
});

/**
 * **The defender answers first.**
 *
 * A rider fires "when you hit a creature", and so does the Reaction the
 * defender was just offered — SRD Uncanny Dodge is "when an attack roll hits
 * you". Both are the same instant, and the engine used to resolve the
 * attacker's half of it first: a target Stunned by the rider could no longer
 * answer the `damage-rolled` window the same blow had opened for it. Nothing
 * deadlocked, because settling records a pass; the Reaction was simply denied,
 * silently, where the book puts the defender's response first.
 *
 * So a hit that opens a window **holds the rider with the damage**. What the
 * blow still owes is pinned on the hold, the defender answers, and the rider
 * resolves when the damage does — on the world the damage has already changed,
 * which is where it always resolved.
 */
describe('a rider waits for the window the same blow opened', () => {
  const rogue = (): CharacterChoices => ({
    name: 'Nyx',
    classId: 'rogue',
    level: 5,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 15, con: 13, int: 14, wis: 12, cha: 10 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: ['stealth', 'sleight-of-hand', 'acrobatics', 'investigation'],
    subclassId: 'thief',
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    cantrips: [],
    spellbook: [],
    preparedSpells: [],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      'human:skillful': ['perception'],
      'rogue:expertise': ['stealth', 'sleight-of-hand'],
    },
    feats: {
      'sage:magic-initiate-wizard': {
        featId: 'magic-initiate',
        spellList: 'wizard',
        spellcastingAbility: 'int',
        cantrips: ['mage-hand', 'light'],
        levelOneSpell: 'find-familiar',
      },
      'human:versatile': { featId: 'alert' },
      'rogue:ability-score-improvement': { featId: 'savage-attacker' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  });

  const DODGE = 'rogue:uncanny-dodge';

  /** The Monk's table, with somebody who can answer a damage roll to hit. */
  const facing = (): readonly GameEvent[] => {
    const sheet = unwrap(planCharacter(SRD_CONTENT, rogue()), 'the rogue').sheet;
    return table().map((event) =>
      event.type === 'creature-added' && event.id === THUG ? { ...event, sheet } : event,
    );
  };

  const stun = (log: readonly GameEvent[]) =>
    swing(log, { target: THUG, weapon: null, onHit: { feature: STUNNING, option: 'stun' } }, FAILS);

  /**
   * A seed the Rogue's Constitution save fails on — **at the settlement**,
   * which is where the rider now rolls it.
   *
   * The Rogue is not proficient in Constitution and has a 15, so the save is
   * the die plus two against the Monk's DC 13: this one throws a 10 and comes
   * up one short. That the seed belongs to `settleDamage` rather than to the
   * swing is itself the claim — the die had not been thrown when the attack
   * command returned.
   */
  const SETTLE_FAILS = 'b';

  it('offers the window, and stuns nobody yet', () => {
    const out = stun(facing());

    expect(out.attack?.hit).toBe(true);
    expect(out.reactions?.map((offer) => offer.feature)).toEqual([DODGE]);
    expect(out.state.pendingDamage).not.toBeNull();
    // Neither half of the blow has happened: no damage, and no rider.
    expect(out.damage).toBeUndefined();
    expect(stunned(out.state)).toBe(false);
    expect(remaining(out.state.creatures.shan!.resources, FOCUS)).toBe(5);
  });


  /** The Reaction the rider used to close, taken. */
  it('lets the target answer, and then stuns it', () => {
    const out = stun(facing());
    const dodged = unwrap(
      takeDamageReaction(out.state, THUG, { feature: DODGE }, supply('dodge')),
      'the dodge',
    );
    const answered = [...out.log, ...dodged.events];

    expect(fold('seed', answered).pendingDamage?.reductions).toHaveLength(1);

    const settled = unwrap(settleDamage(fold('seed', answered), supply(SETTLE_FAILS)), 'settle');
    const after = fold('seed', [...answered, ...settled.events]);

    // SRD Uncanny Dodge: "halve the attack's damage against you."
    expect(settled.amount).toBeGreaterThan(0);
    // And the rider the blow was holding, resolved once the defender had
    // spoken: the save rolled, the condition applied, the point spent.
    expect(stunned(after)).toBe(true);
    expect(remaining(after.creatures.shan!.resources, FOCUS)).toBe(4);
  });

  /** And nobody answering changes nothing about the rider. */
  it('resolves the rider when the window closes unanswered', () => {
    const out = stun(facing());
    const settled = unwrap(settleDamage(out.state, supply(SETTLE_FAILS)), 'settle');
    const after = fold('seed', [...out.log, ...settled.events]);

    expect(stunned(after)).toBe(true);
    expect(remaining(after.creatures.shan!.resources, FOCUS)).toBe(4);
  });

  /**
   * A settlement is the one door out of a held damage roll, so it may not
   * refuse: a rider that will not resolve is reported and the damage still
   * lands, because a refusal here would wedge the fight for ever and every
   * retry would wedge it again.
   *
   * Nothing in the SRD reaches it — a Stunning Strike whose every refusal was
   * checked at the swing resolves — so what is asserted is the settlement's
   * half of the contract: it comes back `ok`, with a channel for what did not
   * happen, on the world it has changed.
   */
  it('settles rather than refusing, and has somewhere to say what did not happen', () => {
    const out = stun(facing());
    const settled = settleDamage(out.state, supply(SETTLE_FAILS));
    expect(isErr(settled)).toBe(false);
    if (isErr(settled)) return;
    expect(settled.value.unverified).toEqual([]);
    expect(fold('seed', [...out.log, ...settled.value.events]).pendingDamage).toBeNull();
  });

  /**
   * A retry of the settlement is the settlement, not a second rider: the save
   * is rolled once and the point is spent once, whatever a dropped connection
   * does.
   */
  it('resolves the rider once under a repeated command id', () => {
    const out = stun(facing());
    const settled = unwrap(
      settleDamage(out.state, supply(SETTLE_FAILS), { commandId: 'close' }),
      'settle',
    );
    const after = [...out.log, ...settled.events];
    const again = unwrap(
      settleDamage(fold('seed', after), supply(SETTLE_FAILS), { commandId: 'close' }),
      'again',
    );

    expect(again.duplicate).toBe(true);
    expect(again.events).toEqual([]);
    expect(remaining(fold('seed', after).creatures.shan!.resources, FOCUS)).toBe(4);
  });

  /**
   * And a swing that opens no window is untouched: the rider fires in the same
   * command it always did, because there is nobody to hear it first.
   */
  it('fires in the same breath when nobody was offered anything', () => {
    const out = stun(table());
    expect(out.reactions).toBeUndefined();
    expect(stunned(out.state)).toBe(true);
    expect(remaining(out.state.creatures.shan!.resources, FOCUS)).toBe(4);
  });
});
