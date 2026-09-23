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

/**
 * The four Metamagic options the engine executes, priced as the SRD prices
 * them.
 *
 * Each of them rewrites one number the casting command works out before it
 * spends anything, which is what `casting-options` is for. The other six are
 * transcribed on the menu above and are the DM's, for three different reasons:
 *
 * | SRD | What it wants |
 * |---|---|
 * | Empowered, Seeking | a damage die rerolled, a d20 rerolled: the dice layer's `rerollDice`, which nothing passes through a casting |
 * | Careful | creatures that automatically succeed on a save this casting is about to roll |
 * | Heightened | Disadvantage on one target's saves against this casting |
 * | Subtle | components, which a `SpellDefinition` does not carry at all |
 * | Transmuted | a damage type the caster restates, which is what a casting deals rather than what it costs |
 */
const METAMAGIC_EXECUTED = [
  {
    id: 'distant-spell',
    name: 'Distant Spell',
    cost: 1,
    // SRD: "double the spell's range. Or when you cast a spell that has a
    // range of Touch ... make the spell's range 30 feet."
    alters: { kind: 'range', multiplier: 2, touchBecomesFeet: 30 },
  },
  {
    id: 'extended-spell',
    name: 'Extended Spell',
    cost: 1,
    // SRD: "a spell that has a duration of 1 minute or longer ... double its
    // duration to a maximum duration of 24 hours."
    alters: { kind: 'duration', multiplier: 2, minimumSeconds: 60, maximumSeconds: 86400 },
  },
  {
    id: 'quickened-spell',
    name: 'Quickened Spell',
    cost: 2,
    // SRD: "a spell that has a casting time of an action ... change the
    // casting time to a Bonus Action for this casting."
    alters: { kind: 'casting-time', from: 'action', to: 'bonus-action' },
  },
  {
    id: 'twinned-spell',
    name: 'Twinned Spell',
    cost: 1,
    // SRD: "a spell, such as Charm Person, that can be cast with a
    // higher-level spell slot to target an additional creature ... increase
    // the spell's effective level by 1."
    alters: { kind: 'effective-level', by: 1, onlyIfTargetsScale: true },
  },
] as const;

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
      note: 'Half of it is applied, which is why this is not marked as executed. SRD: "You can use this feature twice, and you regain all expended uses when you finish a Long Rest" — two uses declared as a pool, counted and recovered, which is what Sorcery Incarnate at level 7 buys back with Sorcery Points. The rest is not: the +1 to spell save DC and Advantage on spell attacks are two benefits no standing effect states, they run for one minute, which is a printed span rather than a turn boundary, and the activation that switches it on can sit beside the pool now that a feature carries more than one grant, so what is left of that half is the span it would run for.',
      grants: {
        kind: 'pool',
        key: 'innate-sorcery',
        label: 'Innate Sorcery',
        // "You can use this feature twice" — a flat two at every level, which
        // is the sizing that names no shape: the Sorcerer table prints no
        // column for it, because the number never moves.
        minimum: 2,
        recovers: 'long-rest',
      },
    },
    {
      id: 'sorcerer:font-of-magic',
      name: 'Font of Magic',
      level: 2,
      automation: 'engine',
      note: 'Sorcery Points are declared as a pool sized by the class table, refilling on a Long Rest — SRD: "You regain all expended Sorcery Points when you finish a Long Rest." Both conversions run: "You can expend a spell slot to gain a number of Sorcery Points equal to the slot’s level (no action required)", and "You can transform unexpended Sorcery Points into one spell slot as a Bonus Action", priced off the Created Spell Slots table. What is **not** applied is the clause that would mint: a created slot is one the Sorcerer has expended, because a trade gives back what was spent and never takes a pool above the maximum its class table printed, so a Sorcerer holding every slot of that level is refused `nothing_to_regain`. The minimum Sorcerer level column needs no separate check — a slot level this Sorcerer’s table has not reached is a pool they do not have — and "any spell slot you create with this feature vanishes when you finish a Long Rest" has nothing to remove under that reading, since a Long Rest restores every slot in any case.',
      grants: {
        kind: 'trade',
        // The feature holds the pool its own conversions run between, which
        // `reaction` already does with the same two words: SRD prints one
        // feature and `FeatureGrant` carries one grant.
        pool: 'sorcery-points',
        poolLabel: 'Sorcery Points',
        declares: { usesByLevel: SORCERY_POINTS, recovers: 'long-rest' },
        trades: [
          {
            id: 'slot-for-points',
            name: 'Converting Spell Slots to Sorcery Points',
            action: 'none',
            spends: { kind: 'spell-slot' },
            gains: { kind: 'pool', key: 'sorcery-points', uses: 'the-slot-level' },
            limit: 'unlimited',
          },
          {
            id: 'points-for-slot',
            name: 'Creating Spell Slots',
            action: 'bonus-action',
            // SRD's Created Spell Slots table — 2 points for a level 1 slot up
            // to 7 for a level 5 — and its fifth row is the printed cap in the
            // same sentence: "You can create a spell slot no higher than level
            // 5." The minimum Sorcerer level column needs no row here: a slot
            // level this Sorcerer has not reached is a pool they do not hold.
            spends: { kind: 'pool', key: 'sorcery-points', uses: { byBoughtSlotLevel: [2, 3, 5, 6, 7] } },
            gains: { kind: 'spell-slot' },
            limit: 'unlimited',
          },
        ],
      },
    },
    {
      id: 'sorcerer:metamagic',
      name: 'Metamagic',
      level: 2,
      automation: 'manual',
      note: 'Two options are chosen and recorded, and more at levels 10 and 17. Four of the ten are executed — Distant, Extended, Quickened and Twinned each rewrite one number the casting works out before it spends anything, and the Sorcery Points go inside that casting’s own batch. The other six are not: Empowered Spell and Seeking Spell are `rerollDice` in the dice layer, which a caller opts into per roll; Careful Spell needs creatures that automatically succeed on a save the casting is about to roll; Heightened Spell needs Disadvantage hung on one target’s saves against this casting; Subtle Spell has nothing to remove, because a spell definition carries no components; and Transmuted Spell needs the caster to restate a damage type the spell printed. The "only one option on a spell" limit is enforced; the clause that stops a level 1+ spell later in the turn a Quickened one was cast on is not, and the engine’s own one-slot-per-turn rule stands in its place.',
      choice: { kind: 'option', choose: 2, from: METAMAGIC_OPTIONS },
      grants: {
        kind: 'casting-options',
        // Font of Magic declares the pool at level 2 and this spends it: one
        // feature carries one grant, so the declaration and the spending are
        // two features, which is how the SRD prints them.
        pool: 'sorcery-points',
        // SRD: "You can use only one Metamagic option on a spell when you cast
        // it unless otherwise noted in one of those options." Sorcery Incarnate
        // lifts it to two and that is a later feature rewriting an earlier
        // one's rule, which no grant says.
        perCasting: 1,
        options: METAMAGIC_EXECUTED,
      },
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
      note: 'Half of it is applied, which is why this is not marked as executed. SRD: "If you use your Innate Sorcery feature when you have no uses of it left, you can expend 2 Sorcery Points to use it" — two points spent on the pool Innate Sorcery declares, with no action and no limit, and legal only while that pool is empty, which is the clause the sentence turns on. A trade gives back what was spent, so a Sorcerer who has spent no use is refused rather than handed a third. Using two Metamagic options on one spell is the other sentence and is not applied: a later feature lifting an earlier one’s printed limit is a shape no grant says.',
      grants: {
        kind: 'trade',
        trades: [
          {
            id: 'points-for-innate-sorcery',
            name: 'Sorcery Incarnate',
            // The sentence charges nothing in the action economy.
            action: 'none',
            spends: { kind: 'pool', key: 'sorcery-points', uses: 2 },
            gains: { kind: 'pool', key: 'innate-sorcery', uses: 1 },
            limit: 'unlimited',
            // "when you have no uses of it left".
            onlyIfEmpty: 'innate-sorcery',
          },
        ],
      },
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
      automation: 'engine',
      note: 'Both sentences are applied, which is what a feature carrying two grants is for. SRD, "While you aren’t wearing armor, your base Armor Class equals 10 plus your Dexterity and Charisma modifiers" is the unarmoured defence `armorClassOf` reads; "your Hit Point maximum increases by 3, and it increases by 1 whenever you gain another Sorcerer level" is three hit points at level 3 and one more for each Sorcerer level after it, counted in **Sorcerer** levels rather than the character’s, so a Sorcerer 3 / Fighter 2 has three.',
      grants: [
        { kind: 'unarmored-defense', ability: 'cha', shieldAllowed: true },
        // "another **Sorcerer** level", which is the class fork rather than
        // the character one Dwarven Toughness takes.
        { kind: 'hit-point-maximum', flat: 3, perLevel: 'class' },
      ],
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
