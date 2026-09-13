/**
 * The same tavern brawl `scenario.test.ts` plays, set up for a model to drive.
 *
 * **Everything here is deliberately the same as the scripted scenario**: the
 * seed, Kessa's choices, the two Goblin Warriors, the 60x40 tavern and the bar
 * they are standing near. The experiment is about the *boundary*, so the fight
 * behind it has to be the one the engine is already known to resolve
 * identically from a seed. A fixture that drifted would measure the drift.
 *
 * Two things differ, and both are forced rather than chosen:
 *
 * 1. **The goblins come from the stat block, holding what it prints.**
 *    `scenario.test.ts` swings through `rollAttack`, which takes a `Weapon`
 *    object; a model swings through `resolveAttack`, which takes a catalogue
 *    id and refuses a weapon the attacker does not own. The command surface is
 *    stricter than the fixture's shortcut, which is the point of using it.
 * 2. **There is a `thin` variant**, and what it is thin *about* changed after
 *    the first experiment. It used to withhold creature types and weapons too,
 *    and the result was the model being asked what a goblin is and answering
 *    in its own favour. Facts authoritative content holds are no longer
 *    withheld from anybody — they arrive with the creature. `thin` now
 *    withholds only what content genuinely cannot know: the room, where
 *    everyone is standing, and who can see whom. The delta between the two
 *    runs is still the measurement for "what could have been supplied
 *    proactively"; it is now a measurement of the *right* thing.
 */

import { asCharacterId, type CharacterId } from '@ie/shared';
import { adaptMonster, createCharacter, type CharacterChoices } from '@ie/engine';
import { monsterFor, weaponsOf } from './bestiary.js';
import { levelGrantedSpells, type SpellbookEntry } from '@ie/engine';
import { expect as unwrap } from '@ie/shared';
import type { GameEvent } from '@ie/engine';

export const SEED = 'tavern-brawl';

export const WIZARD = asCharacterId('kessa');
export const GOBLIN_A = asCharacterId('goblin-a');
export const GOBLIN_B = asCharacterId('goblin-b');

/**
 * A Goblin Warrior built from the SRD stat block, not transcribed from it.
 *
 * **This is the hardening.** The first version of this fixture hand-wrote the
 * sheet — AC 15, HP 10, Initiative +2, and a `creatureType` the `thin` variant
 * deliberately omitted so the experiment could measure what the engine had to
 * ask for. What the experiment actually measured was worse than a round trip:
 * asked what a goblin was, the model answered "Humanoid", which is what made
 * its own Hold Person legal, and `type_established` made that permanent.
 *
 * The fact was never missing. `parseMonsters` reads `Small Fey (Goblinoid)`
 * off the page and `adaptMonster` now carries it. So a creature the SRD prints
 * is **spawned from the SRD**, and there is no longer a moment at which anyone
 * can be asked what it is. The numbers are identical to the hand-written ones
 * — checked in `probe.test.ts` — so the fight is unchanged and only the
 * provenance of its facts has moved.
 */
const goblin = (who: CharacterId): readonly GameEvent[] => {
  const monster = monsterFor('goblin-warrior');
  if (monster === null) throw new Error('the SRD bestiary has no goblin-warrior');
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
      side: 'goblins',
      sheet: adapted.sheet,
    },
    // SRD 2024 Goblin Warrior: Scimitar and Shortbow. `resolveAttack` refuses
    // a weapon its wielder does not own, and the live run recorded both
    // goblins fighting an entire fight with their fists because of it.
    {
      type: 'items-gained',
      id: who,
      items: weaponsOf(monster).map((item) => ({ id: item, quantity: 1 })),
      source: `${adapted.name} stat block`,
    },
  ];
};

const book = (level: number): SpellbookEntry[] =>
  [
    'magic-missile',
    'shield',
    'detect-magic',
    'feather-fall',
    'mage-armor',
    'sleep',
    'thunderwave',
    'hold-person',
    'misty-step',
    'web',
  ]
    .slice(0, levelGrantedSpells(level))
    .map((spellId, index) => ({
      spellId,
      acquiredAt: index < 6 ? 1 : Math.ceil((index - 5) / 2) + 1,
      origin: 'level' as const,
    }));

/** Transcribed from `scenario.test.ts`, field for field. */
export const KESSA: CharacterChoices = {
  name: 'Kessa',
  classId: 'wizard',
  level: 3,
  speciesId: 'human',
  backgroundId: 'sage',
  abilities: {
    method: 'standard-array',
    assignment: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 },
  },
  abilityIncreases: { int: 2, con: 1 },
  classSkills: ['investigation', 'insight'],
  languages: ['Draconic', 'Elvish'],
  alignment: 'Chaotic Good',
  subclassId: 'evoker',
  cantrips: ['fire-bolt', 'light', 'prestidigitation'],
  spellbook: book(3),
  preparedSpells: [
    'magic-missile',
    'shield',
    'mage-armor',
    'hold-person',
    'burning-hands',
    'scorching-ray',
  ],
  classEquipment: 'A',
  backgroundEquipment: 'A',
  equipped: [],
  hitPoints: { method: 'fixed' },
  featureChoices: {
    'wizard:scholar': ['arcana'],
    'human:skillful': ['perception'],
    'evoker:evocation-savant': ['burning-hands', 'scorching-ray'],
  },
  feats: {
    'sage:magic-initiate-wizard': {
      featId: 'magic-initiate',
      spellList: 'wizard',
      spellcastingAbility: 'int',
      cantrips: ['mage-hand', 'ray-of-frost'],
      levelOneSpell: 'find-familiar',
    },
    'human:versatile': { featId: 'skilled', proficiencies: ['stealth', 'nature', 'survival'] },
  },
  dmGrants: { items: [], goldPieces: 0, magicItems: [], note: 'standard package only' },
};

export type FixtureVariant = 'established' | 'thin';

/**
 * The log as it stands before the model is asked to do anything.
 *
 * `established` is the scripted scenario's opening: everybody exists, the room
 * exists, everybody is standing somewhere, the goblins are known to be Fey and
 * are holding the scimitars the SRD prints for them.
 *
 * `thin` is the same fight with none of that said. It is not a broken fixture;
 * it is the state a DM's first turn actually starts from when nobody has
 * pre-declared the room, and it is the only way to measure what the engine
 * asks for versus what it could have been handed.
 */
export function prelude(variant: FixtureVariant): readonly GameEvent[] {
  const events: GameEvent[] = [
    ...unwrap(createCharacter(KESSA, WIZARD), 'create Kessa'),
    { type: 'creature-side-declared', id: WIZARD, side: 'party' },
    ...goblin(GOBLIN_A),
    ...goblin(GOBLIN_B),
  ];

  if (variant === 'thin') return events;

  events.push(
    { type: 'scene-set', extent: { width: 60, depth: 40, height: 20 } },
    { type: 'landmark-added', name: 'the bar', at: { x: 10, y: 10, z: 0 } },
    { type: 'creature-placed', id: WIZARD, placement: { from: { landmark: 'the bar' }, feet: 0 } },
    {
      type: 'creature-placed',
      id: GOBLIN_A,
      placement: { from: { creature: WIZARD }, feet: 15, bearing: 0 },
    },
    {
      type: 'creature-placed',
      id: GOBLIN_B,
      placement: { from: { creature: WIZARD }, feet: 15, bearing: 90 },
    },
  );

  return events;
}

/**
 * What the player says, beat by beat, on each of Kessa's turns.
 *
 * Scripted so the experiment has one independent variable. A model improvising
 * the player as well as the DM would make two runs incomparable, and the thing
 * under test is the engine boundary, not the fiction.
 *
 * Each beat is chosen to land on one measurement category:
 *
 * | Round | Intent | What it is probing |
 * |---|---|---|
 * | 1 | Hold Person on a goblin | a refusal the rules own (Goblins are Fey), and whether the model recovers inside the same turn |
 * | 2 | a cantrip at whoever is closest | the ordinary path, and how many calls it costs when nothing is wrong |
 * | 3 | retreat and then attack | movement plus an action, and a range the engine measures |
 * | 4 | shove a goblin into the hearth | a mechanic the engine does not model, with no number-taking command on the surface |
 */
const STANDARD_INTENTS: readonly string[] = [
  "I raise a hand and try to freeze the goblin in front of me where it stands — I'm casting Hold Person on it.",
  'Fire bolt — I hurl a mote of flame at whichever goblin is closest to me.',
  'I back away from the goblins toward the bar, then throw another fire bolt at one of them.',
  'Forget spells. I shoulder-charge the nearest goblin and try to shove it into the hearth.',
];

/**
 * The same fight with the improvised action first.
 *
 * The standard script puts the shove in round 4, and the first live run never
 * got there: Kessa was dropped in round 3, so the beat that probes a mechanic
 * the engine does not model was never played. Reordering the standard script
 * after seeing that would be choosing the fight to suit the answer. A separate
 * script that opens on the shove measures the same thing and leaves the
 * primary run untouched.
 */
const UNMODELLED_INTENTS: readonly string[] = [
  'Forget magic. I shoulder-charge the nearest goblin and try to shove it into the hearth behind the bar.',
  'I grab the bar stool and swing it at the other goblin’s legs to knock it over.',
  'Fire bolt at whichever goblin is closest.',
  'Fire bolt again at the nearest one.',
];

export type IntentScript = 'standard' | 'unmodelled';

export const INTENT_SCRIPTS: Readonly<Record<IntentScript, readonly string[]>> = {
  standard: STANDARD_INTENTS,
  unmodelled: UNMODELLED_INTENTS,
};

export const PLAYER_INTENTS = STANDARD_INTENTS;
