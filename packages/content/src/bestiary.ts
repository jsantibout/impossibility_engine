/**
 * The stat blocks the SRD prints **inside a spell's own entry**.
 *
 * Every other block in the catalogue comes from `packages/srd`, parsed out of
 * the Monsters chapter. Three spells do not work that way: the book prints
 * their creature's whole stat block in the spell's entry, as prose and an HTML
 * table, and the parser that reads the Monsters chapter never sees it.
 *
 * **The owner's ruling of 2026-09-21 is what settles where they go**: a
 * spell-internal stat block becomes a *catalogue* (bestiary) entry rather than
 * a new kind of content only a spell can hold. So they are transcribed here,
 * by hand, against the same `Monster` schema every parsed block is validated
 * by, and they reach the engine through `createContent` beside the book — the
 * same door homebrew takes. A `summon` effect then names one by id exactly as
 * `addCreature` names a Goblin, and nothing in the engine knows the difference.
 *
 * **Why not generate them.** The parser reads the Monsters chapter and these
 * are not in it; teaching it to read an HTML table inside a spell's
 * `higherLevel` text would be a second parser for two entries, and the SRD's
 * own table for the Otherworldly Steed carries no actions, no traits and a
 * Challenge Rating of "None" — there is nothing there a parser would do better
 * than a reader. `coverage.test.ts` holds the catalogue to *parsed ∪ these*,
 * so a block cannot be added here without the count saying so.
 *
 * **What a spell may still print over one.** SRD Find Steed writes its steed's
 * Armour Class and hit points as formulae over the spell's level, and those
 * belong to the casting rather than to the block — `SpellEffect`'s `summon`
 * arm carries them and pins the answers into the log. The integers below are
 * what those formulae give at each spell's own level, which is what a DM gets
 * who walks the block through `addCreature` with no casting at all.
 */

import type { Monster } from '@ie/srd';

/**
 * SRD Find Steed's Otherworldly Steed, transcribed from the spell's entry.
 *
 * > _Large Celestial, Fey, or Fiend (Your Choice), Neutral_
 * > **AC** 10 + 1 per spell level
 * > **HP** 5 + 10 per spell level (the steed has a number of Hit Dice [d10s]
 * > equal to the spell's level)
 * > **Speed** 60 ft., Fly 60 ft. (requires level 4+ spell)
 * > STR 18 (+4/+4) DEX 12 (+1/+1) CON 14 (+2/+2)
 * > INT 6 (−2/−2) WIS 12 (+1/+1) CHA 8 (−1/−1)
 * > **Senses** Passive Perception 11
 * > **Languages** Telepathy 1 mile (works only with you)
 * > **CR** None (XP 0; PB equals your Proficiency Bonus)
 *
 * **The type is the three the book prints, unpicked.** "Celestial, Fey, or
 * Fiend (Your Choice)" is a choice the caster makes at the casting, and the
 * table beneath it carries no trait that differs between the three — so
 * choosing one here would be the catalogue answering a question the book asked
 * somebody else, and answering it the same way every time. What is written is
 * what is printed; `mustBeType` matches none of the three, which is the honest
 * outcome for a creature nobody has typed.
 *
 * **The Fly Speed is not here.** The book gates it — "Fly 60 ft. (requires
 * level 4+ spell)" — on the level the slot paid for, and a Speed that appears
 * at level 4 is a number the spell prints over the block rather than one the
 * block has. The engine distinguishes no movement mode today
 * (`movement-modes` in `missing-shapes.ts`), so writing it would be a
 * vocabulary with no reader; the spell's own `unmodelled` says so.
 *
 * **The Challenge Rating is 0 and the XP is 0**, which is "None" as the schema
 * can hold it: `cr` is a number and the label is the book's word. The
 * Proficiency Bonus is the *summoner's*, which no stat block field can say, so
 * the 2 below is the lowest a character who can cast this spell has and the
 * clause is handed to the table.
 */
export const OTHERWORLDLY_STEED: Monster = {
  id: 'otherworldly-steed',
  name: 'Otherworldly Steed',
  size: 'large',
  alternateSizes: [],
  type: 'Celestial, Fey, or Fiend',
  subtype: null,
  swarmMemberSize: null,
  alignment: 'Neutral',
  // 10 + 1 per spell level and 5 + 10 per spell level, at the spell's own
  // level of 2. Every casting writes its own answer over both.
  //
  // **The formula is the Hit Dice the book prints and nothing added to
  // them** — "the steed has a number of Hit Dice [d10s] equal to the spell's
  // level" — because the total beside it is printed as its own arithmetic
  // rather than rolled from the dice. Nothing reads `hp.formula` (the adapter
  // takes `hp.average`), which is exactly why an invented `+ 4` would sit here
  // unchallenged, so what is written is what the book says.
  ac: 12,
  initiative: 1,
  hp: { average: 25, formula: '2d10' },
  speed: { walk: 60, burrow: null, climb: null, fly: null, swim: null, hover: false },
  abilities: {
    str: { score: 18, modifier: 4, save: 4 },
    dex: { score: 12, modifier: 1, save: 1 },
    con: { score: 14, modifier: 2, save: 2 },
    int: { score: 6, modifier: -2, save: -2 },
    wis: { score: 12, modifier: 1, save: 1 },
    cha: { score: 8, modifier: -1, save: -1 },
  },
  skills: {},
  vulnerabilities: [],
  resistances: [],
  immunities: [],
  gear: [],
  senses: [],
  passivePerception: 11,
  languages: ['Telepathy 1 mile (works only with you)'],
  cr: 0,
  crLabel: 'None',
  xp: 0,
  proficiencyBonus: 2,
  traits: [],
  actions: [],
  bonusActions: [],
  reactions: [],
  legendaryActions: [],
};

/**
 * SRD Phantom Steed's steed: the Riding Horse, with the one number the spell
 * changes.
 *
 * > "The steed uses the Riding Horse stat block (see "Monsters"), except it
 * > has a Speed of 100 feet and can travel 13 miles in an hour."
 *
 * **A block of its own rather than a Speed override on the horse**, which is
 * the owner's ruling applied to the smaller of the two cases: an override
 * would be a second field on `summon` whose only consumer is one spell, and a
 * creature whose Speed disagrees with the block it claims to be.
 *
 * **The book prints one exception and this makes one.** The transcription is
 * the parsed Riding Horse field for field — `bestiary.test.ts` asserts that
 * against the parsed entry, with the differences named — and the only
 * mechanical difference is the Speed the spell prints. In particular the type
 * stays `Beast`: "quasi-real" is a good argument for something else, and it is
 * an argument rather than a transcription, and `mustBeType` and every
 * Beast-gated effect read the field. A ruling the book did not print does not
 * enter the catalogue through a stat block nobody is looking at.
 *
 * The thirteen miles in an hour is travel pace, which the engine does not
 * model at any scale; the spell's `unmodelled` hands it over.
 */
export const PHANTOM_STEED_BLOCK: Monster = {
  id: 'phantom-steed',
  name: 'Phantom Steed',
  size: 'large',
  alternateSizes: [],
  type: 'Beast',
  subtype: null,
  swarmMemberSize: null,
  alignment: 'Unaligned',
  ac: 11,
  initiative: 1,
  hp: { average: 13, formula: '2d10 + 2' },
  // "except it has a Speed of 100 feet" — the one number the spell changes.
  speed: { walk: 100, burrow: null, climb: null, fly: null, swim: null, hover: false },
  abilities: {
    str: { score: 16, modifier: 3, save: 3 },
    dex: { score: 13, modifier: 1, save: 1 },
    con: { score: 12, modifier: 1, save: 1 },
    int: { score: 2, modifier: -4, save: -4 },
    wis: { score: 11, modifier: 0, save: 0 },
    cha: { score: 7, modifier: -2, save: -2 },
  },
  skills: {},
  vulnerabilities: [],
  resistances: [],
  immunities: [],
  gear: [],
  senses: [],
  passivePerception: 10,
  languages: ['None'],
  cr: 0.25,
  crLabel: '1/4',
  xp: 50,
  proficiencyBonus: 2,
  traits: [],
  actions: [
    {
      name: 'Hooves',
      text: '_Melee Attack Roll:_ +5, reach 5 ft. _Hit:_ 7 (1d8 + 3) Bludgeoning damage.',
      attack: {
        kind: 'melee',
        modifier: 5,
        reach: 5,
        range: null,
        damage: [{ dice: '1d8', flat: 3, type: 'bludgeoning', average: 7 }],
        qualification: null,
        rider: null,
      },
    },
  ],
  bonusActions: [],
  reactions: [],
  legendaryActions: [],
};

/**
 * The blocks the book prints inside a spell, as one list.
 *
 * Read by `index.ts`, which hands the catalogue `MONSTERS` plus these, and by
 * the coverage guard, which is what stops a block being added here without the
 * bestiary count moving.
 */
export const SPELL_STAT_BLOCKS: readonly Monster[] = [OTHERWORLDLY_STEED, PHANTOM_STEED_BLOCK];
