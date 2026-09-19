import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Sorcerer, transcribed from SRD 5.2.1 "Classes".
 *
 * The fourth class, and the last of the three spellcasting styles: a Sorcerer
 * **knows** their spells and never prepares them. SRD's 2024 table calls the
 * column "Prepared Spells" for every caster, but the Sorcerer's text is
 * explicit that the list changes only when they level or take a Long Rest to
 * swap one — so `style: 'known'` records that the count is a *known* list
 * rather than a morning's preparation, and the distinction is a rest rule
 * rather than a creation rule.
 *
 * It also brings the first **Metamagic**, which is the `option` choice kind
 * doing exactly what Divine Order did — a set of named things, none of them
 * feats — and the first class whose subclass grants spells that are *not* on
 * its own list: Draconic Sorcery's Command is a Cleric spell.
 */

/** Sorcerer Features table: level, PB, Sorcery Points, cantrips, known, slots 1-9. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 0, 4, 2, 2],
  [2, 2, 2, 4, 4, 3],
  [3, 2, 3, 4, 6, 4, 2],
  [4, 2, 4, 5, 7, 4, 3],
  [5, 3, 5, 5, 9, 4, 3, 2],
  [6, 3, 6, 5, 10, 4, 3, 3],
  [7, 3, 7, 5, 11, 4, 3, 3, 1],
  [8, 3, 8, 5, 12, 4, 3, 3, 2],
  [9, 4, 9, 5, 14, 4, 3, 3, 3, 1],
  [10, 4, 10, 6, 15, 4, 3, 3, 3, 2],
  [11, 4, 11, 6, 16, 4, 3, 3, 3, 2, 1],
  [12, 4, 12, 6, 16, 4, 3, 3, 3, 2, 1],
  [13, 5, 13, 6, 17, 4, 3, 3, 3, 2, 1, 1],
  [14, 5, 14, 6, 17, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 15, 6, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 16, 6, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 17, 6, 19, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 18, 6, 20, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 19, 6, 21, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 20, 6, 22, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[3] ?? 0,
  preparedSpells: row[4] ?? 0,
  spellSlots: row.slice(5),
}));

/** SRD Font of Magic: Sorcery Points equal to Sorcerer level, from level 2. */
export const SORCERY_POINTS: readonly number[] = TABLE.map((row) => row[2] ?? 0);

/** SRD "Metamagic Options" — the ten the SRD publishes. */
export const METAMAGIC_OPTIONS: readonly string[] = [
  'Careful Spell',
  'Distant Spell',
  'Empowered Spell',
  'Extended Spell',
  'Heightened Spell',
  'Quickened Spell',
  'Seeking Spell',
  'Subtle Spell',
  'Transmuted Spell',
  'Twinned Spell',
];

export const SORCERER: ClassDefinition = {
  id: 'sorcerer',
  name: 'Sorcerer',
  primaryAbility: 'cha',
  // SRD Sorcerer: Charisma, and the spell list is *known* rather than prepared.
  spellcasting: { ability: 'cha', style: 'known', progression: 'full', startsAtLevel: 1 },
  hitDie: 6,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    tools: [],
  },
  saveProficiencies: ['con', 'cha'],
  skillChoices: {
    choose: 2,
    from: ['arcana', 'deception', 'insight', 'intimidation', 'persuasion', 'religion'],
  },
  weaponProficiencies: ['simple'],
  // SRD Core Sorcerer Traits: "Armor Training: None."
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'spear', quantity: 1 },
        { id: 'dagger', quantity: 2 },
        // SRD prints "Arcane Focus (crystal)": the focus row varies in price,
        // and the crystal is the variant this package names.
        { id: 'crystal', quantity: 1, detail: 'Arcane Focus' },
        { id: 'dungeoneers-pack', quantity: 1 },
      ],
      goldPieces: 28,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'sorcerer:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and the known spell list are tracked. A Sorcerer never prepares: the list changes on levelling or by swapping one on a Long Rest, and the swap is not wired to the rest commands.',
    },
    {
      id: 'sorcerer:innate-sorcery',
      name: 'Innate Sorcery',
      level: 1,
      automation: 'manual',
      note: 'The +1 to spell save DC and Advantage on spell attacks for one minute are not applied, and the twice-per-long-rest limit is not tracked.',
    },
    {
      id: 'sorcerer:font-of-magic',
      name: 'Font of Magic',
      level: 2,
      automation: 'engine',
      note: 'Sorcery Points are declared as a pool sized by the class table, refilling on a Long Rest — SRD: "You regain all expended Sorcery Points when you finish a Long Rest." Converting them into spell slots and back is not modelled: it would mint a slot the class table never printed.',
      grants: {
        kind: 'pool',
        key: 'sorcery-points',
        label: 'Sorcery Points',
        usesByLevel: SORCERY_POINTS,
        recovers: 'long-rest',
      },
    },
    {
      id: 'sorcerer:metamagic',
      name: 'Metamagic',
      level: 2,
      automation: 'manual',
      note: 'Two options are chosen and recorded, and more at levels 10 and 17. None is executed; Empowered Spell is `rerollDice` in the dice layer, which a caller opts into per roll.',
      choice: { kind: 'option', choose: 2, from: METAMAGIC_OPTIONS },
    },
    {
      id: 'sorcerer:subclass',
      name: 'Sorcerer Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'sorcerer:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Sorcerer levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'sorcerer:sorcerous-restoration',
      name: 'Sorcerous Restoration',
      level: 5,
      automation: 'engine',
      note: 'SRD: "When you finish a Short Rest, you can regain expended Sorcery Points, but no more than a number equal to half your Sorcerer level (round down). Once you use this feature, you can’t do so again until you finish a Long Rest." The cap is derived at the moment of use, the moment is checked against the rest that just finished, and the daily limit is a pool of one.',
      grants: {
        kind: 'recovery',
        pool: 'sorcerer:sorcerous-restoration',
        poolLabel: 'Sorcerous Restoration',
        restores: { kind: 'pool', key: 'sorcery-points' },
        upTo: 'half-class-level',
        moment: 'short-rest',
      },
    },
    {
      id: 'sorcerer:sorcery-incarnate',
      name: 'Sorcery Incarnate',
      level: 7,
      automation: 'manual',
      note: 'Using two Metamagic options on one spell, and spending Sorcery Points to use Innate Sorcery again, are not modelled.',
    },
    {
      id: 'sorcerer:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Sorcerer levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as sorcerer:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'sorcerer:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Sorcerer levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as sorcerer:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'sorcerer:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Sorcerer levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as sorcerer:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'sorcerer:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Dimensional Travel is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'sorcerer:arcane-apotheosis',
      name: 'Arcane Apotheosis',
      level: 20,
      automation: 'manual',
      note: 'The free Metamagic option during Innate Sorcery is not modelled.',
    },
  ],
};

/**
 * SRD "Sorcerer Subclass: Draconic Sorcery" — the subclass the SRD publishes.
 *
 * Its level 3 spells include Command, which is a **Cleric** spell. That is the
 * point of a granted spell not being checked against the class list: a domain
 * or bloodline grant exists precisely to hand over something the class could
 * not otherwise cast.
 */
export const DRACONIC_SORCERY: SubclassDefinition = {
  id: 'draconic-sorcery',
  name: 'Draconic Sorcery',
  classId: 'sorcerer',
  features: [
    {
      id: 'draconic-sorcery:draconic-resilience',
      name: 'Draconic Resilience',
      level: 3,
      automation: 'manual',
      note: 'The Armour Class half is applied: SRD, "While you aren’t wearing armor, your base Armor Class equals 10 plus your Dexterity and Charisma modifiers." The hit point half is not — "your Hit Point maximum increases by 3, and it increases by 1 whenever you gain another Sorcerer level" needs a feature that raises the hit point maximum, which nothing else wants yet.',
      grants: { kind: 'unarmored-defense', ability: 'cha', shieldAllowed: true },
    },
    {
      id: 'draconic-sorcery:draconic-spells',
      name: 'Draconic Spells',
      level: 3,
      automation: 'engine',
      note: 'The level 3 spells are always prepared and do not count against the class table. The later grants at Sorcerer levels 5 and 7 are not automatic.',
      grants: {
        kind: 'spells',
        fixed: ['alter-self', 'chromatic-orb', 'command', 'dragons-breath'],
      },
    },
    {
      id: 'draconic-sorcery:elemental-affinity',
      name: 'Elemental Affinity',
      level: 6,
      automation: 'engine',
      note: 'Both halves are applied, off one choice. SRD: "Choose one of those types: Acid, Cold, Fire, Lightning, or Poison. You have Resistance to that damage type, and when you cast a spell that deals damage of that type, you can add your Charisma modifier to one damage roll of that spell." The Resistance names no condition, so a Stunned Sorcerer still resists; the Charisma modifier is a `casting-damage` grant reading the same chosen type, and "you can" means the casting names the feature or it adds nothing.',
      choice: { kind: 'option', choose: 1, from: ['Acid', 'Cold', 'Fire', 'Lightning', 'Poison'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          { kind: 'damage-resistance', damageTypes: [] },
          {
            kind: 'casting-damage',
            // The type is filled from the same answer the Resistance reads: one
            // choice, two halves of one printed sentence.
            when: { damageTypes: [] },
            alters: { kind: 'ability-modifier', ability: 'cha' },
            optional: true,
          },
        ],
        damageTypesFromChoice: true,
      },
    },
    {
      id: 'draconic-sorcery:dragon-wings',
      name: 'Dragon Wings',
      level: 14,
      automation: 'manual',
      note: 'A Fly Speed is not modelled: movement has one speed and no modes.',
    },
    {
      id: 'draconic-sorcery:dragon-companion',
      name: 'Dragon Companion',
      level: 18,
      automation: 'manual',
      note: 'Summoning a Dragon is not modelled; summons are a shape the engine does not have.',
    },
  ],
};

export const SORCERER_SUBCLASSES: readonly SubclassDefinition[] = [DRACONIC_SORCERY];
