import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Cleric, transcribed from SRD 5.2.1 "Classes".
 *
 * The second class, and the point of it is not the Cleric: it is proving the
 * structures are a *class* system rather than a Wizard with parameters. Three
 * things it does that the Wizard never did, each of which was a seam that had
 * to be opened rather than worked around:
 *
 * - **It prepares from the class list, not from a book.** SRD gives a Cleric
 *   no spellbook at all, so `spellcasting.style` says how a class comes by its
 *   spells and `creation.ts` branches on it. A spellbook entry on a Cleric is
 *   now a refusal rather than something nobody thought to check.
 * - **Its subclass grants prepared spells**, where the Evoker's granted
 *   spellbook entries. Both are `grants: { kind: 'spells' }`, found by what
 *   they do rather than by their ids.
 * - **It wears armour.** The Wizard's `armorTraining` is all false, so every
 *   armour rule in the engine was running against a character who could never
 *   use it. A Cleric in a Chain Shirt and Shield exercises the other branch.
 *
 * Hand-written for the same reason the Wizard is: `classes.md` has no parser.
 * The tests assert *relationships* rather than presence — every printed
 * Proficiency Bonus against the formula, slots never decreasing — and they run
 * against every class definition, so this one failed loudly until it agreed
 * with the engine.
 */

/**
 * Cleric Features table: level, PB, cantrips, prepared, then slots 1-9.
 *
 * Channel Divinity uses are in the printed table too and are not here: they
 * are a resource pool, declared when the character is made, and the table
 * column would be a second place for the same number to disagree from.
 */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 3, 4, 2],
  [2, 2, 3, 5, 3],
  [3, 2, 3, 6, 4, 2],
  [4, 2, 4, 7, 4, 3],
  [5, 3, 4, 9, 4, 3, 2],
  [6, 3, 4, 10, 4, 3, 3],
  [7, 3, 4, 11, 4, 3, 3, 1],
  [8, 3, 4, 12, 4, 3, 3, 2],
  [9, 4, 4, 14, 4, 3, 3, 3, 1],
  [10, 4, 5, 15, 4, 3, 3, 3, 2],
  [11, 4, 5, 16, 4, 3, 3, 3, 2, 1],
  [12, 4, 5, 16, 4, 3, 3, 3, 2, 1],
  [13, 5, 5, 17, 4, 3, 3, 3, 2, 1, 1],
  [14, 5, 5, 17, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 5, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 5, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 5, 19, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 5, 20, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 5, 21, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 5, 22, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[2] ?? 0,
  preparedSpells: row[3] ?? 0,
  spellSlots: row.slice(4),
}));

/**
 * SRD Divine Strike: the extra damage dice at each Cleric level.
 *
 * Not a column of the class table — the SRD writes it in the features
 * themselves, 1d8 at level 7 and "increases to 2d8" at 14 — so it is
 * transcribed here rather than read off `TABLE`. Zero below 7, which is what
 * a feature the character does not have yet contributes.
 */
export const DIVINE_STRIKE_DICE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2,
];

/**
 * SRD Divine Spark: how many dice one use rolls, by Cleric level.
 *
 * "Roll 1d8 and add your Wisdom modifier ... You roll an additional d8 when
 * you reach Cleric levels 7 (2d8), 13 (3d8), and 18 (4d8)." Written in the
 * feature rather than printed as a column, exactly as Divine Strike's
 * dice are, so it is transcribed here beside them. One below level 7, which is
 * also what a Cleric who does not have Channel Divinity yet contributes.
 */
export const DIVINE_SPARK_DICE: readonly number[] = [
  1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4,
];

/** Cleric Features table, Channel Divinity column. None at level 1. */
export const CLERIC_CHANNEL_DIVINITY: readonly number[] = [
  0, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4,
];

export const CLERIC: ClassDefinition = {
  id: 'cleric',
  name: 'Cleric',
  primaryAbility: 'wis',
  // SRD Cleric: Wisdom, and "you prepare the list of spells that are available
  // for you to cast... choosing from the Cleric spell list". No book.
  spellcasting: { ability: 'wis', style: 'prepared-from-list', progression: 'full', startsAtLevel: 1 },
  hitDie: 8,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    tools: [],
  },
  saveProficiencies: ['wis', 'cha'],
  skillChoices: {
    choose: 2,
    from: ['history', 'insight', 'medicine', 'persuasion', 'religion'],
  },
  weaponProficiencies: ['simple'],
  // SRD Core Cleric Traits: "Light and Medium armor and Shields."
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'chain-shirt', quantity: 1 },
        { id: 'shield', quantity: 1 },
        { id: 'mace', quantity: 1 },
        { id: 'holy-symbol', quantity: 1 },
        { id: 'priests-pack', quantity: 1 },
      ],
      goldPieces: 7,
    },
    { option: 'B', items: [], goldPieces: 110 },
  ],
  features: [
    {
      id: 'cleric:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and prepared spells are tracked, and preparation is checked against the Cleric spell list rather than a spellbook.',
    },
    {
      id: 'cleric:divine-order',
      name: 'Divine Order',
      level: 1,
      automation: 'manual',
      note: 'Half of one option is applied. SRD Thaumaturge: "you have a bonus to the Intelligence (Arcana) and Intelligence (Religion) checks you make. The bonus equals your Wisdom modifier (minimum of +1)." That is a standing check bonus gated on the option chosen, so it reaches the two named skills and a Cleric who took the other option has nothing. The rest is the DM’s: Protector grants Martial weapon proficiency and Heavy armor training, which no grant confers, and Thaumaturge grants an extra cantrip, which a spells grant could say and no gate could hang it on — only a standing grant carries `onlyIfChoice`.',
      choice: { kind: 'option', choose: 1, from: ['Protector', 'Thaumaturge'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Thaumaturge',
        effects: [
          {
            kind: 'check-bonus',
            fromAbility: 'wis',
            minimum: 1,
            skills: ['arcana', 'religion'],
          },
        ],
      },
    },
    {
      id: 'cleric:channel-divinity',
      name: 'Channel Divinity',
      level: 2,
      automation: 'engine',
      note: 'Declared as a pool sized by the Channel Divinity column, refilling on a Long Rest. A Short Rest gives back one use, which is applied without emptying the pool. What each use buys is executed: Turn Undead rolls the Wisdom save against the DC the class’s Spellcasting feature gives and leaves the Undead that fail Frightened and Incapacitated for the minute, and Divine Spark restores hit points or deals the damage the caller names, with the die read off the Cleric table. Divine Spark is one printed option offered here as two, because the book’s “either ... or” is a choice made at the moment of use and naming which half is that choice. Six clauses stay the table’s. Turn Undead catches "Each Undead of your choice within 30 feet of you" and the emanation catches every Undead in it, because an option fills an area or names one creature and a chosen subset of an area is neither. All three of its early ends are inert: "This effect ends early on the creature if it takes any damage, if you have the Incapacitated condition, or if you die" — the end causes an option may print are facts about the creature the timer sits on, so damage dealt to it is unsayable and the two that are facts about the Cleric have no casting for the fold’s derived pass to read. Its "it tries to move as far from you as it can" is the table’s in the way every compulsion is, since nothing moves a creature on its own turn. And Divine Spark is printed "at another creature", which is not refused: the reach is checked and who is on the other end of it is not.',
      grants: {
        kind: 'pool',
        key: 'channel-divinity',
        label: 'Channel Divinity',
        usesByLevel: CLERIC_CHANNEL_DIVINITY,
        recovers: 'long-rest',
        // SRD: "You regain one expended use when you finish a Short Rest."
        regainsOnShortRest: 1,
        // SRD: "you can use it in the following ways", and the ways are a
        // menu one feature offers rather than several features — which is why
        // they hang off the pool that prices them rather than standing beside
        // it as grants of their own.
        options: [
          {
            id: 'turn-undead',
            name: 'Turn Undead',
            // SRD: "As a Magic action, you present your Holy Symbol and
            // censure Undead creatures."
            action: 'action',
            // "Each Undead of your choice within 30 feet of you", which is an
            // emanation and a filter: the living standing in the same thirty
            // feet are left alone rather than making the use illegal. "Of your
            // choice" is the half that is not modelled — see the note above.
            area: { kind: 'emanation', distance: 30, origin: 'self' },
            mustBeType: 'Undead',
            // "must make a Wisdom saving throw. If the creature fails its save,
            // it has the Frightened and Incapacitated conditions for 1
            // minute." One save and two conditions, so it is one effect: a
            // second would roll a second save the creature could fail only
            // half of.
            effects: [
              {
                kind: 'save',
                ability: 'wis',
                condition: 'frightened',
                conditions: [{ name: 'incapacitated' }],
              },
            ],
            durationSeconds: 60,
          },
          {
            id: 'divine-spark-restore',
            name: 'Divine Spark (restore)',
            action: 'action',
            // SRD: "you point your Holy Symbol at another creature you can see
            // within 30 feet of yourself".
            reach: 30,
            // "Roll 1d8 and add your Wisdom modifier. You either restore Hit
            // Points to the creature equal to that total".
            effects: [
              { kind: 'heal', healing: { dice: '1d8' }, addSpellcastingModifier: true },
            ],
            diceCountByLevel: DIVINE_SPARK_DICE,
          },
          {
            id: 'divine-spark-harm',
            name: 'Divine Spark (harm)',
            action: 'action',
            reach: 30,
            // "or force the creature to make a Constitution saving throw. On a
            // failed save, the creature takes Necrotic or Radiant damage (your
            // choice) equal to that total. On a successful save, the creature
            // takes half as much damage (round down)."
            effects: [
              {
                kind: 'save-damage',
                ability: 'con',
                damage: { dice: '1d8' },
                damageType: 'radiant',
                addSpellcastingModifier: true,
                onSuccess: 'half',
              },
            ],
            damageTypeStated: ['necrotic', 'radiant'],
            diceCountByLevel: DIVINE_SPARK_DICE,
          },
        ],
      },
    },
    {
      id: 'cleric:subclass',
      name: 'Cleric Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'cleric:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Cleric levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'cleric:sear-undead',
      name: 'Sear Undead',
      level: 5,
      automation: 'manual',
      note: 'Turn Undead dealing Radiant damage is not modelled: a later feature adding an effect to an earlier one’s use has no shape. Turn Undead itself is executed — it is a Channel Divinity option now — so what is left here is the Radiant half alone.',
    },
    {
      id: 'cleric:blessed-strikes',
      name: 'Blessed Strikes',
      level: 7,
      automation: 'engine',
      note: 'Divine Strike is executed: a hit with a weapon deals an extra 1d8, rising to 2d8 at Cleric level 14, of whichever of Necrotic or Radiant the caster names at the hit — once per turn, and naming no type is how the option is declined. Potent Spellcasting is not: adding the Wisdom modifier to a cantrip’s damage is a spell-damage rider rather than an attack one, and a Cleric who chose it gains nothing here.',
      // SRD: "You gain one of the following options of your choice."
      choice: { kind: 'option', choose: 1, from: ['Divine Strike', 'Potent Spellcasting'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Divine Strike',
        // SRD: "Once on each of your turns when you hit a creature with an
        // attack roll using a weapon, you can cause the target to take an
        // extra 1d8 Necrotic or Radiant damage (your choice)."
        effects: [
          {
            kind: 'attack-damage',
            dice: '1d8',
            oncePerTurn: true,
            weaponOnly: true,
            damageTypeChoices: ['necrotic', 'radiant'],
          },
        ],
        diceCountByLevel: DIVINE_STRIKE_DICE,
      },
    },
    {
      id: 'cleric:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Cleric levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as cleric:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'cleric:divine-intervention',
      name: 'Divine Intervention',
      level: 10,
      automation: 'manual',
      note: 'Casting any Cleric spell without components is not modelled, and the once-per-long-rest limit is not tracked.',
    },
    {
      id: 'cleric:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Cleric levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as cleric:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'cleric:improved-blessed-strikes',
      name: 'Improved Blessed Strikes',
      level: 14,
      automation: 'engine',
      executedBy: 'cleric:blessed-strikes',
      note: 'SRD: "The extra damage of your Divine Strike increases to 2d8." The increase is applied by Blessed Strikes’ own dice table, which is read at the character’s Cleric level — this feature is the level at which that table steps, and has no separate effect to execute. The Potent Spellcasting branch’s Temporary Hit Points are not modelled.',
    },
    {
      id: 'cleric:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Cleric levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as cleric:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'cleric:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Fate is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'cleric:greater-divine-intervention',
      name: 'Greater Divine Intervention',
      level: 20,
      automation: 'manual',
      note: 'The Wish effect is not modelled.',
    },
  ],
};

/**
 * SRD "Cleric Subclass: Life Domain" — the subclass the SRD publishes.
 *
 * Its domain spells are the reason a subclass grant had to stop meaning
 * "spellbook entry": these are *always prepared*, from a list the subclass
 * names, and they do not count against what the class table allows.
 */
export const LIFE_DOMAIN: SubclassDefinition = {
  id: 'life-domain',
  name: 'Life Domain',
  classId: 'cleric',
  features: [
    {
      id: 'life-domain:disciple-of-life',
      name: 'Disciple of Life',
      level: 3,
      automation: 'engine',
      note: 'Applied. SRD: "Whenever a spell you cast with a spell slot restores Hit Points to a creature, that creature regains additional Hit Points on the turn you cast the spell. The additional Hit Points equal 2 plus the spell slot’s level." A `casting-healing` grant is the whole of it: the addend is worked out at the casting, off the slot the casting actually expended, so a Cure Wounds from a potion, from a wand or from a feature’s free casting adds nothing — which is the clause the sentence turns on. The two words it does not read are "on the turn": an area that heals somebody a minute later and a later use of an ongoing casting restore what the definition prints, which is the line `casting-damage` already draws for the damage half.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'casting-healing',
            when: { withSlot: true },
            alters: { kind: 'flat', flat: 2, plusSlotLevel: true },
          },
        ],
      },
    },
    {
      id: 'life-domain:domain-spells',
      name: 'Life Domain Spells',
      level: 3,
      automation: 'engine',
      note: 'The level 3 spells are always prepared and do not count against the class table. The later grants at Cleric levels 5, 7 and 9 are not automatic.',
      grants: {
        kind: 'spells',
        fixed: ['aid', 'bless', 'cure-wounds', 'lesser-restoration'],
      },
    },
    {
      id: 'life-domain:preserve-life',
      name: 'Preserve Life',
      level: 3,
      automation: 'manual',
      note: 'Dividing five times your Cleric level in hit points among Bloodied creatures, capped at half their maximum, is not modelled.',
    },
    {
      id: 'life-domain:blessed-healer',
      name: 'Blessed Healer',
      level: 6,
      automation: 'manual',
      note: 'The caster healing themselves when they heal somebody else is not applied.',
    },
    {
      id: 'life-domain:supreme-healing',
      name: 'Supreme Healing',
      level: 17,
      automation: 'manual',
      note: 'Maximising healing dice rather than rolling them is not applied.',
    },
  ],
};

export const CLERIC_SUBCLASSES: readonly SubclassDefinition[] = [LIFE_DOMAIN];
