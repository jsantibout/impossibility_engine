/**
 * Tier 2: three level 2 player characters and one SRD Ogre, in a mill.
 *
 * Tier 1 asked whether a model could operate the boundary at all. This asks
 * whether it still can when there are four actors, three mechanical
 * vocabularies and a battlefield with things in it — so everything here is
 * chosen to be *bigger*, not different. Same seed discipline, same surface,
 * same driver, same metrics.
 *
 * **The characters exercise existing engine capability and nothing else.**
 * Every spell named below has an executable definition, every feature is one
 * the engine declares it runs, and nothing was picked because it would fail.
 * Where a capability is missing — a Fighter's Second Wind has a pool the
 * engine spends and no tool on this surface reaches it — it is left absent
 * rather than stubbed, because a gap the benchmark finds is the evidence this
 * tier exists to collect.
 *
 * One species and one background exist in the engine today, so all three are
 * Human Sages. That is content coverage, not a design choice, and it has one
 * happy side effect: the Sage's Magic Initiate gives the Fighter and the
 * Cleric a second spellcasting route with its own ability and its own free
 * daily casting, which is a rule (`routeFor`) that no Tier 1 run ever reached.
 */

import { asCharacterId, expect as unwrap, type CharacterId } from '@ie/shared';
import {
  adaptMonster,
  createCharacter,
  levelGrantedSpells,
  type CharacterChoices,
  type GameEvent,
  type SpellbookEntry,
} from '@ie/engine';
import { monsterFor, weaponsOf } from './bestiary.js';
import type { Encounter } from './encounter.js';

export const OGRE_SEED = 'the-mill';

export const FIGHTER = asCharacterId('brannis');
export const CLERIC = asCharacterId('ilda');
export const MAGE = asCharacterId('thessaly');
export const OGRE = asCharacterId('ogre');

/**
 * Brannis, Fighter 2 — the one who stands in front.
 *
 * Chain mail and a greatsword, so the Ogre's +6 has an Armour Class of 16 to
 * beat and Brannis has a 2d6 to answer with, and eight javelins so a ranged
 * option exists without a second character owning it. Alert is taken because
 * it is one of the Origin feats the engine actually *executes* — the
 * Initiative Proficiency rides on the roll — so a level 2 Fighter here is not
 * a bundle of manual notes.
 */
const BRANNIS: CharacterChoices = {
  name: 'Brannis',
  classId: 'fighter',
  level: 2,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
  },
  abilityIncreases: { con: 2, wis: 1 },
  classSkills: ['athletics', 'perception'],
  languages: ['Dwarvish', 'Giant'],
  alignment: 'Lawful Good',
  // A Fighter has no cantrips, no book and prepares nothing — and the flat
  // fields are required rather than optional, so "none" is written down rather
  // than left out. The Magic Initiate spells are not these: they live on the
  // feat, with the feat's own spellcasting ability.
  cantrips: [],
  spellbook: [],
  preparedSpells: [],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-mail'],
  hitPoints: { method: 'fixed' },
  featureChoices: { 'human:skillful': ['survival'] },
  feats: {
    'fighter:fighting-style': { featId: 'great-weapon-fighting' },
    'human:versatile': { featId: 'alert' },
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['ray-of-frost', 'light'],
      levelOneSpell: 'burning-hands',
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/**
 * Sister Ilda, Cleric 2 — healing, a save spell, an attack-roll spell and a
 * Concentration spell, which is four separate engine paths in one character.
 *
 * Guiding Bolt is the attack roll, Sacred Flame the save, Healing Word the
 * Bonus Action heal, Cure Wounds the Action heal, Bless the Concentration —
 * and Shield of Faith is the standing Armour Class bonus that `armorClassOf`
 * exists to fold in. Five prepared is what the level 2 row prints.
 */
const ILDA: CharacterChoices = {
  name: 'Sister Ilda',
  classId: 'cleric',
  level: 2,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 13, dex: 12, con: 14, int: 10, wis: 15, cha: 8 },
  },
  abilityIncreases: { wis: 2, con: 1 },
  classSkills: ['medicine', 'religion'],
  languages: ['Halfling', 'Giant'],
  alignment: 'Lawful Neutral',
  cantrips: ['sacred-flame', 'light', 'guidance'],
  spellbook: [],
  preparedSpells: ['cure-wounds', 'healing-word', 'guiding-bolt', 'bless', 'shield-of-faith'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: ['chain-shirt', 'shield'],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['insight'],
    'cleric:divine-order': ['Protector'],
  },
  feats: {
    'human:versatile': { featId: 'skilled', proficiencies: ['athletics', 'nature', 'survival'] },
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['ray-of-frost', 'prestidigitation'],
      levelOneSpell: 'shield',
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

const BOOK: readonly string[] = [
  'burning-hands',
  'thunderwave',
  'grease',
  'shield',
  'ray-of-sickness',
  'sleep',
  'detect-magic',
  'feather-fall',
];

const spellbook = (level: number): SpellbookEntry[] =>
  BOOK.slice(0, levelGrantedSpells(level)).map((spellId, index) => ({
    spellId,
    acquiredAt: index < 6 ? 1 : 2,
    origin: 'level' as const,
  }));

/**
 * Thessaly, Wizard 2 — 14 hit points against a creature that deals 2d8 + 4.
 *
 * Deliberately fragile. An Ogre's Greatclub averages 13, so the arithmetic
 * says Thessaly goes down in two hits, and the benchmark reaches
 * unconsciousness, death saves and a heal off the floor because the fight
 * takes it there rather than because a script arranged it.
 *
 * Grease is prepared because it is the one level 1 spell here that makes a
 * *place* dangerous: its area persists, catches a creature on the turn
 * boundary the SRD prints, and gives the DM something tactical to do with the
 * mill floor that is not another damage roll.
 */
const THESSALY: CharacterChoices = {
  name: 'Thessaly',
  classId: 'wizard',
  level: 2,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Giant'],
  alignment: 'Neutral Good',
  cantrips: ['fire-bolt', 'ray-of-frost', 'light'],
  spellbook: spellbook(2),
  preparedSpells: ['burning-hands', 'thunderwave', 'grease', 'shield', 'ray-of-sickness'],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'human:skillful': ['perception'],
    'wizard:scholar': ['arcana'],
  },
  feats: {
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['prestidigitation', 'message'],
      levelOneSpell: 'mage-armor',
    },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

/**
 * The Ogre, built from the stat block exactly as the Tier 1 goblins are.
 *
 * Large, Giant, AC 11, 68 hit points, Speed 40 — and a Greatclub and Javelins,
 * because `resolveAttack` refuses a weapon its wielder does not own and a
 * monster spawned without its gear fights an entire benchmark with its fists.
 * It prints no Multiattack, so nothing here depends on the stat-block-action
 * gap Tier 1 left open.
 */
const ogre = (who: CharacterId): readonly GameEvent[] => {
  const monster = monsterFor('ogre');
  if (monster === null) throw new Error('the SRD bestiary has no ogre');
  const adapted = adaptMonster(monster, who);
  return [
    {
      type: 'creature-added',
      id: who,
      name: adapted.name,
      maxHp: adapted.vitals.hpMax,
      diesAtZero: true,
      creatureType: adapted.creatureType,
      defenses: adapted.defenses.byDamageType,
      side: 'monsters',
      sheet: adapted.sheet,
    },
    {
      type: 'items-gained',
      id: who,
      items: weaponsOf(monster).map((item) => ({ id: item, quantity: 1 })),
      source: `${adapted.name} stat block`,
    },
  ];
};

/**
 * The mill floor, 50 by 40, with four things in it worth naming.
 *
 * Spatially meaningful rather than decorative: the Ogre starts 15 feet from
 * the front rank, which is inside one 40-foot stride and outside a 5-foot
 * reach, so somebody has to move on the first turn. The millstone is a hazard
 * the DM can be invited to rule about, the hoist rope is a thing to swing
 * from, and the door is somewhere to retreat to — none of which the engine
 * knows anything about, which is the point.
 */
function prelude(): readonly GameEvent[] {
  return [
    ...unwrap(createCharacter(BRANNIS, FIGHTER), 'create Brannis'),
    { type: 'creature-side-declared', id: FIGHTER, side: 'party' },
    ...unwrap(createCharacter(ILDA, CLERIC), 'create Ilda'),
    { type: 'creature-side-declared', id: CLERIC, side: 'party' },
    ...unwrap(createCharacter(THESSALY, MAGE), 'create Thessaly'),
    { type: 'creature-side-declared', id: MAGE, side: 'party' },
    ...ogre(OGRE),
    { type: 'scene-set', extent: { width: 50, depth: 40, height: 20 } },
    { type: 'landmark-added', name: 'the great millstone', at: { x: 10, y: 20, z: 0 } },
    { type: 'landmark-added', name: 'the hoist rope', at: { x: 20, y: 10, z: 0 } },
    { type: 'landmark-added', name: 'the grain chute', at: { x: 35, y: 30, z: 0 } },
    { type: 'landmark-added', name: 'the mill door', at: { x: 45, y: 20, z: 0 } },
    {
      type: 'creature-placed',
      id: OGRE,
      placement: {
        from: { landmark: 'the great millstone' },
        feet: 10,
        bearing: 90,
        size: 'large',
      },
    },
    {
      type: 'creature-placed',
      id: FIGHTER,
      placement: { from: { landmark: 'the mill door' }, feet: 10, bearing: 270 },
    },
    {
      type: 'creature-placed',
      id: CLERIC,
      placement: { from: { landmark: 'the mill door' }, feet: 5, bearing: 270 },
    },
    {
      type: 'creature-placed',
      id: MAGE,
      placement: { from: { landmark: 'the mill door' }, feet: 0 },
    },
  ];
}

/**
 * What each player says, beat by beat.
 *
 * Two of the twelve lines cannot be served by picking a command off the
 * surface — Brannis swinging the hoist and Ilda driving the Ogre into the
 * millstone — and they sit on different characters in different rounds so the
 * ruling collaboration is exercised twice without the benchmark becoming a
 * test about improvisation. Everything else is ordinary play, which is what
 * the per-turn cost question needs in order to mean anything.
 *
 * Ilda's round 2 line names nobody: "whoever is hurt worst" is a target the
 * model has to resolve out of authoritative state, which is the boundary's own
 * rule about who resolves a target, asked of a fight with three candidates.
 */
const FIGHTER_INTENTS: readonly string[] = [
  'I get between that thing and Thessaly and put my greatsword into it.',
  'I fall back a few paces and put a javelin through it.',
  'I grab the hoist rope, kick off the millstone housing and swing the hanging grain sack into the ogre at the bottom of the arc.',
  'Greatsword again — I go for the knee and try to bring it down.',
];

const CLERIC_INTENTS: readonly string[] = [
  'I level my holy symbol at the ogre and call down a guiding bolt.',
  'Whoever is hurt worst, I get to them and give them a healing word.',
  'I put my shoulder into the ogre and try to drive it back into the turning millstone.',
  'Sacred flame on the ogre.',
];

const MAGE_INTENTS: readonly string[] = [
  'Fire bolt at the ogre.',
  'I slick the floor out from under it — grease, right where it is standing.',
  'I back away from it and throw another fire bolt.',
  'Fire bolt again.',
];

/** Tier 2, as an `Encounter` the same harness runs. */
export function ogreEncounter(): Encounter {
  return {
    id: 'ogre',
    seed: OGRE_SEED,
    prelude: prelude(),
    roster: [FIGHTER, CLERIC, MAGE, OGRE],
    sides: [
      [FIGHTER, CLERIC, MAGE],
      [OGRE],
    ],
    intents: new Map([
      [FIGHTER, FIGHTER_INTENTS],
      [CLERIC, CLERIC_INTENTS],
      [MAGE, MAGE_INTENTS],
    ]),
  };
}
