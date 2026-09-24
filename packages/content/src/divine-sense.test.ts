import { describe, expect, it } from 'vitest';
import { asCharacterId, isErr, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  activateFeature,
  checkContent,
  createCharacter,
  detectedBy,
  fold,
  remaining,
  type CharacterChoices,
  type CharacterSheet,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

/**
 * SRD Channel Divinity (Paladin 3), Divine Sense:
 *
 * > "As a Bonus Action, you can open your awareness to detect Celestials,
 * > Fiends, and Undead. For the next 10 minutes or until you have the
 * > Incapacitated condition, you know the location of any creature of those
 * > types within 60 feet of yourself, and you know its creature type. Within
 * > the same radius, you also detect the presence of any place or object that
 * > has been consecrated or desecrated, such as with the Hallow spell."
 *
 * The Paladin's pool was declared, sized and recovered from the day pools
 * landed and what a use *bought* was nothing at all. What it buys is an
 * activation — the shape Sacred Weapon already spends this pool through — and
 * what the activation carries is the one thing no grant could say: the types
 * it reports and how far it reaches. The engine can then **answer the question
 * the book asks**, which is a fact about creatures it already holds rather
 * than a fact a DM has to declare.
 *
 * The second sentence stays the table's and says so in the feature's own note:
 * nothing in the engine consecrates or desecrates a place, so there is no
 * fact for a radius to find.
 */

const id = (s: string): CharacterId => asCharacterId(s);
const ARDAN = id('ardan');
const IMP = id('imp');
const GHOUL = id('ghoul');
const BANDIT = id('bandit');
const FAR_FIEND = id('far-fiend');
const THING = id('thing');

const paladin = (): CharacterChoices =>
  ({
    name: 'Ardan',
    classId: 'paladin',
    level: 3,
    subclassId: 'oath-of-devotion',
    speciesId: 'human',
    backgroundId: 'acolyte',
    abilities: {
      method: 'standard-array',
      assignment: { str: 14, dex: 12, con: 13, int: 8, wis: 10, cha: 15 },
    },
    abilityIncreases: { cha: 2, wis: 1 },
    classSkills: ['athletics', 'persuasion'],
    languages: ['Draconic', 'Elvish'],
    alignment: 'Lawful Good',
    cantrips: [],
    spellbook: [],
    preparedSpells: ['cure-wounds', 'heroism', 'divine-favor', 'bless'],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: { 'human:skillful': ['perception'] },
    feats: {
      'human:versatile': { featId: 'alert' },
      'paladin:fighting-style': { featId: 'defense' },
      'acolyte:magic-initiate-cleric': {
        featId: 'magic-initiate',
        spellList: 'cleric',
        spellcastingAbility: 'wis',
        cantrips: ['guidance', 'sacred-flame'],
        levelOneSpell: 'bless',
      },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
  }) as CharacterChoices;

const plain = (): CharacterSheet => ({
  level: 1,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skills: {},
  saveProficiencies: [],
  armor: null,
  shield: null,
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  baseSpeed: 30,
  spellcastingAbility: null,
});

/** One creature of a stated type, or of none where the type is null. */
const standing = (
  who: CharacterId,
  name: string,
  creatureType: string | null,
  feet: number,
): readonly GameEvent[] => [
  {
    type: 'creature-added',
    id: who,
    name,
    sheet: plain(),
    maxHp: 20,
    diesAtZero: false,
    ...(creatureType === null ? {} : { creatureType }),
  },
  { type: 'creature-placed', id: who, placement: { from: { creature: ARDAN }, feet, bearing: 0 } },
];

const field = (): readonly GameEvent[] => [
  ...(unwrap(createCharacter(SRD_CONTENT, paladin(), ARDAN), 'create') as GameEvent[]),
  { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
  { type: 'landmark-added', name: 'the shrine', at: { x: 300, y: 300, z: 0 } },
  { type: 'creature-placed', id: ARDAN, placement: { from: { landmark: 'the shrine' }, feet: 0 } },
  ...standing(IMP, 'an imp', 'Fiend', 40),
  ...standing(GHOUL, 'a ghoul', 'Undead', 55),
  ...standing(BANDIT, 'a bandit', 'Humanoid', 20),
  ...standing(FAR_FIEND, 'a distant fiend', 'Fiend', 65),
  ...standing(THING, 'a shape in the dark', null, 30),
];

const DIVINE_SENSE = 'paladin:channel-divinity';

const opened = (log: readonly GameEvent[] = field()): GameState => {
  const before = fold('seed', log);
  const events = unwrap(activateFeature(before, ARDAN, { feature: DIVINE_SENSE }), 'open');
  return fold('seed', [...log, ...events]);
};

const reported = (state: GameState) =>
  detectedBy(state, ARDAN).map((one) => [one.id, one.creatureType, one.feet] as const);

describe('SRD Divine Sense: what a Channel Divinity use buys the Paladin', () => {
  it('is an activation on the pool the class feature declares', () => {
    const paladinClass = SRD_CONTENT.classes.find((one) => one.id === 'paladin');
    const feature = paladinClass?.features.find((one) => one.id === DIVINE_SENSE);
    const grants = Array.isArray(feature?.grants) ? feature.grants : [feature?.grants];
    const activation = grants.find((one) => one?.kind === 'activated');
    expect(activation).toBeDefined();
    if (activation === undefined || activation.kind !== 'activated') throw new Error('unreachable');
    // "As a Bonus Action", "For the next 10 minutes or until you have the
    // Incapacitated condition".
    expect(activation.action).toBe('bonus-action');
    expect(activation.pool).toBe('channel-divinity');
    expect(activation.spendsOnly).toBe(true);
    expect(activation.lastsSeconds).toBe(600);
    expect(activation.endsOn).toContain('incapacitated');
    expect(activation.detects).toEqual({
      feet: 60,
      creatureTypes: ['Celestial', 'Fiend', 'Undead'],
    });
    expect(feature?.automation).toBe('engine');
  });

  it('reports nothing at all until the use is spent', () => {
    expect(reported(fold('seed', field()))).toEqual([]);
  });

  it('spends a use of Channel Divinity and opens the awareness', () => {
    const before = fold('seed', field());
    const after = opened();
    expect(remaining(after.creatures[ARDAN]!.resources, 'channel-divinity')).toBe(
      remaining(before.creatures[ARDAN]!.resources, 'channel-divinity') - 1,
    );
    expect(after.creatures[ARDAN]?.activeFeatures).toContain(DIVINE_SENSE);
  });

  /**
   * "any creature of those types within 60 feet of yourself, and you know its
   * creature type" — and nothing else. The Humanoid at twenty feet is not one
   * of the three; the Fiend at sixty-five is outside the radius.
   */
  it('names the Fiend and the Undead inside the radius, and nobody else', () => {
    const seen = reported(opened());
    expect(seen).toContainEqual([IMP, 'Fiend', 40]);
    expect(seen).toContainEqual([GHOUL, 'Undead', 55]);
    expect(seen.map(([who]) => who)).not.toContain(BANDIT);
    expect(seen.map(([who]) => who)).not.toContain(FAR_FIEND);
  });

  /**
   * A creature nobody has typed is **unknown rather than absent**: the
   * awareness reaches it and the record does not say what it is, which is a
   * different answer from "there is nothing there" and the only honest one.
   */
  it('reports a creature of no stated type as unknown', () => {
    expect(reported(opened())).toContainEqual([THING, null, 30]);
  });

  it('closes when the ten minutes are up', () => {
    const state = fold('seed', [
      ...field(),
      ...unwrap(activateFeature(fold('seed', field()), ARDAN, { feature: DIVINE_SENSE }), 'open'),
      { type: 'time-advanced', seconds: 600, reason: 'the watch changes' },
    ]);
    expect(state.creatures[ARDAN]?.activeFeatures).not.toContain(DIVINE_SENSE);
    expect(reported(state)).toEqual([]);
  });

  it('closes the moment the Paladin is Incapacitated', () => {
    const log = [
      ...field(),
      ...unwrap(activateFeature(fold('seed', field()), ARDAN, { feature: DIVINE_SENSE }), 'open'),
    ];
    const stunned = fold('seed', [
      ...log,
      {
        type: 'condition-applied',
        id: ARDAN,
        condition: 'stunned',
        source: 'a gaze',
      } as GameEvent,
    ]);
    expect(stunned.creatures[ARDAN]?.activeFeatures).not.toContain(DIVINE_SENSE);
    expect(reported(stunned)).toEqual([]);
  });

  it('refuses a second opening while the first is running', () => {
    const refused = activateFeature(opened(), ARDAN, { feature: DIVINE_SENSE });
    expect(isErr(refused)).toBe(true);
  });
});

/**
 * The validator's half, which is what stops a homebrew feature compiling an
 * awareness nobody could read anything off.
 *
 * Both branches are `checkContent` problems rather than `err`s, so
 * `refusal-sweep.test.ts` cannot see them: a rule nothing asserts is a rule
 * that passes while the branch goes unread. Each is a way the grant validates
 * and then reports an empty room for ever — a use of Channel Divinity spent on
 * silence, which is the state this whole feature was built out of.
 */
describe('an awareness is held to a radius and a list', () => {
  const rewritten = (over: Record<string, unknown>): readonly string[] => {
    const paladinClass = JSON.parse(
      JSON.stringify(SRD_CONTENT.classes.find((one) => one.id === 'paladin')),
    ) as { features: { id: string; grants: Record<string, unknown>[] }[] };
    const feature = paladinClass.features.find((one) => one.id === DIVINE_SENSE)!;
    const at = feature.grants.findIndex((one) => one['kind'] === 'activated');
    feature.grants[at] = { ...feature.grants[at], ...over };
    return checkContent({
      classes: [paladinClass as never],
      spells: SRD_CONTENT.spells as never,
    }).map((problem) => problem.code);
  };

  it('finds nothing wrong with the feature as the book prints it', () => {
    expect(rewritten({})).toEqual([]);
  });

  it('refuses a radius of nothing', () => {
    expect(rewritten({ detects: { feet: 0, creatureTypes: ['Fiend'] } })).toContain('bad_awareness');
  });

  it('refuses an awareness that reports no kind of creature at all', () => {
    expect(rewritten({ detects: { feet: 60, creatureTypes: [] } })).toContain('bad_awareness');
    expect(rewritten({ detects: { feet: 60, creatureTypes: [''] } })).toContain('bad_awareness');
  });
});
