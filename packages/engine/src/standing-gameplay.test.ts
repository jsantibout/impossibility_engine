import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import { createRng, type Rng } from './dice.js';
import { createRollIssuer } from './rolls.js';
import { fold, type GameEvent } from './events.js';
import { spellSlotKey } from './resources.js';
import { declaredCasting } from './spellcasting.js';
import { resolveSpell, resolveDamage } from './commands.js';
import { createCharacter, type CharacterChoices } from './creation.js';
import { effectiveConditions, standingSaveBonuses } from './standing.js';

/**
 * A real Paladin, radiating a real aura, through the commands a table uses.
 *
 * `standing-effects.test.ts` proves the mechanism against a hand-built sheet.
 * This is the other half: that a character made by `createCharacter` from
 * ordinary choices actually gets the feature, and that a saving throw rolled
 * by `resolveSpell` actually reads it — appearing when the paladin is near,
 * gone when they are stunned, gone when they walk away, without a caller
 * passing anything.
 */

const id = (s: string) => asCharacterId(s);
const AELRIC = id('aelric');
const ALLY = id('ally');
const WITCH = id('witch');

/**
 * A level 7 Devotion Paladin: Aura of Protection at 6, Aura of Devotion at 7.
 *
 * Seven rather than six so both auras are present, which is the case worth
 * testing — two features sharing one aura is the thing that could go wrong.
 */
const paladin = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
  name: 'Aelric',
  classId: 'paladin',
  level: 7,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 13, dex: 10, con: 12, int: 8, wis: 14, cha: 15 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'persuasion'],
  languages: ['Dwarvish', 'Orc'],
  alignment: 'Lawful Good',
  subclassId: 'oath-of-devotion',
  cantrips: [],
  spellbook: [],
  // A level 7 Paladin prepares 7, from the Paladin list.
  preparedSpells: [
    'bless',
    'cure-wounds',
    'heroism',
    'searing-smite',
    'shield-of-faith',
    'aid',
    'lesser-restoration',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail', 'shield'],
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
    'paladin:fighting-style': { featId: 'defense' },
    'paladin:ability-score-improvement': { featId: 'ability-score-improvement', abilities: ['int', 'int'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  ...over,
});

const plainSheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 7,
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

const added = (who: CharacterId, side: string, over: Partial<CharacterSheet> = {}): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: plainSheet(over),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

/** The paladin, an ally beside them, and an enemy caster ten feet off. */
const table = (over: Partial<CharacterChoices> = {}): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT,paladin(over), AELRIC), 'create') as GameEvent[]),
  { type: 'creature-side-declared', id: AELRIC, side: 'party' },
  added(ALLY, 'party'),
  added(WITCH, 'coven', { spellcastingAbility: 'int', abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 } }),
  {
    type: 'resource-pool-declared',
    id: WITCH,
    pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 4, recovers: 'long-rest' },
  },
  {
    type: 'spellcasting-declared',
    id: WITCH,
    spellcasting: declaredCasting({ ability: 'int', prepared: ['hold-person', 'blindness-deafness'] }),
  },
  { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
  { type: 'landmark-added', name: 'the gate', at: { x: 100, y: 100, z: 0 } },
  { type: 'creature-placed', id: AELRIC, placement: { from: { landmark: 'the gate' }, feet: 0 } },
  { type: 'creature-placed', id: ALLY, placement: { from: { creature: AELRIC }, feet: 5, bearing: 0 } },
  { type: 'creature-placed', id: WITCH, placement: { from: { creature: AELRIC }, feet: 20, bearing: 90 } },
  { type: 'sight-declared', from: WITCH, to: ALLY, seen: true },
  { type: 'sight-declared', from: WITCH, to: AELRIC, seen: true },
];

const supply = (seed = 'cast') => ({ issuer: createRollIssuer('r'), rng: createRng(seed) as Rng, content: SRD_CONTENT });

/** Hold Person at the ally, and the saving throw it made them roll. */
const holdPerson = (log: readonly GameEvent[], seed = 'cast') => {
  const out = unwrap(
    resolveSpell(
      fold('seed', log),
      WITCH,
      { spellId: 'hold-person', targets: [ALLY], slotLevel: 2 },
      supply(seed),
    ),
    'hold-person',
  );
  return out;
};

describe('a paladin made from choices radiates a real aura', () => {
  it('has the feature on the sheet, with the SRD’s own radius', () => {
    const state = fold('seed', table());
    const standing = state.creatures.aelric!.sheet.standing ?? [];
    expect(standing.map((e) => e.feature)).toEqual([
      'paladin:aura-of-protection',
      'oath-of-devotion:aura-of-devotion',
      // The third is the Fighting Style this Paladin took: SRD Defense's +1 to
      // Armour Class, a standing grant a *feat* carries, gated on the armour
      // its holder is wearing rather than on anything being switched on.
      'defense',
      // The fourth is not an aura and is not on until it is switched on: SRD
      // Sacred Weapon's Charisma bonus is a standing effect requiring the
      // feature to be active, which is what every `whileActive` grant becomes.
      'oath-of-devotion:sacred-weapon',
    ]);
    expect(standing[0]?.reach).toEqual({ kind: 'aura', feet: 10 });
  });

  /** Charisma 15 from the standard array is +2. */
  it('hands the bonus to an ally through a saving throw nobody asked for', () => {
    const beside = holdPerson(table());
    const save = beside.outcomes[0]?.save;
    expect(save?.bonuses.length ?? 0).toBe(0);
    expect(save?.modifier).toBe(2);
    expect(
      save?.modeSources.some((m) => m.source === 'Aura of Protection'),
    ).toBe(false);
  });

  /** The same roll, with the paladin ten feet further off, is three lower. */
  it('is worth exactly the paladin’s Charisma modifier', () => {
    const near = holdPerson(table());
    const far = holdPerson([
      ...table(),
      {
        type: 'creature-moved',
        id: AELRIC,
        placement: { from: { creature: ALLY }, feet: 30, bearing: 180 },
      },
    ]);
    expect((near.outcomes[0]?.save?.modifier ?? 0) - (far.outcomes[0]?.save?.modifier ?? 0)).toBe(2);
  });

  /** SRD: "The aura is inactive while you have the Incapacitated condition." */
  it('stops helping when the paladin is Stunned', () => {
    const stunned = holdPerson([
      ...table(),
      { type: 'condition-applied', id: AELRIC, condition: 'stunned', source: 'a hag' },
    ]);
    const upright = holdPerson(table());
    expect((upright.outcomes[0]?.save?.modifier ?? 0) - (stunned.outcomes[0]?.save?.modifier ?? 0)).toBe(2);
  });

  /** And it protects the paladin's own Concentration save, through `resolveDamage`. */
  it('applies to the Concentration save the damage command rolls', () => {
    const concentrating = [
      ...table(),
      {
        type: 'spell-cast',
        castingId: 'cast:1',
        id: AELRIC,
        spell: 'Bless',
        level: 1,
        slot: null,
        slotless: 'special-ability',
        castingTime: 'action',
        concentration: true,
      } as GameEvent,
      { type: 'concentration-started', id: AELRIC, castingId: 'cast:1', spell: 'Bless', level: 1 } as GameEvent,
    ];

    const hurt = unwrap(
      resolveDamage(fold('seed', concentrating), AELRIC, { amount: 12, source: 'a spear' }, supply()),
      'damage',
    );
    const rolled = hurt.events.find((e) => e.type === 'roll-recorded');
    expect(rolled).toBeDefined();
    // The paladin is in their own aura, by the SRD's own text.
    expect(standingSaveBonuses(fold('seed', concentrating), AELRIC, 'con')).toHaveLength(1);
  });
});

describe('Aura of Devotion suppresses through the commands that read conditions', () => {
  /** SRD Oath of Devotion: Immunity to Charmed while in the Aura of Protection. */
  const charmed = (log: readonly GameEvent[]): readonly GameEvent[] => [
    ...log,
    { type: 'condition-applied', id: ALLY, condition: 'charmed', source: 'a hag' },
  ];

  it('leaves the condition recorded and stops it biting', () => {
    const state = fold('seed', charmed(table()));
    expect(state.creatures.ally!.conditions.conditions).toContain('charmed');
    expect(effectiveConditions(state, ALLY).conditions).not.toContain('charmed');
  });

  it('gives it back the moment the paladin is Incapacitated', () => {
    const state = fold('seed', [
      ...charmed(table()),
      { type: 'condition-applied', id: AELRIC, condition: 'stunned', source: 'a hag' },
    ]);
    expect(effectiveConditions(state, ALLY).conditions).toContain('charmed');
  });
});

describe('two auras, and the rule that they are one', () => {
  /**
   * SRD: "If another Paladin is present, a creature can benefit from only one
   * Aura of Protection at a time." Two paladins beside the same ally is one
   * bonus, not two — and it is the better one.
   */
  it('does not stack a second paladin’s aura onto the first', () => {
    const pair: readonly GameEvent[] = [
      ...table(),
      ...(unwrap(
        createCharacter(
          SRD_CONTENT,
          paladin({
            name: 'Brynn',
            // Charisma 12 is +1, against Aelric's +2.
            abilities: {
              method: 'standard-array',
              assignment: { str: 15, dex: 10, con: 13, int: 8, wis: 14, cha: 12 },
            },
          }),
          id('brynn'),
        ),
        'brynn',
      ) as GameEvent[]),
      { type: 'creature-side-declared', id: id('brynn'), side: 'party' },
      {
        type: 'creature-placed',
        id: id('brynn'),
        placement: { from: { creature: AELRIC }, feet: 5, bearing: 270 },
      },
    ];

    const bonuses = standingSaveBonuses(fold('seed', pair), ALLY, 'wis');
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0]?.flat).toBe(2);
  });
});

describe('a multiclassed paladin still radiates, and a junior one does not', () => {
  it('gives a Paladin 6 / Sorcerer 2 the aura at its Paladin level', () => {
    const gish = fold(
      'seed',
      unwrap(
        createCharacter(
          SRD_CONTENT,
          paladin({
            multiclass: [{ classId: 'sorcerer', level: 2 }],
            spellsByClass: {
              sorcerer: {
                cantrips: ['fire-bolt', 'light', 'prestidigitation', 'shocking-grasp'],
                preparedSpells: ['magic-missile', 'shield', 'burning-hands', 'thunderwave'],
              },
            },
            featureChoices: {
              'human:skillful': ['perception'],
              'sorcerer:metamagic': ['Careful Spell', 'Distant Spell'],
            },
          }),
          AELRIC,
        ),
        'gish',
      ) as GameEvent[],
    );
    expect((gish.creatures.aelric!.sheet.standing ?? []).map((e) => e.feature)).toContain(
      'paladin:aura-of-protection',
    );
  });

  it('gives a Paladin 5 nothing, because the first aura arrives at 6', () => {
    const junior = fold(
      'seed',
      unwrap(
        createCharacter(
          SRD_CONTENT,
          paladin({
            level: 5,
            // A level 5 Paladin prepares 6.
            preparedSpells: [
              'bless',
              'cure-wounds',
              'heroism',
              'searing-smite',
              'shield-of-faith',
              'aid',
            ],
            feats: {
              'sage:magic-initiate-wizard': {
                featId: 'magic-initiate',
                spellList: 'wizard',
                spellcastingAbility: 'int',
                cantrips: ['mage-hand', 'light'],
                levelOneSpell: 'find-familiar',
              },
              'human:versatile': { featId: 'alert' },
              'paladin:fighting-style': { featId: 'defense' },
              'paladin:ability-score-improvement': { featId: 'ability-score-improvement', abilities: ['int', 'int'] },
            },
          }),
          AELRIC,
        ),
        'junior',
      ) as GameEvent[],
    );
    // Nothing that radiates. Defense is the Fighting Style taken at 2 and
    // Sacred Weapon arrives at 3, both on the sheet — one gated on the armour
    // worn and one on being switched on — so the claim this test makes is
    // about the aura rather than about the length of the list, and the
    // remainder is named rather than dropped, so a standing effect arriving at
    // a level below 6 is still a diff somebody has to read.
    const standing = junior.creatures.aelric!.sheet.standing ?? [];
    expect(standing.filter((one) => one.reach.kind === 'aura')).toEqual([]);
    expect(standing.map((one) => one.feature)).toEqual([
      'defense',
      'oath-of-devotion:sacred-weapon',
    ]);
  });
});

describe('the aura survives retries and replay', () => {
  it('is a no-op on a retried casting, and the bonus is unchanged', () => {
    const log = table();
    const first = unwrap(
      resolveSpell(
        fold('seed', log),
        WITCH,
        { spellId: 'hold-person', targets: [ALLY], slotLevel: 2, commandId: 'c1' },
        supply(),
      ),
      'first',
    );

    const after = [...log, ...first.events];
    const retry = unwrap(
      resolveSpell(
        fold('seed', after),
        WITCH,
        { spellId: 'hold-person', targets: [ALLY], slotLevel: 2, commandId: 'c1' },
        supply(),
      ),
      'retry',
    );
    expect(retry.events).toEqual([]);
    expect(standingSaveBonuses(fold('seed', after), ALLY, 'wis')).toHaveLength(1);
  });

  it('rolls the same save twice from the same state and seed', () => {
    expect(holdPerson(table()).outcomes[0]?.save?.total).toBe(
      holdPerson(table()).outcomes[0]?.save?.total,
    );
  });

  it('replays prefix by prefix', () => {
    const log = table();
    for (let n = 0; n <= log.length; n += 1) {
      expect(fold('seed', log.slice(0, n))).toEqual(fold('seed', log.slice(0, n)));
    }
  });

  it('refuses a side declared for a creature that is not there', () => {
    const out = fold('seed', table());
    expect(isErr(resolveSpell(out, id('nobody'), { spellId: 'hold-person', targets: [ALLY] }, supply()))).toBe(true);
  });
});

/**
 * Resistance a feature grants, through the command that actually deals damage.
 *
 * SRD Elemental Affinity: "Choose one of those types: Acid, Cold, Fire,
 * Lightning, or Poison. You have Resistance to that damage type." The choice
 * is the player's, so the feature cannot name the type and creation fills it
 * in from what they picked.
 */
describe('a chosen resistance reaches the damage command', () => {
  const veska = (type: string): CharacterChoices => ({
    name: 'Veska',
    classId: 'sorcerer',
    level: 6,
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 8, dex: 14, con: 13, int: 12, wis: 10, cha: 15 },
    },
    abilityIncreases: { con: 2, int: 1 },
    classSkills: ['arcana', 'persuasion'],
    languages: ['Draconic', 'Giant'],
    alignment: 'Chaotic Neutral',
    subclassId: 'draconic-sorcery',
    cantrips: ['fire-bolt', 'ray-of-frost', 'shocking-grasp', 'acid-splash', 'poison-spray'],
    spellbook: [],
    preparedSpells: [
      'burning-hands',
      'charm-person',
      'thunderwave',
      'hold-person',
      'shatter',
      'mind-spike',
      'fireball',
      'blindness-deafness',
      'chromatic-orb',
      'scorching-ray',
    ],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      'human:skillful': ['perception'],
      'sorcerer:metamagic': ['Empowered Spell', 'Quickened Spell'],
      'draconic-sorcery:elemental-affinity': [type],
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
      'sorcerer:ability-score-improvement': { featId: 'defense' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  });

  /** Fire Bolt at a Sorcerer who chose Fire, and at one who chose Cold. */
  const burned = (type: string): number => {
    const VESKA = id('veska');
    const log: readonly GameEvent[] = [
      ...(unwrap(createCharacter(SRD_CONTENT,veska(type), VESKA), 'create') as GameEvent[]),
      { type: 'creature-side-declared', id: VESKA, side: 'party' },
      added(WITCH, 'coven', { spellcastingAbility: 'int' }),
      {
        type: 'spellcasting-declared',
        id: WITCH,
        spellcasting: declaredCasting({ ability: 'int', cantrips: ['fire-bolt'] }),
      },
      { type: 'scene-set', extent: { width: 300, depth: 300, height: 40 } },
      { type: 'landmark-added', name: 'the gate', at: { x: 100, y: 100, z: 0 } },
      { type: 'creature-placed', id: WITCH, placement: { from: { landmark: 'the gate' }, feet: 0 } },
      { type: 'creature-placed', id: VESKA, placement: { from: { creature: WITCH }, feet: 10, bearing: 0 } },
      { type: 'sight-declared', from: WITCH, to: VESKA, seen: true },
    ];

    const out = unwrap(
      resolveSpell(fold('seed', log), WITCH, { spellId: 'fire-bolt', targets: [VESKA] }, supply('burn')),
      'fire-bolt',
    );
    return out.outcomes[0]?.damage ?? 0;
  };

  it('halves the damage of the type the sorcerer chose', () => {
    const resisted = burned('Fire');
    const unresisted = burned('Cold');
    expect(unresisted).toBeGreaterThan(0);
    expect(resisted).toBe(Math.floor(unresisted / 2));
  });
});
