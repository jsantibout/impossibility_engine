import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, expect as unwrap, isErr, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, restoreRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { resolveAttack, resolveMove, resolveTurn } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { checkContent } from './content.js';

/**
 * SRD Cunning Strike — Sneak Attack dice spent as a price, and the three
 * things the price buys.
 *
 * > "When you deal Sneak Attack damage, you can add one of the following
 * > Cunning Strike effects. Each effect has a die cost, which is the number of
 * > Sneak Attack damage dice you must forgo to add the effect. You remove the
 * > die before rolling, and the effect occurs immediately after the attack's
 * > damage is dealt."
 *
 * Two shapes meet here and neither is Cunning Strike's own. The trigger is the
 * hit rider SRD Stunning Strike already rides on; the price is the one thing a
 * rider could not say — **a sibling feature's damage dice**, which is neither a
 * pool nor a slot. So the grant names the feature whose dice pay
 * (`forgoesDiceOf`) exactly as it already names the feature whose *pool* pays,
 * and the count is on the option because the book puts it there: "Each effect
 * has a die cost."
 *
 * **The price is settled where the dice are gathered**, which is
 * `standingAttackDamage` and not the swing. Whether a blow deals Sneak Attack
 * damage at all is a fact about the roll — "if you have Advantage on the roll"
 * — and the roll has not happened when the rider is asked for. So the swing
 * refuses what a *sheet* can answer (this creature has no such dice, or fewer
 * than the price), and a blow that turned out not to be a Sneak Attack drops
 * the rider unspent and says so, which is the answer `applyHitRider` already
 * gives a pool that emptied inside a hold.
 */

const id = (s: string) => asCharacterId(s);
const NYX = id('nyx');
const THUG = id('thug');
const OGRE = id('ogre');
const ALLY = id('ally');

const CUNNING = 'rogue:cunning-strike';

const plain = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 14, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
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

/** A real Rogue 5, built through creation: the dice are the class table's. */
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
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  subclassId: 'thief',
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
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
    'rogue:ability-score-improvement': { featId: 'defense' },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
});

const added = (
  who: CharacterId,
  side: string,
  sheet: CharacterSheet,
  over: Partial<Extract<GameEvent, { type: 'creature-added' }>> = {},
): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet,
  maxHp: 200,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
  ...over,
});

const at = (who: CharacterId, from: CharacterId, feet: number, bearing: number): GameEvent => ({
  type: 'creature-placed',
  id: who,
  placement: { from: { creature: from }, feet, bearing },
});

/**
 * The Rogue, a thug at arm's length, an Ogre further off, and a fight.
 *
 * The Poisoner's Kit is handed over rather than bought: SRD Rogue equipment
 * option A carries Thieves' Tools and no kit, and what is under test is the
 * sentence that reads the inventory rather than the shopping.
 */
const alley = (kit = true): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, rogue(), NYX), 'rogue') as GameEvent[]),
  { type: 'creature-side-declared', id: NYX, side: 'party' },
  added(THUG, 'thugs', plain()),
  added(OGRE, 'thugs', plain(), { size: 'huge' }),
  added(ALLY, 'party', plain()),
  ...(kit
    ? [
        {
          type: 'items-gained' as const,
          id: NYX,
          items: [{ id: 'poisoners-kit', quantity: 1 }],
          source: 'the guild',
        },
      ]
    : []),
  { type: 'scene-set', extent: { width: 2000, depth: 2000, height: 40 } },
  { type: 'landmark-added', name: 'the alley', at: { x: 500, y: 500, z: 0 } },
  { type: 'creature-placed', id: NYX, placement: { from: { landmark: 'the alley' }, feet: 0 } },
  at(THUG, NYX, 5, 0),
  at(OGRE, NYX, 5, 90),
  // Well clear, so the ally clause of Sneak Attack only fires when moved in.
  at(ALLY, NYX, 200, 180),
  {
    type: 'combat-started',
    combatants: [
      { id: NYX, initiative: 20, speed: 30 },
      { id: THUG, initiative: 10, speed: 30 },
      { id: OGRE, initiative: 8, speed: 30 },
      { id: ALLY, initiative: 5, speed: 30 },
    ],
  },
];

const supply = (seed = 'stab', save?: number) => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
  ...(save === undefined ? {} : { bonuses: [{ source: 'the test insists', flat: save }] }),
});

/** The die is the engine's; which side of the DC it lands on is the test's. */
const DOOMED = -40;
const CERTAIN = 40;

interface Swing {
  readonly target?: CharacterId;
  readonly option?: string;
  readonly feature?: string;
  readonly advantage?: boolean;
  readonly weapon?: string;
  readonly save?: number;
  readonly free?: boolean;
}

/** A dagger in the back, with the attack roll forced to land. */
const stab = (log: readonly GameEvent[], swing: Swing = {}) =>
  resolveAttack(
    fold('seed', log),
    NYX,
    {
      target: swing.target ?? THUG,
      weapon: swing.weapon ?? 'dagger',
      attackBonuses: [{ source: 'forced', flat: 40 }],
      ...(swing.advantage === false
        ? {}
        : { modes: [{ source: 'hidden', mode: 'advantage' as const }] }),
      ...(swing.option === undefined
        ? {}
        : { onHit: { feature: swing.feature ?? CUNNING, option: swing.option } }),
      ...(swing.free === true ? { free: true } : {}),
    },
    supply('stab', swing.save),
  );

const landed = (log: readonly GameEvent[], swing: Swing = {}) => {
  const out = unwrap(stab(log, swing), 'stab');
  if (out.attack?.hit !== true) throw new Error('the fixture meant this swing to land');
  const after = [...log, ...out.events];
  return { out, log: after, state: fold('seed', after) };
};

/** Every die the named damage component threw, off the log rather than the return. */
const sliceDice = (events: readonly GameEvent[], source: string): number => {
  const recorded = events.find((event) => event.type === 'damage-dice-recorded');
  if (recorded?.type !== 'damage-dice-recorded') return -1;
  const slice = recorded.components.find((one) => one.source === source);
  return slice === undefined ? -1 : slice.dice.length;
};

const labels = (events: readonly GameEvent[]): readonly string[] =>
  events.flatMap((event) => (event.type === 'roll-recorded' ? [event.label] : []));

/** What the save the rider forced came to, so a DC can be pinned either side of it. */
const saveTotal = (events: readonly GameEvent[]): number => {
  const rolled = events.find(
    (event) => event.type === 'roll-recorded' && event.label.startsWith('Constitution save'),
  );
  if (rolled?.type !== 'roll-recorded') throw new Error('no save was rolled');
  return rolled.total;
};

const conditionsOn = (state: GameState, who: CharacterId): readonly string[] =>
  state.creatures[who]?.conditions.conditions ?? [];

/** One turn of the order, with the repeats it raises rolled at a stated total. */
const turn = (log: readonly GameEvent[], save: number): readonly GameEvent[] => {
  const state = fold('seed', log);
  const out = unwrap(
    resolveTurn(state, {
      issuer: createRollIssuer('r', state.rollsIssued),
      rng: (state.rng === null ? createRng('turn') : restoreRng(state.rng)) as Rng,
      content: SRD_CONTENT,
      bonuses: [{ source: 'the test insists', flat: save }],
    }),
    'turn',
  );
  return [...log, ...out.events];
};

describe('SRD Cunning Strike — the price is Sneak Attack dice', () => {
  it('removes one d6 from the Sneak Attack before the roll and leaves the rest', () => {
    // SRD Rogue 5: three Sneak Attack dice. "remove 1d6 from the Sneak
    // Attack's damage before rolling" leaves two.
    const bare = landed(alley());
    expect(sliceDice(bare.out.events, 'Sneak Attack')).toBe(3);

    const poisoned = landed(alley(), { option: 'poison', save: DOOMED });
    expect(sliceDice(poisoned.out.events, 'Sneak Attack')).toBe(2);
  });

  it('forces a Constitution save at 8 plus Proficiency Bonus and Dexterity', () => {
    // SRD: "the DC equals 8 plus your Dexterity modifier and Proficiency
    // Bonus." Rogue 5: Proficiency Bonus 3, Dexterity 15 for a modifier of 2,
    // so 13 — pinned by the two totals either side of it rather than by a
    // string, because the label carries no DC and a number that is only in a
    // sentence is not a number the engine used.
    const bare = landed(alley(), { option: 'poison' });
    expect(labels(bare.out.events).some((one) => one === 'Constitution save vs Poison')).toBe(true);
    const rolled = saveTotal(bare.out.events);

    const short = landed(alley(), { option: 'poison', save: 12 - rolled });
    expect(conditionsOn(short.state, THUG)).toContain('poisoned');

    const exact = landed(alley(), { option: 'poison', save: 13 - rolled });
    expect(conditionsOn(exact.state, THUG)).not.toContain('poisoned');
  });

  it('leaves a failed target Poisoned for a minute, and frees a success at the end of its turn', () => {
    const { state, log } = landed(alley(), { option: 'poison', save: DOOMED });
    expect(conditionsOn(state, THUG)).toContain('poisoned');

    // SRD: "At the end of each of its turns, the Poisoned target repeats the
    // save, ending the effect on itself on a success."
    const instance = Object.keys(state.timers).find((key) => key.includes('poisoned'));
    expect(instance).toBeDefined();
    expect(state.timers[instance ?? '']?.repeatSave?.at).toBe('end-of-turn');

    // The Rogue's turn ends, then the thug's: the repeat is raised at the end
    // of the *thug's* turn and a success ends it on them.
    const toTheThug = turn(log, DOOMED);
    expect(conditionsOn(fold('seed', toTheThug), THUG)).toContain('poisoned');

    const shaken = turn(toTheThug, CERTAIN);
    expect(conditionsOn(fold('seed', shaken), THUG)).not.toContain('poisoned');
  });

  it('keeps a target that fails the repeat Poisoned', () => {
    const { log } = landed(alley(), { option: 'poison', save: DOOMED });
    const twice = turn(turn(log, DOOMED), DOOMED);
    expect(conditionsOn(fold('seed', twice), THUG)).toContain('poisoned');
  });

  it('refuses Poison without a Poisoner’s Kit, before the die', () => {
    const refused = stab(alley(false), { option: 'poison' });
    expect(isErr(refused) && refused.code).toBe('item_not_carried');

    // Nothing was spent: the refusal arrives before the roll.
    expect(fold('seed', alley(false)).combat?.budgets[NYX]?.action).toBe(true);
  });

  it('knocks a Medium target Prone with Trip, and refuses a Huge one before anything is spent', () => {
    const { state } = landed(alley(), { option: 'trip', save: DOOMED });
    expect(conditionsOn(state, THUG)).toContain('prone');

    const stands = landed(alley(), { option: 'trip', save: CERTAIN });
    expect(conditionsOn(stands.state, THUG)).not.toContain('prone');

    // SRD: "If the target is Large or smaller." The Ogre is Huge.
    const refused = stab(alley(), { option: 'trip', target: OGRE });
    expect(isErr(refused) && refused.code).toBe('target_too_large');
    expect(fold('seed', alley()).combat?.budgets[NYX]?.action).toBe(true);
  });

  it('gates the size on Trip alone, because that is where the SRD prints it', () => {
    // Poison and Withdraw print no size clause, so an Ogre is a legal target
    // for both. A gate written on the grant would have caught all three.
    const { state } = landed(alley(), { option: 'poison', target: OGRE, save: DOOMED });
    expect(conditionsOn(state, OGRE)).toContain('poisoned');
  });

  it('hands the turn half a Speed for Withdraw, which provokes nobody', () => {
    // SRD: "Immediately after the attack, you move up to half your Speed
    // without provoking Opportunity Attacks." Speed 30, so fifteen feet.
    const { state, log } = landed(alley(), { option: 'withdraw' });
    const granted = state.combat?.budgets[NYX]?.grantedMoves ?? [];
    expect(granted).toHaveLength(1);
    expect(granted[0]?.feet).toBe(15);

    const source = granted[0]?.source ?? '';
    const away = unwrap(
      resolveMove(
        state,
        NYX,
        {
          placement: { from: { creature: NYX }, feet: 15, bearing: 180 },
          usingGrant: source,
        },
        supply('walk'),
      ),
      'withdraw',
    );
    // The thug is still standing where it was, five feet from where the Rogue
    // started, and is offered nothing: feet a feature hands over provoke
    // nobody. A move that owes somebody a swing declares it instead of
    // happening, so the creature simply moved.
    expect(away.events.some((event) => event.type === 'movement-declared')).toBe(false);
    expect(away.events.some((event) => event.type === 'creature-moved')).toBe(true);

    // And the Rogue's own thirty feet are untouched.
    const after = fold('seed', [...log, ...away.events]);
    expect(after.combat?.budgets[NYX]?.movementSpent).toBe(0);
    expect(after.combat?.budgets[NYX]?.grantedMoves[0]?.feet).toBe(0);
  });

  it('walks away from a rider that provokes, so the suppression is the grant’s', () => {
    // The discriminating half: the same Rogue, the same fifteen feet, out of
    // their own Speed instead of out of the grant. The thug is owed a swing.
    const { state } = landed(alley(), { option: 'withdraw' });
    const own = unwrap(
      resolveMove(
        state,
        NYX,
        { placement: { from: { creature: NYX }, feet: 15, bearing: 180 } },
        supply('walk'),
      ),
      'walk',
    );
    expect(own.events.some((event) => event.type === 'movement-declared')).toBe(true);
  });

  it('drops the rider on a hit that dealt no Sneak Attack damage, and deals ordinary damage', () => {
    // No Advantage and no ally within five feet of the target: the blow is a
    // dagger and nothing more. The rider cannot be paid for, so it is dropped
    // unspent and said out loud — the answer a pool that emptied inside a hold
    // already gets.
    const { out, state } = landed(alley(), { option: 'trip', advantage: false, save: DOOMED });
    expect(sliceDice(out.events, 'Sneak Attack')).toBe(-1);
    expect(conditionsOn(state, THUG)).not.toContain('prone');
    expect(out.unverified.join(' ')).toContain('Cunning Strike');
    expect(out.damage ?? 0).toBeGreaterThan(0);
  });

  it('buys one effect per hit, because a second swing has no dice left to forgo', () => {
    // SRD prints "one of the following", and the shape is what holds it: a
    // swing names one option. The second hit on the same turn deals no Sneak
    // Attack damage at all — "Once per turn" — so a second Cunning Strike on
    // that turn has nothing to pay with and is dropped.
    const first = landed(alley(), { option: 'trip', save: DOOMED });
    expect(conditionsOn(first.state, THUG)).toContain('prone');

    const second = landed(first.log, { option: 'poison', free: true, save: DOOMED });
    expect(conditionsOn(second.state, THUG)).not.toContain('poisoned');
    expect(second.out.unverified.join(' ')).toContain('Cunning Strike');
  });

  it('refuses an option the feature does not print', () => {
    const refused = stab(alley(), { option: 'decapitate' });
    expect(isErr(refused) && refused.code).toBe('no_such_option');
  });
});

describe('a rider whose price is dice its holder has not got', () => {
  /**
   * The sheet-answerable half of the price, refused at the swing.
   *
   * A homebrew rider that spends the dice of a feature nobody holds is the
   * shape, and it is the one `no_dice_to_forgo` exists for: everything about
   * the price that a *sheet* can settle is settled before the die, exactly as
   * the pool is.
   */
  const THIEF = id('thief');

  const withRider = (over: Record<string, unknown>): CharacterSheet =>
    plain({
      abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
      hitOptions: [
        {
          feature: 'homebrew:cutthroat',
          featureName: 'Cutthroat',
          option: 'gouge',
          name: 'Gouge',
          pool: null,
          costs: 0,
          ability: 'dex',
          effects: [{ kind: 'save', ability: 'dex', condition: 'prone' }],
          ...over,
        },
      ],
    } as Partial<CharacterSheet>);

  const scene = (sheet: CharacterSheet): readonly GameEvent[] => [
    added(THIEF, 'party', sheet),
    added(THUG, 'thugs', plain()),
    {
      type: 'items-gained',
      id: THIEF,
      items: [{ id: 'dagger', quantity: 1 }],
      source: 'the guild',
    },
    { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
    { type: 'landmark-added', name: 'the alley', at: { x: 50, y: 50, z: 0 } },
    { type: 'creature-placed', id: THIEF, placement: { from: { landmark: 'the alley' }, feet: 0 } },
    at(THUG, THIEF, 5, 0),
  ];

  const swing = (sheet: CharacterSheet) =>
    resolveAttack(
      fold('seed', scene(sheet)),
      THIEF,
      {
        target: THUG,
        weapon: 'dagger',
        attackBonuses: [{ source: 'forced', flat: 40 }],
        onHit: { feature: 'homebrew:cutthroat', option: 'gouge' },
      },
      supply(),
    );

  it('refuses a rider that spends dice of a feature its holder has not got', () => {
    const refused = swing(withRider({ forgoesDiceOf: 'homebrew:backstab', costsDice: 1 }));
    expect(isErr(refused) && refused.code).toBe('no_dice_to_forgo');
  });

  it('lets a rider with no dice price through, which is every rider before this', () => {
    const out = swing(withRider({}));
    expect(isErr(out)).toBe(false);
  });
});

/**
 * The authoring door, on the two names a dice price uses and its two halves.
 *
 * Every failure here is the same shape, which is the shape this whole layer
 * exists to catch: a sentence that would **validate, compile and do nothing**.
 * A count with no feature to take it from is a number the swing never spends;
 * a feature named where nothing costs anything is a price nobody pays; and a
 * rider priced in both a pool and a sibling's dice is two prices for one
 * purchase with nothing to say which is paid first.
 */
describe('a rider priced in dice, at the authoring door', () => {
  const TABLE = Array.from({ length: 20 }, (_, index) => ({
    level: index + 1,
    proficiencyBonus: 2 + Math.floor(index / 4),
  }));

  const clazz = (grant: Record<string, unknown>): unknown => ({
    id: 'warden',
    name: 'Warden',
    primaryAbility: 'wis',
    hitDie: 8,
    saveProficiencies: ['wis', 'cha'],
    skillChoices: { choose: 2, from: ['insight', 'perception'] },
    weaponProficiencies: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    subclassLevel: 3,
    table: TABLE,
    startingEquipment: [{ option: 'A', items: [], goldPieces: 50 }],
    multiclass: {
      weapons: ['simple'],
      armorTraining: { light: true, medium: false, heavy: false, shields: false },
      tools: [],
    },
    features: [
      {
        id: 'warden:bite',
        name: 'Warden’s Bite',
        level: 1,
        automation: 'engine',
        note: 'Dice a qualifying hit adds.',
        grants: {
          kind: 'standing',
          reach: 'self',
          effects: [{ kind: 'attack-damage', dice: '1d6', oncePerTurn: true }],
        },
      },
      {
        id: 'warden:riposte',
        name: 'Warden’s Riposte',
        level: 3,
        automation: 'engine',
        note: 'An effect list a landed blow buys, paid for in the bite’s own dice.',
        grants: { kind: 'on-hit', options: [], ...grant },
      },
    ],
  });

  const at = 'classes[warden].features[1].grants';

  const codes = (grant: Record<string, unknown>): readonly string[] =>
    checkContent({
      classes: [clazz(grant) as never],
      // The one item these riders ask for, rather than the whole catalogue:
      // a fixture holding one invented class cannot answer for the classes
      // the SRD's magic items require attunement by.
      items: SRD_CONTENT.items.filter((item) => item.id === 'poisoners-kit') as never,
    }).map((problem) => `${problem.code} @ ${problem.field}`);

  const TRIP: Record<string, unknown> = {
    id: 'trip',
    name: 'Trip',
    costsDice: 1,
    effects: [{ kind: 'save', ability: 'dex', condition: 'prone' }],
  };

  it('admits a rider whose price is a sibling feature’s dice', () => {
    expect(codes({ forgoesDiceOf: 'warden:bite', options: [TRIP] })).toEqual([]);
  });

  it('refuses a price with no feature to take it from', () => {
    expect(codes({ options: [TRIP] })).toContain(
      `dice_cost_without_a_source @ ${at}.options[0].costsDice`,
    );
  });

  it('refuses a feature named where no option costs anything', () => {
    const free = { ...TRIP, costsDice: undefined };
    expect(codes({ forgoesDiceOf: 'warden:bite', options: [free] })).toContain(
      `dice_source_without_a_cost @ ${at}.forgoesDiceOf`,
    );
  });

  it('refuses a rider priced in a pool and in dice at once', () => {
    expect(codes({ forgoesDiceOf: 'warden:bite', pool: 'rebuke', options: [TRIP] })).toContain(
      `rider_priced_twice @ ${at}.forgoesDiceOf`,
    );
  });

  it('refuses a feature nothing in reach carries, and a feature paying itself', () => {
    expect(codes({ forgoesDiceOf: 'warden:fang', options: [TRIP] })).toContain(
      `bad_forgone_dice @ ${at}.forgoesDiceOf`,
    );
    expect(codes({ forgoesDiceOf: 'warden:riposte', options: [TRIP] })).toContain(
      `bad_forgone_dice @ ${at}.forgoesDiceOf`,
    );
    expect(codes({ forgoesDiceOf: '  ', options: [TRIP] })).toContain(
      `bad_rider_dice_source @ ${at}.forgoesDiceOf`,
    );
  });

  it('refuses a count that is not a whole number of dice', () => {
    expect(codes({ forgoesDiceOf: 'warden:bite', options: [{ ...TRIP, costsDice: 0 }] })).toContain(
      `bad_rider_dice_cost @ ${at}.options[0].costsDice`,
    );
  });

  it('refuses a required item no catalogue sells, and admits one it does', () => {
    expect(
      codes({
        forgoesDiceOf: 'warden:bite',
        options: [{ ...TRIP, requiresItem: 'alchemists-dream' }],
      }),
    ).toContain(`unknown_required_item @ ${at}.options[0].requiresItem`);
    expect(
      codes({
        forgoesDiceOf: 'warden:bite',
        options: [{ ...TRIP, requiresItem: 'poisoners-kit' }],
      }),
    ).toEqual([]);
  });

  it('holds an option’s own size clause to the printed sizes', () => {
    expect(
      codes({
        forgoesDiceOf: 'warden:bite',
        options: [{ ...TRIP, targetNoLargerThan: 'enormous' }],
      }),
    ).toContain(`bad_rider_size_limit @ ${at}.options[0].targetNoLargerThan`);
    expect(
      codes({
        forgoesDiceOf: 'warden:bite',
        options: [{ ...TRIP, targetNoLargerThan: 'large' }],
      }),
    ).toEqual([]);
  });

  /**
   * And the move an option hands over is a purchase like the shove beside it:
   * SRD Cunning Strike's Withdraw prints an empty effect list and buys
   * something all the same.
   */
  it('admits an option whose whole purchase is a move', () => {
    expect(
      codes({
        forgoesDiceOf: 'warden:bite',
        options: [
          {
            id: 'away',
            name: 'Away',
            costsDice: 1,
            effects: [],
            handsMove: { share: 'half-speed' },
          },
        ],
      }),
    ).toEqual([]);
  });
});
