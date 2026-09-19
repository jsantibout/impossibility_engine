import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Wizard, transcribed from SRD 5.2.1 "Classes".
 *
 * Hand-written rather than parsed: `classes.md` has no parser, and writing one
 * is a milestone of its own. Transcription hides typos, so the tests assert
 * relationships rather than presence — every printed Proficiency Bonus is
 * checked against the formula, and slots are checked never to go backwards.
 *
 * One class, complete, before a second one starts. The structures in
 * `progression.ts` are the reusable part; this file is the proof they fit
 * something real.
 */

/** Wizard Features table: level, PB, cantrips, prepared, then slots 1-9. */
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
  [14, 5, 5, 18, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 5, 19, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 5, 21, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 5, 22, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 5, 23, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 5, 24, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 5, 25, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[2] ?? 0,
  preparedSpells: row[3] ?? 0,
  spellSlots: row.slice(4),
}));

export const WIZARD: ClassDefinition = {
  id: 'wizard',
  name: 'Wizard',
  primaryAbility: 'int',
  // SRD Wizard: Intelligence, and spells are copied into a book and prepared
  // from it — which is one of three quite different ways a class casts.
  spellcasting: { ability: 'int', style: 'spellbook', progression: 'full', startsAtLevel: 1 },
  hitDie: 6,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    tools: [],
  },
  saveProficiencies: ['int', 'wis'],
  skillChoices: {
    choose: 2,
    from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'nature', 'religion'],
  },
  weaponProficiencies: ['simple'],
  // SRD Core Wizard Traits: "Armor Training: None."
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'dagger', quantity: 2 },
        // SRD prints "Arcane Focus (Quarterstaff)": the focus row varies in
        // price, and the quarterstaff is the variant this package names.
        { id: 'quarterstaff', quantity: 1, detail: 'Arcane Focus' },
        { id: 'robe', quantity: 1 },
        { id: 'spellbook', quantity: 1 },
        { id: 'scholars-pack', quantity: 1 },
      ],
      goldPieces: 5,
    },
    { option: 'B', items: [], goldPieces: 55 },
  ],
  features: [
    {
      id: 'wizard:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots, prepared spells and the spellbook are tracked; the spells themselves are cast through the casting commands.',
    },
    {
      id: 'wizard:ritual-adept',
      name: 'Ritual Adept',
      level: 1,
      automation: 'manual',
      note: 'Casting from the spellbook as a Ritual is legal through `castSpell` with `slotless: "ritual"`, but the engine does not check that the spell has the Ritual tag or that the book is in hand, and long casting times are refused.',
    },
    {
      id: 'wizard:arcane-recovery',
      name: 'Arcane Recovery',
      level: 1,
      automation: 'engine',
      note: 'Declared as a pool of one use refilling on a Long Rest — the same grant every other class resource now uses, rather than the one feature matched by id. Choosing which slots to recover, and the half-level cap on their total, are the caller’s.',
      grants: {
        kind: 'pool',
        key: 'wizard:arcane-recovery',
        label: 'Arcane Recovery',
        minimum: 1,
        recovers: 'long-rest',
      },
    },
    {
      id: 'wizard:scholar',
      name: 'Scholar',
      level: 2,
      automation: 'engine',
      note: 'Expertise in the chosen skill is applied to the sheet.',
      grants: { kind: 'expertise' },
      choice: {
        kind: 'skill',
        choose: 1,
        from: ['arcana', 'history', 'investigation', 'medicine', 'nature', 'religion'],
      },
    },
    {
      id: 'wizard:subclass',
      name: 'Wizard Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'wizard:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Wizard levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'wizard:memorize-spell',
      name: 'Memorize Spell',
      level: 5,
      automation: 'manual',
      note: 'Swapping a prepared spell on a Short Rest is not wired into the rest commands.',
    },
    {
      id: 'wizard:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Wizard levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as wizard:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'wizard:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Wizard levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as wizard:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'wizard:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Wizard levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as wizard:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'wizard:spell-mastery',
      name: 'Spell Mastery',
      level: 18,
      automation: 'manual',
      note: 'Casting the chosen spells at will is not modelled.',
    },
    {
      id: 'wizard:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Spell Recall is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'wizard:signature-spells',
      name: 'Signature Spells',
      level: 20,
      automation: 'manual',
      note: 'The free level 3 castings are not modelled.',
    },
  ],
};

/** SRD "Wizard Subclass: Evoker" — the subclass the SRD publishes for Wizards. */
export const EVOKER: SubclassDefinition = {
  id: 'evoker',
  name: 'Evoker',
  classId: 'wizard',
  features: [
    {
      id: 'evoker:evocation-savant',
      name: 'Evocation Savant',
      level: 3,
      automation: 'engine',
      note: 'The two free spells are added to the spellbook. The later "one per new slot level" grant is not automatic.',
      grants: { kind: 'spells' },
      choice: { kind: 'spell', choose: 2, school: 'evocation', maxLevel: 2 },
    },
    {
      id: 'evoker:potent-cantrip',
      name: 'Potent Cantrip',
      level: 3,
      automation: 'engine',
      note: 'Applied. SRD: "When you cast a cantrip at a creature and you miss with the attack roll or the target succeeds on a saving throw against the cantrip, the target takes half the cantrip\'s damage (if any) but suffers no additional effect from the cantrip." A `casting-damage` grant over slot level 0, which is what a cantrip is cast at; both branches already deal half and already hang no rider, so the feature supplies the `half` the definition prints on neither. It says nothing about which class the cantrip came from, so a cantrip from a feat carries it too.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'casting-damage',
            when: { slotLevels: { from: 0, to: 0 } },
            alters: { kind: 'half-when-avoided' },
          },
        ],
      },
    },
    {
      id: 'evoker:sculpt-spells',
      name: 'Sculpt Spells',
      level: 6,
      automation: 'manual',
      note: 'Choosing creatures to automatically succeed is not modelled.',
    },
    {
      id: 'evoker:empowered-evocation',
      name: 'Empowered Evocation',
      level: 10,
      automation: 'engine',
      note: 'Applied. SRD: "Whenever you cast a Wizard spell from the Evocation school, you can add your Intelligence modifier to one damage roll of that spell." Elemental Affinity\'s sentence on a second class, which is what makes it a shape rather than one subclass\'s quirk. "A **Wizard** spell" is the route rather than the list, so a Sorcerer/Wizard casting Fireball through the Sorcerer half is not reached; "you can" means the casting names the feature or it adds nothing.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'casting-damage',
            when: { classId: 'wizard', school: 'evocation' },
            alters: { kind: 'ability-modifier', ability: 'int' },
            optional: true,
          },
        ],
      },
    },
    {
      id: 'evoker:overchannel',
      name: 'Overchannel',
      level: 14,
      automation: 'engine',
      note: 'Applied, both sentences. SRD: "When you cast a Wizard spell with a spell slot of levels 1–5 that deals damage, you can deal maximum damage with that spell on the turn you cast it. The first time you do so, you suffer no adverse effect. If you use this feature again before you finish a Long Rest, you take 2d12 Necrotic damage for each level of the spell slot immediately after you cast it. This damage ignores Resistance and Immunity. Each time you use this feature again before finishing a Long Rest, the Necrotic damage per spell level increases by 1d12." Maximum damage throws nothing at all, so the dice are the highest they could have been and the generator has not moved; the price is a count with no ceiling, because a pool of one would refuse the second use where the book charges for it.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'casting-damage',
            when: { classId: 'wizard', slotLevels: { from: 1, to: 5 }, dealsDamage: true },
            alters: { kind: 'maximum' },
            optional: true,
            costs: {
              freeUses: 1,
              dicePerSlotLevel: '2d12',
              increasesBy: '1d12',
              damageType: 'necrotic',
              ignoresDefenses: true,
              key: 'evoker:overchannel',
              recovers: 'long-rest',
            },
          },
        ],
      },
    },
  ],
};

export const WIZARD_SUBCLASSES: readonly SubclassDefinition[] = [EVOKER];
