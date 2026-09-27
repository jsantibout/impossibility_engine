/**
 * A stat block sees: the Senses line on the sheet. (W8-S25)
 *
 * SRD Monsters, "Senses": "The Senses entry specifies a monster's Passive
 * Perception score, as well as any special senses the monster possesses."
 *
 * `@ie/srd` reads the line into `Monster.specialSenses`, and `adaptMonster`
 * compiles each entry into a `sense` standing grant on the sheet — the grant
 * `sensesOf` already gathers for a species trait and a pair of goggles. So the
 * three roads a block reaches a sheet by carry it with no change of their own:
 * `addCreature` pins the adapted sheet whole on `creature-added`, a summons
 * (Find Familiar's owl) arrives through the same door, and Wild Shape lays the
 * block's sheet over the Druid's on `shape-assumed`.
 *
 * What is proved here, one road at a time: a Goblin Warrior sees a fighter in
 * the dark as far as its Darkvision and no further, and not at all inside a
 * Darkness casting where an Imp — "unimpeded by magical Darkness" — does; a
 * Druid in a Wolf's shape sees with the wolf's eyes and loses them with the
 * form, and a Dwarf's own Darkvision is not one of the things the form keeps;
 * an Owl familiar has its printed Darkvision to lend with no casting, and a
 * Bat's Blindsight is seen through rather than held, so it never reaches its
 * wizard's swing; and a sheet pinned before any
 * of this reads no senses at all, which is the answer it always gave.
 */

import { describe, expect, it } from 'vitest';
import { SRD_CONTENT } from '@ie/content';
import { MONSTER_SENSES, type MonsterSense } from '@ie/srd/schemas';
import { asCharacterId, expect as unwrap, type CharacterId, type Result } from '@ie/shared';
import type { CharacterSheet } from './character.js';
import type { CharacterChoices } from './creation.js';
import { createCharacter } from './creation.js';
import { createRng, type Rng } from './dice.js';
import { fold, type GameEvent, type GameState } from './events.js';
import { adaptMonster, assumeStatBlock, printedTraitKey } from './monster.js';
import { SENSE_NAMES, type SenseName } from './positioning.js';
import { spellSlotKey } from './resources.js';
import { createRollIssuer } from './rolls.js';
import { declaredCasting } from './spellcasting.js';
import { canSee, seesThroughOf, sensesOf, sensesPerceiving } from './standing.js';
import type { StandingEffect } from './standing.js';
import {
  activateFeature,
  addCreature,
  advanceTime,
  assumeShape,
  borrowSenses,
  resolveDeclaredCast,
  resolveSpell,
  revertShape,
} from './commands.js';

const id = (s: string): CharacterId => asCharacterId(s);
const GOBLIN = id('goblin');
const FIGHTER = id('fighter');
const FAR_FIGHTER = id('far-fighter');
const WIZARD = id('wizard');
const IMP = id('imp');

const must = <T,>(result: Result<T>, what: string): T => unwrap(result, what);

const sheet = (over: Partial<CharacterSheet> = {}): CharacterSheet => ({
  level: 5,
  abilities: { str: 10, dex: 10, con: 12, int: 18, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  baseSpeed: 30,
  spellcastingAbility: 'int',
  ...over,
});

const added = (who: CharacterId, side: string): GameEvent => ({
  type: 'creature-added',
  id: who,
  name: who,
  sheet: sheet(),
  maxHp: 40,
  diesAtZero: false,
  creatureType: 'Humanoid',
  side,
});

const supply = (seed: string) => ({
  issuer: createRollIssuer(seed),
  rng: createRng(seed) as Rng,
  content: SRD_CONTENT,
});

const monster = (monsterId: string) => {
  const block = SRD_CONTENT.monsterById(monsterId);
  if (block === null) throw new Error(`no ${monsterId} in the bestiary`);
  return block;
};

/** A creature raised from its stat block through the one door there is. */
const raise = (log: readonly GameEvent[], who: CharacterId, monsterId: string): GameEvent[] => [
  ...log,
  ...must(addCreature(fold('senses', log) as GameState, SRD_CONTENT, who, monsterId), monsterId).events,
];

const darkvisionOf = (state: GameState, who: CharacterId) =>
  sensesOf(state, who).find((sense) => sense.sense === 'darkvision')?.feet;

// ─── the vocabulary ─────────────────────────────────────────────────────────

describe('the four senses a stat block prints', () => {
  it('are the four the engine holds', () => {
    // `@ie/srd` cannot import the engine, so the two lists are held equal
    // here, both ways — as values and as types.
    expect([...MONSTER_SENSES]).toEqual([...SENSE_NAMES]);
    const printed: SenseName = 'darkvision' as MonsterSense;
    const held: MonsterSense = 'truesight' as SenseName;
    expect([printed, held]).toEqual(['darkvision', 'truesight']);
  });
});

// ─── the compile ────────────────────────────────────────────────────────────

describe('a block’s Senses line, compiled onto its sheet', () => {
  it('is a `sense` grant per printed sense, keyed under the block’s Senses line', () => {
    const standing = adaptMonster(monster('ankheg'), GOBLIN).sheet.standing ?? [];
    const senses = standing.filter((effect) => effect.grant.kind === 'sense');
    expect(senses).toEqual([
      {
        feature: printedTraitKey('ankheg', 'Senses'),
        name: 'Darkvision',
        reach: { kind: 'self' },
        grant: { kind: 'sense', sense: 'darkvision', feet: 60 },
      },
      {
        feature: printedTraitKey('ankheg', 'Senses'),
        name: 'Tremorsense',
        reach: { kind: 'self' },
        grant: { kind: 'sense', sense: 'tremorsense', feet: 60 },
      },
    ]);
  });

  it('reads "unimpeded by magical Darkness" as a Darkvision that sees through darkness', () => {
    const standing = adaptMonster(monster('imp'), IMP).sheet.standing ?? [];
    expect(standing.filter((effect) => effect.feature === printedTraitKey('imp', 'Senses'))).toEqual([
      {
        feature: printedTraitKey('imp', 'Senses'),
        name: 'Darkvision',
        reach: { kind: 'self' },
        grant: { kind: 'sense', sense: 'darkvision', feet: 120 },
      },
      {
        feature: printedTraitKey('imp', 'Senses'),
        name: 'Darkvision',
        reach: { kind: 'self' },
        grant: { kind: 'sees-through', through: 'darkness', feet: 120 },
      },
    ]);
  });

  it('adds nothing for a block that prints no special sense', () => {
    // The Commoner's Senses line is its Passive Perception alone.
    const standing = adaptMonster(monster('commoner'), GOBLIN).sheet.standing ?? [];
    expect(standing.filter((effect) => effect.grant.kind === 'sense')).toEqual([]);
  });
});

// ─── a goblin in the dark ───────────────────────────────────────────────────

describe('a goblin in the dark', () => {
  /**
   * A Goblin Warrior at the well in a room the table has said is dark, a
   * fighter forty feet off, another eighty feet off, and a wizard who can
   * cast Darkness. Nobody has declared who sees whom.
   */
  const DARK: readonly GameEvent[] = raise(
    [
      added(FIGHTER, 'party'),
      added(FAR_FIGHTER, 'party'),
      added(WIZARD, 'party'),
      {
        type: 'resource-pool-declared',
        id: WIZARD,
        pool: { key: spellSlotKey(2), label: 'level 2 spell slot', max: 3, recovers: 'long-rest' },
      },
      {
        type: 'spellcasting-declared',
        id: WIZARD,
        spellcasting: declaredCasting({ ability: 'int', prepared: ['darkness'] }),
      },
      { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 }, light: 'darkness' },
      { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
    ],
    GOBLIN,
    'goblin-warrior',
  ).concat([
    { type: 'creature-placed', id: GOBLIN, placement: { from: { landmark: 'the well' }, feet: 0 } },
    { type: 'creature-placed', id: FIGHTER, placement: { from: { creature: GOBLIN }, feet: 40, bearing: 90 } },
    { type: 'creature-placed', id: FAR_FIGHTER, placement: { from: { creature: GOBLIN }, feet: 80, bearing: 180 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { creature: FIGHTER }, feet: 30, bearing: 180 } },
  ]);

  const darkness = (log: readonly GameEvent[]): GameEvent[] => [
    ...log,
    ...must(
      resolveSpell(
        fold('senses', log) as GameState,
        WIZARD,
        { spellId: 'darkness', targets: [], at: { x: 140, y: 100, z: 0 }, slotLevel: 2 },
        supply('dark'),
      ),
      'Darkness',
    ).events,
  ];

  it('has the Darkvision its block prints', () => {
    const state = fold('senses', DARK) as GameState;
    expect(sensesOf(state, GOBLIN)).toEqual([{ sense: 'darkvision', feet: 60 }]);
  });

  it('sees a fighter forty feet off in nonmagical darkness, and not one eighty feet off', () => {
    const state = fold('senses', DARK) as GameState;
    expect(canSee(state, GOBLIN, FIGHTER)).toBe(true);
    // Past the sense, the dark is in the way: Heavily Obscured, and nothing
    // of the goblin's reaches to defeat it.
    expect(canSee(state, GOBLIN, FAR_FIGHTER)).toBe(false);
  });

  it('does not see into a Darkness casting, where an Imp a hundred feet off does', () => {
    const cast = darkness(DARK);
    const state = fold('senses', cast) as GameState;
    expect(canSee(state, GOBLIN, FIGHTER)).toBe(false);

    const withImp = raise(cast, IMP, 'imp').concat([
      { type: 'creature-placed', id: IMP, placement: { from: { creature: FIGHTER }, feet: 100, bearing: 90 } },
    ]);
    const lit = fold('senses', withImp) as GameState;
    expect(seesThroughOf(lit, IMP)).toEqual({ darkness: 120 });
    expect(canSee(lit, IMP, FIGHTER)).toBe(true);
  });

  it('reads no senses off a sheet pinned before the Senses line reached one', () => {
    // The same arrival with the compiled senses taken off the pinned sheet,
    // which is what a `creature-added` written before this carries.
    const [arrival] = must(
      addCreature(fold('senses', []) as GameState, SRD_CONTENT, GOBLIN, 'goblin-warrior'),
      'goblin',
    ).events;
    if (arrival?.type !== 'creature-added') throw new Error('the arrival comes first');
    const senseless = (arrival.sheet.standing ?? []).filter(
      (effect) => effect.feature !== printedTraitKey('goblin-warrior', 'Senses'),
    );
    const { standing: _dropped, ...bare } = arrival.sheet;
    void _dropped;
    const old: GameEvent = {
      ...arrival,
      sheet: senseless.length === 0 ? bare : { ...bare, standing: senseless },
    };
    const state = fold('senses', [old]) as GameState;
    expect(sensesOf(state, GOBLIN)).toEqual([]);
  });
});

// ─── a form that sees ───────────────────────────────────────────────────────

describe('a Druid in a Wolf’s shape', () => {
  const DRUID = id('fenn');

  /** `wild-shape.test.ts`'s level 5 Druid. */
  const druid = (over: Partial<CharacterChoices> = {}): CharacterChoices => ({
    name: 'Fenn',
    classId: 'druid',
    level: 5,
    subclassId: 'circle-of-the-land',
    speciesId: 'human',
    backgroundId: 'acolyte',
    abilities: {
      method: 'standard-array',
      assignment: { str: 10, dex: 14, con: 13, int: 8, wis: 15, cha: 12 },
    },
    abilityIncreases: { wis: 2, cha: 1 },
    classSkills: ['nature', 'perception'],
    languages: ['Elvish', 'Dwarvish'],
    alignment: 'Neutral',
    cantrips: ['druidcraft', 'guidance', 'shillelagh'],
    spellbook: [],
    preparedSpells: [
      'aid',
      'barkskin',
      'call-lightning',
      'cure-wounds',
      'dispel-magic',
      'faerie-fire',
      'fog-cloud',
      'goodberry',
      'healing-word',
    ],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: ['leather-armor'],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      'human:skillful': ['acrobatics'],
      'druid:primal-order': ['Magician'],
      'druid:primal-order:cantrip': ['mending'],
    },
    feats: {
      'acolyte:magic-initiate-cleric': {
        featId: 'magic-initiate',
        spellList: 'cleric',
        spellcastingAbility: 'wis',
        cantrips: ['guidance', 'sacred-flame'],
        levelOneSpell: 'bless',
      },
      'human:versatile': { featId: 'alert' },
      'druid:ability-score-improvement': {
        featId: 'ability-score-improvement',
        abilities: ['wis', 'wis'],
      },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
    knownForms: ['wolf', 'rat', 'spider', 'riding-horse'],
    ...over,
  });

  /** The same Druid born a Dwarf, who has no Skillful and no Versatile to answer. */
  const dwarf = (): CharacterChoices => {
    const human = druid();
    const { 'human:skillful': _skill, ...featureChoices } = human.featureChoices;
    const { 'human:versatile': _feat, ...feats } = human.feats ?? {};
    void _skill;
    void _feat;
    return { ...human, speciesId: 'dwarf', featureChoices, feats };
  };

  /** The Druid at the well in the dark, and the goblin fifty feet off. */
  const glade = (choices: CharacterChoices): GameEvent[] => {
    const made = createCharacter(SRD_CONTENT, choices, DRUID);
    if (!made.ok) throw new Error(`${made.code} — ${made.reason}`);
    return raise(
      [
        ...made.value,
        { type: 'scene-set', extent: { width: 400, depth: 400, height: 40 }, light: 'darkness' },
        { type: 'landmark-added', name: 'the well', at: { x: 100, y: 100, z: 0 } },
      ],
      GOBLIN,
      'goblin-warrior',
    ).concat([
      { type: 'creature-placed', id: DRUID, placement: { from: { landmark: 'the well' }, feet: 0 } },
      { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: DRUID }, feet: 50, bearing: 90 } },
    ]);
  };

  const shifted = (log: readonly GameEvent[]): GameEvent[] => [
    ...log,
    ...must(
      assumeShape(fold('senses', log) as GameState, DRUID, { feature: 'druid:wild-shape', form: 'wolf' }, SRD_CONTENT),
      'Wild Shape',
    ),
  ];

  it('sees the goblin in the dark with the wolf’s eyes, and loses them with the form', () => {
    const before = glade(druid());
    expect(canSee(fold('senses', before) as GameState, DRUID, GOBLIN)).toBe(false);

    const wolf = shifted(before);
    const inForm = fold('senses', wolf) as GameState;
    expect(darkvisionOf(inForm, DRUID)).toBe(60);
    expect(canSee(inForm, DRUID, GOBLIN)).toBe(true);

    // "You can also leave the form early as a Bonus Action."
    const back = [...wolf, ...must(revertShape(inForm, DRUID, {}), 'revert')];
    const human = fold('senses', back) as GameState;
    expect(darkvisionOf(human, DRUID)).toBeUndefined();
    expect(canSee(human, DRUID, GOBLIN)).toBe(false);
  });

  /**
   * SRD Wild Shape, "Game Statistics": "Your game statistics are replaced by
   * the Beast's stat block, but you retain your creature type; Hit Points; Hit
   * Point Dice; Intelligence, Wisdom, and Charisma scores; class features;
   * languages; and feats." A species trait is not on that list, so a Dwarf's
   * Darkvision is replaced by the wolf's rather than kept beside it.
   */
  it('has the wolf’s senses and not the Dwarf’s, which the form does not keep', () => {
    const before = glade(dwarf());
    expect(darkvisionOf(fold('senses', before) as GameState, DRUID)).toBe(120);

    const wolf = shifted(before);
    const inForm = fold('senses', wolf) as GameState;
    expect(darkvisionOf(inForm, DRUID)).toBe(60);

    const back = [...wolf, ...must(revertShape(inForm, DRUID, {}), 'revert')];
    expect(darkvisionOf(fold('senses', back) as GameState, DRUID)).toBe(120);
  });

  it('does not keep a species sense that was switched on, either', () => {
    // SRD Stonecunning: "As a Bonus Action, you gain Tremorsense with a range
    // of 60 feet for 10 minutes." A species trait, active when the form is
    // taken — and the form keeps no species trait, running or not.
    const tremorsenseOf = (state: GameState) =>
      sensesOf(state, DRUID).find((sense) => sense.sense === 'tremorsense')?.feet;
    const before = glade(dwarf());
    const sensing = [
      ...before,
      ...must(
        activateFeature(fold('senses', before) as GameState, DRUID, { feature: 'dwarf:stonecunning' }, SRD_CONTENT),
        'Stonecunning',
      ),
    ];
    expect(tremorsenseOf(fold('senses', sensing) as GameState)).toBe(60);

    const wolf = shifted(sensing);
    expect(tremorsenseOf(fold('senses', wolf) as GameState)).toBeUndefined();
  });

  it('keeps a sense that is not a species trait, and a sheet pinned before the mark keeps all of its own', () => {
    const wolf = adaptMonster(monster('wolf'), DRUID);
    const blindsight: StandingEffect = {
      feature: 'a-class:keen-senses',
      name: 'Keen Senses',
      reach: { kind: 'self' },
      grant: { kind: 'sense', sense: 'blindsight', feet: 30 },
    };
    const darkvision: StandingEffect = {
      feature: 'a-species:darkvision',
      name: 'Darkvision',
      reach: { kind: 'self' },
      grant: { kind: 'sense', sense: 'darkvision', feet: 120 },
    };
    const sensesOn = (standing: readonly StandingEffect[]) =>
      (assumeStatBlock(sheet({ standing }), wolf, ['int', 'wis', 'cha']).standing ?? [])
        .filter((effect) => effect.grant.kind === 'sense')
        .map((effect) => effect.feature);

    // A class feature's sense is retained; a species trait's is not.
    expect(sensesOn([blindsight, { ...darkvision, speciesTrait: true }])).toEqual([
      'a-class:keen-senses',
      printedTraitKey('wolf', 'Senses'),
    ]);
    // A sheet created before species traits were marked cannot say which of
    // its senses is one, so it keeps them all — the answer it always had.
    expect(sensesOn([blindsight, darkvision])).toEqual([
      'a-class:keen-senses',
      'a-species:darkvision',
      printedTraitKey('wolf', 'Senses'),
    ]);
  });
});

// ─── a familiar that lends ──────────────────────────────────────────────────

describe('a familiar’s printed senses, lent', () => {
  /** The wizard's tower, dark, and the goblin a long way down the stair. */
  const TOWER: readonly GameEvent[] = [
    added(WIZARD, 'party'),
    added(GOBLIN, 'goblins'),
    {
      type: 'spellcasting-declared',
      id: WIZARD,
      spellcasting: declaredCasting({ ability: 'int', classId: 'wizard', prepared: ['find-familiar'] }),
    },
    {
      type: 'resource-pool-declared',
      id: WIZARD,
      pool: { key: spellSlotKey(1), label: 'level 1', max: 4, recovers: 'long-rest' },
    },
    { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 }, light: 'darkness' },
    { type: 'landmark-added', name: 'the tower', at: { x: 100, y: 100, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the tower' }, feet: 0 } },
  ];

  /** Find Familiar in the form named, an hour's rite, and the familiar it leaves. */
  const summoned = (form: string) => {
    const declared = must(
      resolveSpell(
        fold('senses', TOWER) as GameState,
        WIZARD,
        { spellId: 'find-familiar', targets: [WIZARD], slotLevel: 1, form, choice: 'Fey' },
        supply('rite'),
      ),
      'Find Familiar',
    );
    const open = [...TOWER, ...declared.events];
    const ticked = [...open, ...must(advanceTime(fold('senses', open) as GameState, 3600, 'the rite'), 'an hour')];
    const settled = must(
      resolveDeclaredCast(fold('senses', ticked) as GameState, declared.castingId!, supply('rite')),
      'the rite ends',
    );
    const log = [...ticked, ...settled.events];
    const state = fold('senses', log) as GameState;
    const familiar = Object.keys(state.creatures).find(
      (who) => state.creatures[who as CharacterId]?.summonedBy?.by === WIZARD,
    ) as CharacterId;
    return { familiar, log };
  };

  const fighting = (log: readonly GameEvent[], familiar: CharacterId): GameEvent[] => [
    ...log,
    {
      type: 'combat-started',
      combatants: [
        { id: WIZARD, initiative: 20, speed: 30 },
        { id: familiar, initiative: 15, speed: 30 },
        { id: GOBLIN, initiative: 5, speed: 30 },
      ],
    },
  ];

  it('gives an Owl the Darkvision its block prints, with no casting to give it one', () => {
    const { familiar, log } = summoned('owl');
    expect(darkvisionOf(fold('senses', log) as GameState, familiar)).toBe(120);
  });

  it('lets the wizard see a goblin in the dark a hundred feet from the owl', () => {
    const { familiar: owl, log } = summoned('owl');
    // The owl down the stair, the goblin a hundred feet beyond it — and so a
    // hundred and eighty from the wizard, past any Darkvision the wizard could
    // hold at the wizard's own position: this is the owl's eyes answering.
    const placed = fighting(
      [
        ...log,
        { type: 'creature-placed', id: owl, placement: { from: { creature: WIZARD }, feet: 80, bearing: 90 } },
        { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: owl }, feet: 100, bearing: 90 } },
      ],
      owl,
    );
    const state = fold('senses', placed) as GameState;
    expect(canSee(state, owl, GOBLIN)).toBe(true);
    expect(canSee(state, WIZARD, GOBLIN)).toBe(false);

    const borrowed = must(borrowSenses(state, SRD_CONTENT, WIZARD, { who: owl }), 'borrow');
    const after = fold('senses', [...placed, ...borrowed.events]) as GameState;
    expect(canSee(after, WIZARD, GOBLIN)).toBe(true);
  });

  /**
   * **Option B** (owner, 2026-09-27): SRD Find Familiar's "you can see through
   * the familiar's eyes ..., gaining the benefits of any special senses it
   * has" reaches what the caster sees *through the familiar*, from where the
   * familiar is. It does not make the Bat's Blindsight the wizard's, so the
   * wizard's own `sensesPerceiving` — what an attack roll reads — stays empty
   * and the borrowed sense never reaches the wizard's swing; `canSee` answers
   * yes, because the bat itself perceives the goblin.
   */
  it('lets the wizard see through the Bat’s Blindsight without holding it (option B)', () => {
    const { familiar: bat, log } = summoned('bat');
    const placed = fighting(
      [
        ...log,
        { type: 'creature-placed', id: bat, placement: { from: { creature: WIZARD }, feet: 30, bearing: 270 } },
        { type: 'creature-placed', id: GOBLIN, placement: { from: { creature: WIZARD }, feet: 5, bearing: 90 } },
      ],
      bat,
    );
    const state = fold('senses', placed) as GameState;
    expect(sensesOf(state, bat)).toEqual([{ sense: 'blindsight', feet: 60 }]);
    expect(sensesPerceiving(state, WIZARD, GOBLIN)).toEqual([]);

    const borrowed = must(borrowSenses(state, SRD_CONTENT, WIZARD, { who: bat }), 'borrow');
    const after = fold('senses', [...placed, ...borrowed.events]) as GameState;
    expect(canSee(after, WIZARD, GOBLIN)).toBe(true);
    expect(sensesOf(after, WIZARD)).toEqual([]);
    expect(sensesPerceiving(after, WIZARD, GOBLIN)).toEqual([]);
  });
});
