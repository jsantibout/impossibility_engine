/**
 * SRD Hunter's Lore (Hunter 3):
 *
 * > "You can call on the forces of nature to reveal certain strengths and
 * > weaknesses of your prey. While a creature is marked by your _Hunter's
 * > Mark_, you know whether that creature has any Immunities, Resistances, or
 * > Vulnerabilities, and if so, what they are."
 *
 * **The shape is a fact the door reveals, not a command.** No action is spent,
 * no event is written and there is nothing to refuse: the ranger knows, or the
 * sentence is not about them. So the feature declares a `knowledge` grant,
 * `knownDefencesOf` derives the answer from state on every read, and the
 * player's `look` publishes it — the second fact this engine holds that only
 * the table reads, under the ruling that admitted SRD Divine Sense's.
 *
 * Neither condition names a catalogue id. The licence is a compiled grant on
 * the sheet, and the mark is a running casting of the knower's whose
 * `attack-rider` wrote `marksTarget` — a mechanical fact about the rider, so a
 * homebrew spell printing the same sentence marks a creature and this reads
 * it.
 */

import { describe, expect, it } from 'vitest';
import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  addCreature,
  createCharacter,
  createRng,
  createRollIssuer,
  endOngoingSpell,
  fold,
  knownDefencesOf,
  resolveSpell,
  type CharacterChoices,
  type GameEvent,
  type GameState,
} from '@ie/engine';
import { SRD_CONTENT } from './index.js';

const id = (s: string): CharacterId => asCharacterId(s);
const SORREL = id('sorrel');
const GHOUL = id('ghoul');
const BOAR = id('boar');

const supply = (seed = 'lore') => ({
  issuer: createRollIssuer('r'),
  rng: createRng(seed),
  content: SRD_CONTENT,
});

const ranger = (over: Partial<CharacterChoices> = {}): CharacterChoices =>
  ({
    name: 'Sorrel',
    classId: 'ranger',
    level: 3,
    subclassId: 'hunter',
    speciesId: 'human',
    backgroundId: 'sage',
    abilities: {
      method: 'standard-array',
      assignment: { str: 12, dex: 15, con: 13, int: 8, wis: 14, cha: 10 },
    },
    abilityIncreases: { con: 2, wis: 1 },
    classSkills: ['survival', 'perception', 'stealth'],
    languages: ['Dwarvish', 'Orc'],
    alignment: 'Neutral',
    cantrips: [],
    spellbook: [],
    preparedSpells: ['hunters-mark', 'cure-wounds', 'goodberry', 'ensnaring-strike'],
    classEquipment: 'A',
    backgroundEquipment: 'A',
    equipped: [],
    hitPoints: { method: 'fixed' },
    featureChoices: {
      'human:skillful': ['athletics'],
      'ranger:deft-explorer': ['survival'],
      'hunter:hunters-prey': ['Colossus Slayer'],
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
      'ranger:fighting-style': { featId: 'archery' },
    },
    dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard' },
    ...over,
  }) as CharacterChoices;

/** The ranger, a Ghoul and a Boar, with a scene to measure in. */
const field = (choices: CharacterChoices = ranger()): readonly GameEvent[] => {
  const made = unwrap(createCharacter(SRD_CONTENT, choices, SORREL), 'create') as GameEvent[];
  const placed: readonly GameEvent[] = [
    { type: 'scene-set', extent: { width: 600, depth: 600, height: 40 } },
    { type: 'landmark-added', name: 'the treeline', at: { x: 300, y: 300, z: 0 } },
    { type: 'creature-placed', id: SORREL, placement: { from: { landmark: 'the treeline' }, feet: 0 } },
  ];
  let log: GameEvent[] = [...made, ...placed];
  for (const [who, monster, feet] of [
    [GHOUL, 'ghoul', 30],
    [BOAR, 'boar', 40],
  ] as const) {
    log = [
      ...log,
      ...unwrap(addCreature(fold('seed', log), SRD_CONTENT, who, monster), monster).events,
      { type: 'creature-placed', id: who, placement: { from: { creature: SORREL }, feet, bearing: 0 } },
      // Sight is declared rather than derived — computing it means modelling
      // walls — and Hunter's Mark asks for it before it will resolve.
      { type: 'sight-declared', from: SORREL, to: who, seen: true },
    ];
  }
  return log;
};

const marking = (log: readonly GameEvent[], target: CharacterId): readonly GameEvent[] => [
  ...log,
  ...unwrap(
    resolveSpell(
      fold('seed', log),
      SORREL,
      { spellId: 'hunters-mark', targets: [target], slotLevel: 1 },
      supply(),
    ),
    'cast',
  ).events,
];

const state = (log: readonly GameEvent[]): GameState => fold('seed', log);

describe('SRD Hunter’s Lore: what a marked quarry gives away', () => {
  it('declares a knowledge grant and nothing left for a DM', () => {
    const feature = SRD_CONTENT.subclassById('hunter')?.features.find(
      (one) => one.id === 'hunter:hunters-lore',
    );
    expect(feature?.automation).toBe('engine');
    expect(feature?.grants).toEqual({
      kind: 'knowledge',
      reveals: 'defenses',
      about: 'a-creature-your-casting-marks',
    });
  });

  /**
   * The Ghoul's own printed line, which is what makes this worth asking: it
   * is Immune to nothing in damage and to the Poisoned condition, and the
   * answer says both halves of the run.
   */
  it('tells a Hunter what the Ghoul it marked cannot be given', () => {
    const known = knownDefencesOf(state(marking(field(), GHOUL)), SORREL, GHOUL);
    expect(known).not.toBeNull();
    expect(known?.feature).toBe('hunter:hunters-lore');
    expect(known?.conditionImmunities).toContain('poisoned');
    expect(known?.damageImmunities).toEqual(['poison']);
    expect(known?.damageResistances).toEqual([]);
    expect(known?.damageVulnerabilities).toEqual([]);
  });

  /** "While a creature is marked" — the Boar standing beside it is not. */
  it('says nothing about a creature the mark is not on', () => {
    expect(knownDefencesOf(state(marking(field(), GHOUL)), SORREL, BOAR)).toBeNull();
  });

  /** And nothing at all before anything is cast. */
  it('says nothing with no casting running', () => {
    expect(knownDefencesOf(state(field()), SORREL, GHOUL)).toBeNull();
  });

  /**
   * **The lifetime is the casting's and nothing here remembers it.** The
   * rider is keyed by the casting's source, so ending the spell takes it
   * away through the door every other sourced grant uses.
   */
  it('says nothing once the casting ends', () => {
    const log = marking(field(), GHOUL);
    const before = state(log);
    const casting = Object.keys(before.ongoing)[0];
    expect(casting).toBeDefined();
    const ended = unwrap(endOngoingSpell(before, SORREL, casting ?? '', null), 'end');
    expect(knownDefencesOf(state([...log, ...ended]), SORREL, GHOUL)).toBeNull();
  });

  /**
   * And the licence is the feature's: a Ranger who has not reached Hunter's
   * Lore marks a quarry exactly as well and is told nothing, which is what
   * makes this a feature rather than a property of the spell.
   *
   * A level 2 Ranger rather than another subclass, because the SRD prints one
   * Ranger subclass and the level is the honest way to be without the
   * feature.
   */
  it('tells a Ranger who has not reached the feature nothing', () => {
    const untaught = ranger({
      level: 2,
      subclassId: undefined,
      preparedSpells: ['hunters-mark', 'cure-wounds', 'goodberry'],
      featureChoices: {
        'human:skillful': ['athletics'],
        'ranger:deft-explorer': ['survival'],
      },
    });
    const log = marking(field(untaught), GHOUL);
    expect(knownDefencesOf(state(log), SORREL, GHOUL)).toBeNull();
    // Not vacuous: the mark really is running on the Ghoul.
    expect(state(log).creatures[SORREL]?.attackRiders.some((one) => one.target === GHOUL)).toBe(
      true,
    );
  });

  /** A creature nobody has put in the room is not a quarry. */
  it('says nothing about a creature that is not here', () => {
    expect(knownDefencesOf(state(marking(field(), GHOUL)), SORREL, id('nobody'))).toBeNull();
  });
});
