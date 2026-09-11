import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap } from '@ie/shared';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining } from './resources.js';
import { activateFeature, endFeature, extendFeature, resolveTurn, castSpell } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { defensesOf, effectiveConditions, standingSaveModes } from './standing.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';

/**
 * Rage: a feature a creature turns on, pays for, and can lose.
 *
 * The first *activated* feature, and it needs every part of that shape at
 * once — which is why it is the one that earns the mechanism rather than a
 * guess about what a mechanism might need:
 *
 * | SRD | What it asks for |
 * |---|---|
 * | "You can enter it as a Bonus Action if you aren't wearing Heavy armor" | an action cost and a prerequisite |
 * | "the number of times shown... in the Rages column" | a pool, sized by level |
 * | "Resistance to Bludgeoning, Piercing, and Slashing damage" | a defence that holds only while it runs |
 * | "Advantage on Strength checks and Strength saving throws" | a modifier that holds only while it runs |
 * | "You can't maintain Concentration, and you can't cast spells" | a refusal while it runs |
 * | "lasts until the end of your next turn" | a turn-anchored deadline |
 * | "ends early if you don Heavy armor or have the Incapacitated condition" | two ways out that nobody commands |
 * | "you can extend the Rage for another round" | a deadline that can be pushed |
 * | "up to 10 minutes" | a cap the extension cannot pass |
 */

const id = (s: string) => asCharacterId(s);
const GRUM = id('grum');
const FOE = id('foe');

const barbarian = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Grum',
  classId: 'barbarian',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'survival'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Chaotic Neutral',
  subclassId: 'path-of-the-berserker',
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['perception'], 'barbarian:primal-knowledge': ['intimidation'] },
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
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const made = (over: Partial<CharacterChoices> = {}): readonly GameEvent[] =>
  unwrap(createCharacter(barbarian(over), GRUM), 'create') as GameEvent[];

const base = (over: Partial<CharacterChoices> = {}): GameState => fold('seed', made(over));

const RAGE = 'barbarian:rage';

/** Turn it on, and hand back the longer log. */
const raging = (log: readonly GameEvent[] = made()): readonly GameEvent[] => [
  ...log,
  ...unwrap(activateFeature(fold('seed', log), GRUM, { feature: RAGE }), 'rage'),
];

const supply = () => ({ issuer: createRollIssuer('r'), rng: createRng('turn') as Rng });

describe('turning it on costs what the SRD says it costs', () => {
  /** SRD: "the number of times shown for your Barbarian level in the Rages column." */
  it('declares a pool sized by the class table', () => {
    // A level 3 Barbarian has three Rages.
    expect(remaining(base().creatures.grum!.resources, 'rage')).toBe(3);
  });

  it('spends a use to enter it', () => {
    const after = fold('seed', raging());
    expect(remaining(after.creatures.grum!.resources, 'rage')).toBe(2);
    expect(after.creatures.grum!.activeFeatures).toContain(RAGE);
  });

  it('refuses when there are none left', () => {
    const spent: readonly GameEvent[] = [
      ...made(),
      { type: 'resource-spent', id: GRUM, key: 'rage', amount: 3 },
    ];
    const out = activateFeature(fold('seed', spent), GRUM, { feature: RAGE });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('exhausted');
  });

  /** SRD: "if you aren't wearing Heavy armor". */
  it('refuses in Heavy armour', () => {
    const armoured: readonly GameEvent[] = [
      ...made(),
      { type: 'items-gained', id: GRUM, items: [{ id: 'ring-mail', quantity: 1 }], source: 'loot' },
      { type: 'item-equipped', id: GRUM, item: 'ring-mail' },
    ];
    const out = activateFeature(fold('seed', armoured), GRUM, { feature: RAGE });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('heavy_armor');
  });

  it('refuses to start twice', () => {
    const out = activateFeature(fold('seed', raging()), GRUM, { feature: RAGE });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('already_active');
  });

  /** SRD: "You can enter it as a Bonus Action." */
  it('spends the Bonus Action in combat, and refuses a second one', () => {
    const fighting: readonly GameEvent[] = [
      ...made(),
      {
        type: 'creature-added',
        id: FOE,
        name: 'foe',
        sheet: base().creatures.grum!.sheet,
        maxHp: 20,
        diesAtZero: true,
      },
      {
        type: 'combat-started',
        combatants: [
          { id: GRUM, initiative: 20, speed: 30 },
          { id: FOE, initiative: 10, speed: 30 },
        ],
      },
    ];
    const first = unwrap(activateFeature(fold('seed', fighting), GRUM, { feature: RAGE }), 'rage');
    const after = [...fighting, ...first];
    expect(fold('seed', after).combat?.budgets.grum?.bonusAction).toBe(false);

    const ended = unwrap(endFeature(fold('seed', after), GRUM, { feature: RAGE }), 'end');
    const out = activateFeature(fold('seed', [...after, ...ended]), GRUM, { feature: RAGE });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('no_bonus_action');
  });

  it('is a no-op on a retried command id', () => {
    const first = unwrap(
      activateFeature(base(), GRUM, { feature: RAGE, commandId: 'r1' }),
      'first',
    );
    const log = [...made(), ...first];
    const retry = unwrap(
      activateFeature(fold('seed', log), GRUM, { feature: RAGE, commandId: 'r1' }),
      'retry',
    );
    expect(retry).toEqual([]);
    expect(remaining(fold('seed', log).creatures.grum!.resources, 'rage')).toBe(2);
  });
});

describe('what Rage does, it does only while it is running', () => {
  /** SRD: "You have Resistance to Bludgeoning, Piercing, and Slashing damage." */
  it('grants the three physical resistances', () => {
    const before = defensesOf(base(), GRUM);
    expect(before.bludgeoning).toBeUndefined();

    const during = defensesOf(fold('seed', raging()), GRUM);
    expect(during.bludgeoning).toEqual({ resistant: true });
    expect(during.piercing).toEqual({ resistant: true });
    expect(during.slashing).toEqual({ resistant: true });
    expect(during.fire).toBeUndefined();
  });

  /** SRD: "You have Advantage on Strength checks and Strength saving throws." */
  it('grants Advantage on Strength saves and on nothing else', () => {
    const during = fold('seed', raging());
    expect(standingSaveModes(during, GRUM, 'str')).toEqual([{ source: 'Rage', mode: 'advantage' }]);
    expect(standingSaveModes(during, GRUM, 'dex')).toHaveLength(1); // Danger Sense, at level 3
    expect(standingSaveModes(during, GRUM, 'wis')).toEqual([]);
  });

  it('takes all of it away again when it ends', () => {
    const log = raging();
    const ended = [...log, ...unwrap(endFeature(fold('seed', log), GRUM, { feature: RAGE }), 'end')];
    expect(defensesOf(fold('seed', ended), GRUM).bludgeoning).toBeUndefined();
    expect(standingSaveModes(fold('seed', ended), GRUM, 'str')).toEqual([]);
  });

  /** SRD: "You can't maintain Concentration, and you can't cast spells." */
  it('refuses to cast while it runs', () => {
    const out = castSpell(fold('seed', raging()), GRUM, {
      spell: 'Fire Bolt',
      level: 0,
    });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('raging');
  });

  it('casts again once it is over', () => {
    const log = raging();
    const ended = [...log, ...unwrap(endFeature(fold('seed', log), GRUM, { feature: RAGE }), 'end')];
    expect(isErr(castSpell(fold('seed', ended), GRUM, { spell: 'Fire Bolt', level: 0 }))).toBe(false);
  });
});

describe('two ways out that nobody commands', () => {
  /** SRD: "ends early if you... have the Incapacitated condition." */
  it('ends when the barbarian is Incapacitated', () => {
    const stunned = fold('seed', [
      ...raging(),
      { type: 'condition-applied', id: GRUM, condition: 'stunned', source: 'a spell' },
    ]);
    expect(stunned.creatures.grum!.activeFeatures).not.toContain(RAGE);
    expect(defensesOf(stunned, GRUM).bludgeoning).toBeUndefined();
  });

  /** SRD: "ends early if you don Heavy armor." */
  it('ends when Heavy armour goes on', () => {
    const armoured = fold('seed', [
      ...raging(),
      { type: 'items-gained', id: GRUM, items: [{ id: 'ring-mail', quantity: 1 }], source: 'loot' },
      { type: 'item-equipped', id: GRUM, item: 'ring-mail' },
    ]);
    expect(armoured.creatures.grum!.activeFeatures).not.toContain(RAGE);
  });

  /** And it stays gone: nothing brings it back when the armour comes off. */
  it('does not come back when the armour comes off', () => {
    const off = fold('seed', [
      ...raging(),
      { type: 'items-gained', id: GRUM, items: [{ id: 'ring-mail', quantity: 1 }], source: 'loot' },
      { type: 'item-equipped', id: GRUM, item: 'ring-mail' },
      { type: 'item-unequipped', id: GRUM, item: 'ring-mail' },
    ]);
    expect(off.creatures.grum!.activeFeatures).not.toContain(RAGE);
  });
});

describe('the deadline, and pushing it', () => {
  const fighting = (): readonly GameEvent[] => [
    ...made(),
    {
      type: 'creature-added',
      id: FOE,
      name: 'foe',
      sheet: base().creatures.grum!.sheet,
      maxHp: 20,
      diesAtZero: true,
    },
    {
      type: 'combat-started',
      combatants: [
        { id: GRUM, initiative: 20, speed: 30 },
        { id: FOE, initiative: 10, speed: 30 },
      ],
    },
  ];

  /** SRD: "The Rage lasts until the end of your next turn." */
  it('lapses at the end of the barbarian’s next turn', () => {
    const log = raging(fighting());
    let current = log;
    // Grum's turn, then the foe's, then Grum's again, then its end.
    for (let n = 0; n < 3; n += 1) {
      current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    }
    expect(fold('seed', current).creatures.grum!.activeFeatures).not.toContain(RAGE);
  });

  /** SRD: "you can extend the Rage for another round." */
  it('survives the boundary when it is extended', () => {
    let current = raging(fighting());
    current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    // Back on Grum's turn: extend before it lapses.
    current = [
      ...current,
      ...unwrap(extendFeature(fold('seed', current), GRUM, { feature: RAGE, by: 'attack' }), 'extend'),
    ];
    current = [...current, ...unwrap(resolveTurn(fold('seed', current), supply()), 'turn').events];
    expect(fold('seed', current).creatures.grum!.activeFeatures).toContain(RAGE);
  });

  /** SRD: "Take a Bonus Action to extend your Rage" — and only that one costs. */
  it('spends a Bonus Action only when that is how it was extended', () => {
    // A round on, so the Bonus Action entering the Rage spent is back.
    let started = raging(fighting());
    for (let n = 0; n < 2; n += 1) {
      started = [...started, ...unwrap(resolveTurn(fold('seed', started), supply()), 'turn').events];
    }
    expect(fold('seed', started).combat?.budgets.grum?.bonusAction).toBe(true);

    // The attack route costs nothing; only "Take a Bonus Action to extend your
    // Rage" does, which is the one of the three that says so.
    const byAttack = unwrap(
      extendFeature(fold('seed', started), GRUM, { feature: RAGE, by: 'attack' }),
      'attack',
    );
    expect(byAttack.some((e) => e.type === 'bonus-action-spent')).toBe(false);

    const byBonusAction = unwrap(
      extendFeature(fold('seed', started), GRUM, { feature: RAGE, by: 'bonus-action' }),
      'bonus action',
    );
    expect(byBonusAction.some((e) => e.type === 'bonus-action-spent')).toBe(true);
    expect(
      fold('seed', [...started, ...byBonusAction]).combat?.budgets.grum?.bonusAction,
    ).toBe(false);
  });

  it('refuses to extend something that is not running', () => {
    const out = extendFeature(base(), GRUM, { feature: RAGE, by: 'attack' });
    expect(isErr(out)).toBe(true);
    if (isErr(out)) expect(out.code).toBe('not_active');
  });
});

describe('it replays and survives a reload', () => {
  it('folds to the same state twice', () => {
    const log = raging();
    expect(fold('seed', log)).toEqual(fold('seed', log));
  });

  it('replays prefix by prefix', () => {
    const log = raging();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('survives JSON', () => {
    const state = fold('seed', raging());
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

/**
 * Mindless Rage, whose requirement is somebody else's feature.
 *
 * SRD Path of the Berserker, level 6: "You have Immunity to the Charmed and
 * Frightened conditions **while your Rage is active**." It is the Berserker's
 * feature and what it needs switched on is the *Barbarian's* Rage — which is
 * why a requirement names the feature rather than meaning "whichever one
 * granted me". That distinction was wrong in the first draft and right only
 * because this feature exists to catch it.
 */
describe('a feature whose condition is another feature', () => {
  const berserker = (): readonly GameEvent[] =>
    made({
      level: 6,
      feats: {
        ...barbarian().feats,
        'barbarian:ability-score-improvement': { featId: 'savage-attacker' },
      },
    });

  const charmed = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    { type: 'condition-applied', id: GRUM, condition: 'charmed', source: 'a hag' },
    { type: 'condition-applied', id: GRUM, condition: 'frightened', source: 'a dragon' },
  ];

  it('does nothing while the Rage is off', () => {
    const state = fold('seed', charmed(berserker()));
    expect(effectiveConditions(state, GRUM).conditions).toContain('charmed');
    expect(effectiveConditions(state, GRUM).conditions).toContain('frightened');
  });

  it('suppresses both the moment the Rage starts', () => {
    const state = fold('seed', raging(charmed(berserker())));
    expect(state.creatures.grum!.activeFeatures).toContain(RAGE);
    expect(effectiveConditions(state, GRUM).conditions).not.toContain('charmed');
    expect(effectiveConditions(state, GRUM).conditions).not.toContain('frightened');
    // Recorded, not removed: the SRD's other sentence would remove them, and
    // the feature's note says it does not.
    expect(state.creatures.grum!.conditions.conditions).toContain('charmed');
  });

  it('gives them back when the Rage ends', () => {
    const log = raging(charmed(berserker()));
    const ended = [...log, ...unwrap(endFeature(fold('seed', log), GRUM, { feature: RAGE }), 'end')];
    expect(effectiveConditions(fold('seed', ended), GRUM).conditions).toContain('charmed');
  });

  /** A level 3 Berserker has no Mindless Rage, and raging suppresses nothing. */
  it('is not granted before its level', () => {
    const state = fold('seed', raging(charmed(made())));
    expect(effectiveConditions(state, GRUM).conditions).toContain('charmed');
  });
});
