import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Druid, transcribed from SRD 5.2.1 "Classes".
 *
 * A `prepared-from-list` caster on the full-caster slot table — the same shape
 * as the Cleric, which is the point: the eleventh class needed nothing new.
 *
 * Its subclass is the one that does not fit the grant system, and says so.
 * Circle of the Land's spells are chosen **after a Long Rest** from one of four
 * land types, so they are neither fixed nor a choice made at creation. A
 * `fixed` grant would pick a land for the player; a `choice` would freeze it
 * for the character's whole life. Neither is the rule, so the feature grants
 * nothing and its note says what it would take.
 */

/** Druid Features table: level, PB, Wild Shape, cantrips, prepared, slots 1-9. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 0, 2, 4, 2],
  [2, 2, 2, 2, 5, 3],
  [3, 2, 2, 2, 6, 4, 2],
  [4, 2, 2, 3, 7, 4, 3],
  [5, 3, 2, 3, 9, 4, 3, 2],
  [6, 3, 3, 3, 10, 4, 3, 3],
  [7, 3, 3, 3, 11, 4, 3, 3, 1],
  [8, 3, 3, 3, 12, 4, 3, 3, 2],
  [9, 4, 3, 3, 14, 4, 3, 3, 3, 1],
  [10, 4, 3, 4, 15, 4, 3, 3, 3, 2],
  [11, 4, 3, 4, 16, 4, 3, 3, 3, 2, 1],
  [12, 4, 3, 4, 16, 4, 3, 3, 3, 2, 1],
  [13, 5, 3, 4, 17, 4, 3, 3, 3, 2, 1, 1],
  [14, 5, 3, 4, 17, 4, 3, 3, 3, 2, 1, 1],
  [15, 5, 3, 4, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [16, 5, 3, 4, 18, 4, 3, 3, 3, 2, 1, 1, 1],
  [17, 6, 4, 4, 19, 4, 3, 3, 3, 2, 1, 1, 1, 1],
  [18, 6, 4, 4, 20, 4, 3, 3, 3, 3, 1, 1, 1, 1],
  [19, 6, 4, 4, 21, 4, 3, 3, 3, 3, 2, 1, 1, 1],
  [20, 6, 4, 4, 22, 4, 3, 3, 3, 3, 2, 2, 1, 1],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[3] ?? 0,
  preparedSpells: row[4] ?? 0,
  spellSlots: row.slice(5),
}));

/** SRD Wild Shape: uses per rest, by level. None before level 2. */
export const WILD_SHAPE_USES: readonly number[] = TABLE.map((row) => row[2] ?? 0);

/**
 * SRD Primal Strike: the extra damage dice at each Druid level.
 *
 * Written in the features rather than in a column — 1d8 at level 7, "increases
 * to 2d8" at 15 — so it is transcribed here beside the table it is not part of.
 */
export const PRIMAL_STRIKE_DICE: readonly number[] = [
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2,
];

export const DRUID: ClassDefinition = {
  id: 'druid',
  name: 'Druid',
  primaryAbility: 'wis',
  spellcasting: { ability: 'wis', style: 'prepared-from-list', progression: 'full', startsAtLevel: 1 },
  hitDie: 8,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: true, medium: false, heavy: false, shields: true },
    tools: [],
  },
  saveProficiencies: ['int', 'wis'],
  skillChoices: {
    choose: 2,
    from: [
      'animal-handling',
      'arcana',
      'insight',
      'medicine',
      'nature',
      'perception',
      'religion',
      'survival',
    ],
  },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: true },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'leather-armor', quantity: 1 },
        { id: 'shield', quantity: 1 },
        { id: 'sickle', quantity: 1 },
        // SRD prints "Druidic Focus (Quarterstaff)": the focus row varies in
        // price, and the quarterstaff is the variant this package names.
        { id: 'quarterstaff', quantity: 1, detail: 'Druidic Focus' },
        { id: 'explorers-pack', quantity: 1 },
        { id: 'herbalism-kit', quantity: 1 },
      ],
      goldPieces: 9,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'druid:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and prepared spells are tracked, prepared from the Druid list rather than a spellbook.',
    },
    {
      id: 'druid:druidic',
      name: 'Druidic',
      level: 1,
      automation: 'manual',
      note: 'A secret language and the hidden messages it leaves are narration; recorded as a proficiency and read by nobody.',
    },
    {
      id: 'druid:primal-order',
      name: 'Primal Order',
      level: 1,
      automation: 'manual',
      note: 'Half of one option is applied. SRD Magician: "you have a bonus to the Intelligence (Arcana) and Intelligence (Nature) checks you make. The bonus equals your Wisdom modifier (minimum of +1)." That is a standing check bonus gated on the option chosen, so it reaches the two named skills and a Druid who took the other option has nothing. The rest is the DM’s: Warden grants Martial weapon proficiency and Medium armour training, which no grant confers, and Magician grants a cantrip as well, which a spells grant gated on the option could say and which this feature has nowhere left to ask: a feature asks the player one thing when it is gained, and Primal Order has asked which order.',
      choice: { kind: 'option', choose: 1, from: ['Magician', 'Warden'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Magician',
        effects: [
          {
            kind: 'check-bonus',
            fromAbility: 'wis',
            minimum: 1,
            skills: ['arcana', 'nature'],
          },
        ],
      },
    },
    {
      id: 'druid:wild-shape',
      name: 'Wild Shape',
      level: 2,
      automation: 'engine',
      note: 'Executed as a `shape-shift` grant. SRD: "As a Bonus Action, you shape-shift into a Beast form that you have learned for this feature. You stay in that form for a number of hours equal to half your Druid level or until you use Wild Shape again, have the Incapacitated condition, or die. You can also leave the form early as a Bonus Action." The pool is sized by the Wild Shape column and refills on a Long Rest, a Short Rest giving one use back; the Beast Shapes table is the `forms` rows, read at the Druid level; the known forms are the character’s `knownForms`, checked against that row when the character is made. A use lays the Beast’s stat block over the sheet with the SRD’s retained half kept — creature type, Hit Points, Intelligence, Wisdom and Charisma, class features, proficiencies at the Druid’s own bonus with the block’s number where it is higher — grants Temporary Hit Points equal to the Druid level, and files the hours. Gear merges and the Armour Class is always the block’s (the owner’s ruling of 2026-09-20). **Not yet:** replacing a known form when a Long Rest ends, which the SRD allows and the rest does not offer; the form’s limbs deciding what can be held; the block’s senses.',
      grants: {
        kind: 'shape-shift',
        action: 'bonus-action',
        pool: 'wild-shape',
        poolLabel: 'Wild Shape',
        usesByLevel: WILD_SHAPE_USES,
        recovers: 'long-rest',
        // SRD: "You regain one expended use when you finish a Short Rest."
        regainsOnShortRest: 1,
        formType: 'Beast',
        // SRD Beast Shapes table: Druid level, known forms, max CR, Fly Speed.
        forms: [
          { fromLevel: 2, known: 4, maxChallengeRating: 0.25, flying: false },
          { fromLevel: 4, known: 6, maxChallengeRating: 0.5, flying: false },
          { fromLevel: 8, known: 8, maxChallengeRating: 1, flying: true },
        ],
        // SRD: "a number of hours equal to half your Druid level".
        hoursPerLevel: 0.5,
        // SRD: "Temporary Hit Points equal to your Druid level".
        temporaryHitPointsPerLevel: 1,
        // SRD: "you retain your ... Intelligence, Wisdom, and Charisma scores".
        keeps: { abilities: ['int', 'wis', 'cha'] },
        // SRD: "You can't cast spells".
        forbidsCasting: true,
      },
    },
    {
      id: 'druid:wild-companion',
      name: 'Wild Companion',
      level: 2,
      automation: 'manual',
      note: 'Spending a Wild Shape use to cast Find Familiar is not modelled: the spell executes, but a casting paid for out of a feature’s pool has no shape, and the familiar it calls is a Fey that disappears when the druid finishes a Long Rest — a lifetime a kept summons does not yet have.',
    },
    {
      id: 'druid:subclass',
      name: 'Druid Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'druid:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Druid levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'druid:wild-resurgence',
      name: 'Wild Resurgence',
      level: 5,
      automation: 'engine',
      note: 'Both directions are executed, as a `trade` grant with two trades — which is what the feature is: "Once on each of your turns, if you have no uses of Wild Shape left, you can give yourself one use by expending a spell slot (no action required). In addition, you can expend one use of Wild Shape (no action required) to give yourself a level 1 spell slot, but you can\'t do so again until you finish a Long Rest." Each clause carries its own limit and its own condition, which is why a trade carries them rather than the feature. The caster names which slot they burn, because the SRD leaves the level to them. **What a trade gives back is what was spent**: a Druid holding every level 1 slot they have is refused rather than handed one the class table never printed, which is the sentence this engine has nowhere to put and the one thing here a DM may still have to rule on.',
      grants: {
        kind: 'trade',
        trades: [
          {
            // SRD: "if you have no uses of Wild Shape left, you can give
            // yourself one use by expending a spell slot (no action required)."
            id: 'slot-for-wild-shape',
            name: 'Wild Resurgence (a slot for a use)',
            action: 'none',
            spends: { kind: 'spell-slot' },
            gains: { kind: 'pool', key: 'wild-shape', uses: 1 },
            limit: 'once-per-turn',
            onlyIfEmpty: 'wild-shape',
          },
          {
            // SRD: "you can expend one use of Wild Shape (no action required)
            // to give yourself a level 1 spell slot, but you can't do so again
            // until you finish a Long Rest."
            id: 'wild-shape-for-slot',
            name: 'Wild Resurgence (a use for a slot)',
            action: 'none',
            spends: { kind: 'pool', key: 'wild-shape', uses: 1 },
            gains: { kind: 'spell-slot', level: 1 },
            limit: 'once-per-long-rest',
            pool: 'druid:wild-resurgence',
            poolLabel: 'Wild Resurgence',
          },
        ],
      },
    },
    {
      id: 'druid:elemental-fury',
      name: 'Elemental Fury',
      level: 7,
      automation: 'engine',
      note: 'Primal Strike is executed: a hit with a weapon deals an extra 1d8, rising to 2d8 at Druid level 15, of whichever of Cold, Fire, Lightning or Thunder the Druid names at the hit — once per turn, and naming no type is how the option is declined. The Beast form’s attack it also covers is not, because Wild Shape is not modelled. Potent Spellcasting is not executed: adding the Wisdom modifier to a cantrip’s damage is a spell-damage rider rather than an attack one.',
      choice: { kind: 'option', choose: 1, from: ['Potent Spellcasting', 'Primal Strike'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        onlyIfChoice: 'Primal Strike',
        // SRD: "Once on each of your turns when you hit a creature with an
        // attack roll using a weapon or a Beast form's attack in Wild Shape,
        // you can cause the target to take an extra 1d8 Cold, Fire, Lightning,
        // or Thunder damage (choose when you hit)."
        effects: [
          {
            kind: 'attack-damage',
            dice: '1d8',
            oncePerTurn: true,
            weaponOnly: true,
            damageTypeChoices: ['cold', 'fire', 'lightning', 'thunder'],
          },
        ],
        diceCountByLevel: PRIMAL_STRIKE_DICE,
      },
    },
    {
      id: 'druid:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Druid levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as druid:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'druid:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Druid levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as druid:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'druid:improved-elemental-fury',
      name: 'Improved Elemental Fury',
      level: 15,
      automation: 'engine',
      executedBy: 'druid:elemental-fury',
      note: 'SRD: "The extra damage of your Primal Strike increases to 2d8." The increase is applied by Elemental Fury’s own dice table, read at the character’s Druid level — this feature is the level at which that table steps, and has no separate effect to execute. The Potent Spellcasting branch’s 300 feet of extra cantrip range is not modelled.',
    },
    {
      id: 'druid:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Druid levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as druid:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'druid:beast-spells',
      name: 'Beast Spells',
      level: 18,
      automation: 'manual',
      note: 'Casting while Wild Shaped is not modelled, because Wild Shape is not.',
    },
    {
      id: 'druid:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Dimensional Travel is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'druid:archdruid',
      name: 'Archdruid',
      level: 20,
      automation: 'manual',
      note: 'Unlimited Wild Shape, the slot recovery and the extended lifespan are not modelled.',
    },
  ],
};

/** SRD "Druid Subclass: Circle of the Land" — the subclass the SRD publishes. */
export const CIRCLE_OF_THE_LAND: SubclassDefinition = {
  id: 'circle-of-the-land',
  name: 'Circle of the Land',
  classId: 'druid',
  features: [
    {
      id: 'circle-of-the-land:spells',
      name: 'Circle of the Land Spells',
      level: 3,
      automation: 'engine',
      note: 'Executed. SRD: "Whenever you finish a Long Rest, choose one type of land: arid, polar, temperate, or tropical. Consult the table below that corresponds to the chosen type; you have the spells listed for your Druid level and lower prepared." The land is this feature’s own choice, re-asked on every finished Long Rest through the `rechosen-on-a-rest` grant, and each land’s spells are a grant gated on the answer — so a Druid who chose arid last night has Blur, Burning Hands and Fire Bolt prepared and none of the other nine, and one who has never named a land has none of them, because the sentence begins "Whenever you finish". What is **not** automatic is the same half Life Domain Spells leaves alone: the later rows at Druid levels 5, 7 and 9 are granted by no shape that counts a *class* level, and a grant staged on the character level would hand a Druid 3 / Fighter 2 a Fireball the book does not print.',
      // "choose one type of land: arid, polar, temperate, or tropical".
      choice: { kind: 'option', choose: 1, from: ['Arid', 'Polar', 'Temperate', 'Tropical'] },
      grants: [
        // "Whenever you finish a Long Rest, choose one type of land".
        { kind: 'rechosen-on-a-rest', rest: 'long', rechooses: { kind: 'this-features-choice' } },
        // The level 3 row of each of the four tables, always prepared. A grant
        // apiece, gated on the land, because the answer is what selects one.
        {
          kind: 'spells',
          fixed: ['blur', 'burning-hands', 'fire-bolt'],
          onlyIfChoice: 'Arid',
        },
        {
          kind: 'spells',
          fixed: ['fog-cloud', 'hold-person', 'ray-of-frost'],
          onlyIfChoice: 'Polar',
        },
        {
          kind: 'spells',
          fixed: ['misty-step', 'shocking-grasp', 'sleep'],
          onlyIfChoice: 'Temperate',
        },
        {
          kind: 'spells',
          fixed: ['acid-splash', 'ray-of-sickness', 'web'],
          onlyIfChoice: 'Tropical',
        },
      ],
    },
  ],
};

export const DRUID_SUBCLASSES: readonly SubclassDefinition[] = [CIRCLE_OF_THE_LAND];
