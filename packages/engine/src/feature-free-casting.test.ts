import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import { createRng, restoreRng } from './dice.js';
import { checkContent, extendContent, parseClassDefinition } from './content.js';
import type { ClassDefinition } from './progression.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { remaining, spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { beginRest, endRest, LONG_REST } from './rest.js';
import { resolveSpell } from './commands.js';

/**
 * A spell a **feature** lets you cast without a slot, paid for out of a pool
 * the feature declares.
 *
 * SRD writes the sentence on class feature after class feature — "You always
 * have the _Hunter's Mark_ spell prepared. You can cast it twice without
 * expending a spell slot", "You can also cast it without expending a spell
 * slot", "you can expend a use of your Wild Shape to cast _Find Familiar_" —
 * and the engine could say it for a **feat** and for an **item** and for no
 * class feature at all. `GrantedSpell.freeCastPool` and `choosePayment` have
 * been the mechanism since Magic Initiate landed; what nothing could do was
 * put a class feature's own pool behind it.
 *
 * **The same answer the effect list got**, one host along: the free casting
 * hangs off the `spells` grant the feature already carries rather than
 * becoming a grant kind of its own, because `FeatureDefinition.grants` is
 * singular and the SRD's sentence is one feature's — the feature that grants
 * the spell *is* the feature that pays for casting it. There is no new
 * command, no second resolver and no second payment: the casting is the
 * casting every other route takes.
 */

const id = (s: string) => asCharacterId(s);
const SORREL = id('sorrel');
const AELRIC = id('aelric');
const RUBEN = id('ruben');
const THUG = id('thug');

const common = {
  speciesId: 'human',
  backgroundId: 'sage',
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Neutral',
  spellbook: [],
  backgroundEquipment: 'A' as const,
  classEquipment: 'A' as const,
  equipped: [],
  hitPoints: { method: 'fixed' as const },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int' as const,
      cantrips: ['mage-hand', 'light'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'alert' },
  },
};

/** A level 1 Ranger, whose Favored Enemy buys two castings of Hunter's Mark. */
const ranger = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Sorrel',
  classId: 'ranger',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['survival', 'perception', 'stealth'],
  cantrips: [],
  preparedSpells: ['cure-wounds', 'ensnaring-strike'],
  featureChoices: { 'human:skillful': ['athletics'] },
  ...over,
});

/** A level 5 Paladin, whose Faithful Steed buys one casting of Find Steed. */
const paladin = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  ...common,
  name: 'Aelric',
  classId: 'paladin',
  level: 5,
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 14 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['athletics', 'persuasion'],
  subclassId: 'oath-of-devotion',
  cantrips: [],
  preparedSpells: ['bless', 'cure-wounds', 'heroism', 'searing-smite', 'shield-of-faith', 'aid'],
  featureChoices: { 'human:skillful': ['perception'] },
  feats: {
    ...common.feats,
    'paladin:fighting-style': { featId: 'defense' },
    'paladin:ability-score-improvement': { featId: 'savage-attacker' },
  },
  ...over,
});

const thug = (): GameEvent => ({
  type: 'creature-added',
  id: THUG,
  name: 'Thug',
  maxHp: 32,
  creatureType: 'Humanoid',
  sheet: {
    level: 1,
    abilities: { str: 15, dex: 11, con: 14, int: 10, wis: 10, cha: 11 },
    skills: {},
    saveProficiencies: [],
    armor: null,
    shield: null,
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    baseSpeed: 30,
    spellcastingAbility: null,
    stated: { armorClass: 12, proficiencyBonus: 2, initiative: 0 },
  },
});

/** The caster, a thug twenty feet off, and a fight in which the caster acts. */
const table = (made: readonly GameEvent[], who: CharacterId): GameEvent[] => [
  ...made,
  thug(),
  { type: 'scene-set', extent: { width: 200, depth: 200, height: 40 } },
  { type: 'landmark-added', name: 'the road', at: { x: 20, y: 20, z: 0 } },
  { type: 'creature-placed', id: who, placement: { from: { landmark: 'the road' }, feet: 0 } },
  {
    type: 'creature-placed',
    id: THUG,
    placement: { from: { creature: who }, feet: 20, bearing: 0 },
  },
  { type: 'sight-declared', from: who, to: THUG, seen: true },
  {
    type: 'combat-started',
    combatants: [
      { id: who, initiative: 20, speed: 30 },
      { id: THUG, initiative: 5, speed: 30 },
    ],
  },
];

/** The same table with nobody rolling Initiative: outside combat nothing pays an action. */
const peace = (made: readonly GameEvent[], who: CharacterId): GameEvent[] =>
  table(made, who).filter((event) => event.type !== 'combat-started');

const supply = (state: GameState) => ({
  issuer: createRollIssuer('r', state.rollsIssued),
  rng: state.rng === null ? createRng('seed') : restoreRng(state.rng),
  content: SRD_CONTENT,
});

const cast = (
  state: GameState,
  who: CharacterId,
  request: Parameters<typeof resolveSpell>[2],
  content = SRD_CONTENT,
) => resolveSpell(state, who, request, { ...supply(state), content });

describe("a Ranger's Favored Enemy pays for its own castings", () => {
  const log = unwrap(createCharacter(SRD_CONTENT, ranger(), SORREL), 'create');
  const world = table(log, SORREL);

  /**
   * SRD prints the count in the Favored Enemy column of the Ranger table —
   * two at level 1, three at level 5 — so the pool is sized by the column at
   * that class's own level, exactly as Rage's uses are.
   */
  it('declares the pool the class table sizes', () => {
    const pools = fold('seed', log).creatures[SORREL]?.resources.pools ?? {};
    expect(pools['favored-enemy']?.max).toBe(2);
    expect(pools['favored-enemy']?.recovers).toBe('long-rest');

    const five = unwrap(createCharacter(SRD_CONTENT, ranger({ level: 5, subclassId: 'hunter', preparedSpells: ['cure-wounds', 'ensnaring-strike', 'goodberry', 'animal-friendship', 'spike-growth', 'pass-without-trace'], featureChoices: { 'human:skillful': ['athletics'], 'ranger:deft-explorer': ['survival'], 'hunter:hunters-prey': ['Colossus Slayer'] }, feats: { ...common.feats, 'ranger:fighting-style': { featId: 'archery' }, 'ranger:ability-score-improvement': { featId: 'savage-attacker' } } }), SORREL), 'create at 5');
    expect(fold('seed', five).creatures[SORREL]?.resources.pools['favored-enemy']?.max).toBe(3);
  });

  /** And the spell is prepared without anybody choosing it, as it always was. */
  it('has Hunter’s Mark prepared and knows it from the feature too', () => {
    const casting = fold('seed', log).creatures[SORREL]?.spellcasting;
    expect(casting?.classes[0]?.prepared).toContain('hunters-mark');
    expect(casting?.granted).toContainEqual({
      spellId: 'hunters-mark',
      source: 'ranger:favored-enemy',
      ability: 'wis',
      freeCastPool: 'favored-enemy',
      slotCasting: false,
    });
  });

  /**
   * The whole claim, end to end: the pool goes down by one, no slot moves,
   * and what comes back is a *casting* — an id, a record, and a log line
   * saying a special ability paid for it.
   */
  it('casts it out of the pool, spending no slot', () => {
    const state = fold('seed', world);
    const out = unwrap(
      cast(state, SORREL, {
        spellId: 'hunters-mark',
        targets: [THUG],
        source: 'ranger:favored-enemy',
      }),
      'the mark',
    );

    const after = fold('seed', [...world, ...out.events]);
    expect(remaining(after.creatures[SORREL]!.resources, 'favored-enemy')).toBe(1);
    // The two level 1 slots a Ranger has at level 1 are untouched.
    expect(remaining(after.creatures[SORREL]!.resources, spellSlotKey(1))).toBe(2);

    expect(out.castingId).not.toBeNull();
    const spell = out.events.find((event) => event.type === 'spell-cast');
    expect(spell).toMatchObject({
      spell: "Hunter's Mark",
      level: 1,
      slotless: 'special-ability',
      route: 'ranger:favored-enemy',
    });
    expect(spell).not.toHaveProperty('slotLevel');
    // A real casting leaves a real record: Hunter's Mark is Concentration.
    expect(after.ongoing[out.castingId!]).toBeDefined();
    expect(after.creatures[SORREL]?.concentration?.castingId).toBe(out.castingId);
  });

  /** And when the column's uses are gone, the feature says so rather than reaching for a slot. */
  it('refuses a third casting with the pool empty, naming the slot as the way on', () => {
    // Out of combat, where the Bonus Action the spell costs is not a thing
    // anybody holds: what is being counted here is the pool and nothing else.
    let events: GameEvent[] = [...peace(log, SORREL)];
    for (const round of [0, 1]) {
      const out = unwrap(
        cast(fold('seed', events), SORREL, {
          spellId: 'hunters-mark',
          targets: [THUG],
          source: 'ranger:favored-enemy',
          commandId: `mark-${round}`,
        }),
        `mark ${round}`,
      );
      events = [...events, ...out.events];
    }
    expect(remaining(fold('seed', events).creatures[SORREL]!.resources, 'favored-enemy')).toBe(0);

    const refused = cast(fold('seed', events), SORREL, {
      spellId: 'hunters-mark',
      targets: [THUG],
      source: 'ranger:favored-enemy',
      commandId: 'mark-3',
    });
    expect(isErr(refused)).toBe(true);
    if (isErr(refused)) {
      expect(refused.code).toBe('no_free_casting');
      expect(refused.reason).toContain('slot');
    }
  });

  /** The class route is untouched: a slot still casts it, and the pool stays full. */
  it('still casts it with a slot through the class, leaving the pool alone', () => {
    const state = fold('seed', world);
    const out = unwrap(
      cast(state, SORREL, {
        spellId: 'hunters-mark',
        targets: [THUG],
        source: 'class:ranger',
        slotLevel: 1,
      }),
      'the mark, paid for',
    );
    const after = fold('seed', [...world, ...out.events]);
    expect(remaining(after.creatures[SORREL]!.resources, spellSlotKey(1))).toBe(1);
    expect(remaining(after.creatures[SORREL]!.resources, 'favored-enemy')).toBe(2);
  });

  /** A Long Rest gives all of them back, which is the sentence's second half. */
  it('gives every use back on a Long Rest', () => {
    const quiet = peace(log, SORREL);
    const out = unwrap(
      cast(fold('seed', quiet), SORREL, {
        spellId: 'hunters-mark',
        targets: [THUG],
        source: 'ranger:favored-enemy',
      }),
      'the mark',
    );
    const spent = [...quiet, ...out.events];
    expect(remaining(fold('seed', spent).creatures[SORREL]!.resources, 'favored-enemy')).toBe(1);

    const begun = [
      ...spent,
      ...unwrap(beginRest(fold('seed', spent), SORREL, 'long'), 'begin'),
      { type: 'time-advanced' as const, seconds: LONG_REST, reason: 'resting' },
    ];
    const rested = fold('seed', [
      ...begun,
      ...unwrap(endRest(fold('seed', begun), SORREL), 'end').events,
    ]);
    expect(remaining(rested.creatures[SORREL]!.resources, 'favored-enemy')).toBe(2);
  });
});

describe("a Paladin's Faithful Steed casts Find Steed once between rests", () => {
  const log = unwrap(createCharacter(SRD_CONTENT, paladin(), AELRIC), 'create');
  const world = table(log, AELRIC);

  it('prepares the spell and declares a pool of one', () => {
    const state = fold('seed', log);
    expect(state.creatures[AELRIC]?.spellcasting.classes[0]?.prepared).toContain('find-steed');
    expect(state.creatures[AELRIC]?.resources.pools['faithful-steed']?.max).toBe(1);
  });

  /**
   * And the level 4 Paladin has neither, because the feature arrives at 5 —
   * the pool is the class table's at that class's own level like every other.
   */
  it('has neither before level 5', () => {
    const four = unwrap(
      createCharacter(
        SRD_CONTENT,
        paladin({ level: 4, preparedSpells: ['bless', 'cure-wounds', 'heroism', 'searing-smite', 'shield-of-faith'] }),
        AELRIC,
      ),
      'create at 4',
    );
    const state = fold('seed', four);
    expect(state.creatures[AELRIC]?.resources.pools['faithful-steed']).toBeUndefined();
    expect(state.creatures[AELRIC]?.spellcasting.classes[0]?.prepared).not.toContain('find-steed');
  });

  it('casts it out of the pool and spends no slot', () => {
    const state = fold('seed', world);
    const out = unwrap(
      cast(state, AELRIC, {
        spellId: 'find-steed',
        // The spell is on its caster and the steed is what it makes, which is
        // the shape Dimension Door already takes — see the `summon` effect.
        targets: [AELRIC],
        source: 'paladin:faithful-steed',
      }),
      'the steed',
    );
    const after = fold('seed', [...world, ...out.events]);
    expect(remaining(after.creatures[AELRIC]!.resources, 'faithful-steed')).toBe(0);
    expect(remaining(after.creatures[AELRIC]!.resources, spellSlotKey(2))).toBe(2);
    expect(out.events.find((event) => event.type === 'spell-cast')).toMatchObject({
      spell: 'Find Steed',
      level: 2,
      slotless: 'special-ability',
      route: 'paladin:faithful-steed',
    });

    // And the steed itself is there now: the pool paid for a casting that
    // raised a creature out of the bestiary, which is what the `summon`
    // effect kind buys a feature's free casting as well as a slot's.
    expect(after.creatures[asCharacterId(`${out.castingId!}:otherworldly-steed`)]?.name).toBe(
      'Otherworldly Steed',
    );
    // What is left of the spell is the steed's lifetime rather than its
    // existence: nothing binds it, because an Instantaneous casting leaves no
    // record to bind it to.
    expect(out.unverified.join(' ')).toContain('leaving when its summoner dies');
  });
});

/**
 * A homebrew class whose feature casts out of its own pool, through the door
 * the SRD's own classes take and with no engine change at all.
 *
 * It has **no spell slots whatever** — an empty slot column — so the only
 * thing that can pay for the casting is the feature's own pool, and a test
 * that passed by quietly spending a slot could not.
 */
const HEDGEWITCH = JSON.stringify({
  id: 'hedgewitch',
  name: 'Hedgewitch',
  primaryAbility: 'wis',
  spellcasting: { ability: 'wis', style: 'known', progression: 'half', startsAtLevel: 1 },
  hitDie: 8,
  saveProficiencies: ['wis', 'cha'],
  skillChoices: { choose: 2, from: ['nature', 'survival', 'medicine', 'insight'] },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: Array.from({ length: 20 }, (_, i) => ({
    level: i + 1,
    proficiencyBonus: 2 + Math.floor(i / 4),
    preparedSpells: 0,
    spellSlots: [],
  })),
  startingEquipment: [{ option: 'A', items: [{ id: 'quarterstaff', quantity: 1 }], goldPieces: 5 }],
  multiclass: {
    weapons: ['simple'],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  features: [
    {
      id: 'hedgewitch:thornsong',
      name: 'Thornsong',
      level: 1,
      automation: 'engine',
      note: 'Hunter’s Mark is always prepared, and the Thornsong pool buys two castings of it per Long Rest without a spell slot.',
      grants: {
        kind: 'spells',
        fixed: ['hunters-mark'],
        freeCasting: {
          spell: 'hunters-mark',
          pool: 'thornsong',
          poolLabel: 'Thornsong',
          declares: { usesByLevel: Array.from({ length: 20 }, () => 2), recovers: 'long-rest' },
        },
      },
    },
    // And the other half of the vocabulary, which is SRD Wild Companion's:
    // a feature that declares a pool, and a second feature that spends a use
    // of it to cast a spell nothing else gives you.
    {
      id: 'hedgewitch:greenwatch',
      name: 'Greenwatch',
      level: 1,
      automation: 'engine',
      note: 'A pool of two uses per Long Rest, which the Hedgeward feature spends.',
      grants: {
        kind: 'pool',
        key: 'greenwatch',
        label: 'Greenwatch',
        usesByLevel: Array.from({ length: 20 }, () => 2),
        recovers: 'long-rest',
      },
    },
    {
      id: 'hedgewitch:hedgeward',
      name: 'Hedgeward',
      level: 1,
      automation: 'engine',
      note: 'Spends a use of Greenwatch to cast Bless without a spell slot; the spell is not otherwise prepared.',
      grants: {
        kind: 'spells',
        freeCasting: { spell: 'bless', pool: 'greenwatch' },
      },
    },
  ],
});

const hedgewitch = (): CharacterChoices => ({
  ...common,
  name: 'Ruben',
  classId: 'hedgewitch',
  level: 1,
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 10, wis: 15, cha: 12 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['nature', 'survival'],
  cantrips: [],
  preparedSpells: [],
  featureChoices: { 'human:skillful': ['perception'] },
});

describe('a homebrew feature casts out of its own pool with no engine change', () => {
  const parsed = unwrap(parseClassDefinition(JSON.parse(HEDGEWITCH)), 'parse');
  const content = unwrap(extendContent(SRD_CONTENT, { classes: [parsed] }), 'extend');

  it('is validated beside the printed classes', () => {
    expect(
      checkContent({
        classes: [parsed],
        spells: SRD_CONTENT.spells,
        spellEntries: SRD_CONTENT.spellEntries,
      }),
    ).toEqual([]);
    expect(SRD_CONTENT.classById('hedgewitch')).toBeNull();
  });

  it('creates the character with the pool and the granted route', () => {
    const state = fold('seed', unwrap(createCharacter(content, hedgewitch(), RUBEN), 'create'));
    expect(state.creatures[RUBEN]?.resources.pools['thornsong']?.max).toBe(2);
    expect(state.creatures[RUBEN]?.spellcasting.granted).toContainEqual({
      spellId: 'hunters-mark',
      source: 'hedgewitch:thornsong',
      ability: 'wis',
      freeCastPool: 'thornsong',
      slotCasting: false,
    });
    // The class has no slots at all, so nothing else could pay for a casting.
    expect(state.creatures[RUBEN]?.resources.pools[spellSlotKey(1)]).toBeUndefined();
  });

  it('casts it through the public API, spending a use and no slot', () => {
    const log = unwrap(createCharacter(content, hedgewitch(), RUBEN), 'create');
    const world = table(log, RUBEN);
    const out = unwrap(
      cast(
        fold('seed', world),
        RUBEN,
        { spellId: 'hunters-mark', targets: [THUG], source: 'hedgewitch:thornsong' },
        content,
      ),
      'the thornsong',
    );
    const after = fold('seed', [...world, ...out.events]);
    expect(remaining(after.creatures[RUBEN]!.resources, 'thornsong')).toBe(1);
    expect(out.events.find((event) => event.type === 'spell-cast')).toMatchObject({
      slotless: 'special-ability',
      route: 'hedgewitch:thornsong',
    });
  });

  /**
   * The other half of the vocabulary, which is the half SRD Wild Companion
   * needs: a feature that spends a pool it did **not** declare, to cast a
   * spell nothing else on the sheet supplies.
   *
   * The pool is declared once, by the feature whose pool it is, and the
   * spender adds no second declaration — which is what the loop over a grant's
   * own free casting would otherwise have done.
   */
  it('spends a pool another feature declared, and declares none of its own', () => {
    const log = unwrap(createCharacter(content, hedgewitch(), RUBEN), 'create');
    expect(
      log.filter(
        (event) => event.type === 'resource-pool-declared' && event.pool.key === 'greenwatch',
      ),
    ).toHaveLength(1);

    const state = fold('seed', log);
    expect(state.creatures[RUBEN]?.resources.pools['greenwatch']?.max).toBe(2);
    expect(state.creatures[RUBEN]?.spellcasting.granted).toContainEqual({
      spellId: 'bless',
      source: 'hedgewitch:hedgeward',
      ability: 'wis',
      freeCastPool: 'greenwatch',
      slotCasting: false,
    });
    // Bless is on no list this character has: the free casting is the only
    // route to it, which is what makes the pool the only thing paying.
    expect(state.creatures[RUBEN]?.spellcasting.classes[0]?.prepared).not.toContain('bless');

    const world = table(log, RUBEN);
    const out = unwrap(
      cast(
        fold('seed', world),
        RUBEN,
        { spellId: 'bless', targets: [RUBEN], source: 'hedgewitch:hedgeward' },
        content,
      ),
      'the hedgeward',
    );
    const after = fold('seed', [...world, ...out.events]);
    expect(remaining(after.creatures[RUBEN]!.resources, 'greenwatch')).toBe(1);
    // And the pool it did not touch: the feature's own casting is not free.
    expect(remaining(after.creatures[RUBEN]!.resources, 'thornsong')).toBe(2);
    expect(out.events.find((event) => event.type === 'spell-cast')).toMatchObject({
      spell: 'Bless',
      slotless: 'special-ability',
      route: 'hedgewitch:hedgeward',
    });
  });
});

/**
 * What the door refuses, which is the other half of a vocabulary being real.
 *
 * Each is a malformed catalogue rather than a malformed command: a free
 * casting of a spell nothing can execute, a column that is not this source's
 * table, and a pool with no sizing and no owner.
 */
describe('a free casting is validated where the rest of the catalogue is', () => {
  const withFeatures = (features: readonly unknown[], over: Record<string, unknown> = {}): unknown => ({
    ...JSON.parse(HEDGEWITCH),
    features,
    ...over,
  });

  const withGrant = (grant: unknown): unknown =>
    withFeatures([{ ...JSON.parse(HEDGEWITCH).features[0], grants: grant }]);

  /**
   * Every problem at once rather than the first, which is what `checkContent`
   * is for — and against the printed spells, so "this content has no
   * definition of it" means what it says rather than "no spell was handed to
   * the checker".
   */
  const codesOf = (grant: unknown): readonly string[] =>
    checkContent({
      classes: [withGrant(grant) as ClassDefinition],
      spells: SRD_CONTENT.spells,
      spellEntries: SRD_CONTENT.spellEntries,
    }).map((problem) => problem.code);

  it('refuses a spell this content has no definition of', () => {
    expect(
      codesOf({
        kind: 'spells',
        freeCasting: {
          spell: 'thorn-serenade',
          pool: 'thornsong',
          declares: { minimum: 1, recovers: 'long-rest' },
        },
      }),
    ).toContain('unknown_free_casting');
  });

  it('refuses a column that is not this source’s table', () => {
    expect(
      codesOf({
        kind: 'spells',
        fixed: ['hunters-mark'],
        freeCasting: {
          spell: 'hunters-mark',
          pool: 'thornsong',
          declares: { usesByLevel: [2, 2, 2], recovers: 'long-rest' },
        },
      }),
    ).toContain('not_a_table_column');
  });

  it('refuses a free casting with no pool to come out of', () => {
    expect(
      codesOf({
        kind: 'spells',
        fixed: ['hunters-mark'],
        freeCasting: { spell: 'hunters-mark', pool: '', declares: { minimum: 1, recovers: 'long-rest' } },
      }),
    ).toContain('free_casting_without_a_pool');
  });

  /**
   * A free casting nothing will ever read, which is the door
   * `item_casting_on_a_feature` is in the other direction.
   *
   * It is compiled by the loop over a character's **casting classes**, on
   * that class's own spellcasting ability, so one written on a class that
   * casts nothing declares a live pool and a route nobody has.
   */
  it('refuses a free casting on a source with no spellcasting to make it with', () => {
    const castless = { ...(withGrant(JSON.parse(HEDGEWITCH).features[0].grants) as object) };
    delete (castless as Record<string, unknown>)['spellcasting'];
    expect(
      checkContent({
        classes: [castless as ClassDefinition],
        spells: SRD_CONTENT.spells,
        spellEntries: SRD_CONTENT.spellEntries,
      }).map((problem) => problem.code),
    ).toContain('free_casting_without_a_caster');
  });

  /**
   * And a pool that is nobody's: a free casting sizes its own through
   * `declares`, or comes out of one a feature beside it declared. A key that
   * names neither refuses every casting it offers, at the table.
   */
  it('refuses a borrowed pool no feature of this source declares', () => {
    expect(
      codesOf({
        kind: 'spells',
        fixed: ['hunters-mark'],
        freeCasting: { spell: 'hunters-mark', pool: 'thornsnog' },
      }),
    ).toContain('unknown_free_casting_pool');
  });

  /** And one that arrives after the feature spending it. */
  it('refuses a borrowed pool that is declared at a later level', () => {
    const problems = checkContent({
      classes: [
        withFeatures([
          {
            id: 'hedgewitch:hedgeward',
            name: 'Hedgeward',
            level: 1,
            automation: 'engine',
            note: 'Spends a use of Greenwatch to cast Bless without a spell slot.',
            grants: { kind: 'spells', freeCasting: { spell: 'bless', pool: 'greenwatch' } },
          },
          {
            id: 'hedgewitch:greenwatch',
            name: 'Greenwatch',
            level: 7,
            automation: 'engine',
            note: 'A pool of two uses per Long Rest.',
            grants: {
              kind: 'pool',
              key: 'greenwatch',
              label: 'Greenwatch',
              usesByLevel: Array.from({ length: 20 }, () => 2),
              recovers: 'long-rest',
            },
          },
        ]) as ClassDefinition,
      ],
      spells: SRD_CONTENT.spells,
      spellEntries: SRD_CONTENT.spellEntries,
    });
    expect(problems.map((problem) => problem.code)).toContain('free_casting_pool_arrives_later');
  });

  /**
   * And the untyped door refuses it too, which is the one a DM's file takes:
   * `parseClassDefinition` stops at the first problem and never produces a
   * class whose free casting is sized by a column of the wrong length.
   */
  it('is refused at the untyped door as well as by the checker', () => {
    const parsed = parseClassDefinition(
      withGrant({
        kind: 'spells',
        fixed: ['hunters-mark'],
        freeCasting: {
          spell: 'hunters-mark',
          pool: 'thornsong',
          declares: { usesByLevel: [2, 2, 2], recovers: 'long-rest' },
        },
      }),
    );
    expect(isErr(parsed)).toBe(true);
    if (isErr(parsed)) expect(parsed.reason).toContain('grants.freeCasting.declares.usesByLevel');
  });
});
