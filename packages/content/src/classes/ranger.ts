import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Ranger, transcribed from SRD 5.2.1 "Classes".
 *
 * The twelfth and last class. A half-caster like the Paladin — slots topping
 * out at level 5, no cantrips column — but `known` rather than
 * `prepared-from-list`, which is a combination no other class has and which
 * needed nothing new to express.
 *
 * Like the Paladin, **2024 gives it spellcasting at level 1**: two known
 * spells and two level 1 slots. The 2014 Ranger cast from level 2.
 */

/** Ranger Features table: level, PB, Favored Enemy, known spells, slots 1-5. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 2, 2, 2],
  [2, 2, 2, 3, 2],
  [3, 2, 2, 4, 3],
  [4, 2, 2, 5, 3],
  [5, 3, 3, 6, 4, 2],
  [6, 3, 3, 6, 4, 2],
  [7, 3, 3, 7, 4, 3],
  [8, 3, 3, 7, 4, 3],
  [9, 4, 4, 9, 4, 3, 2],
  [10, 4, 4, 9, 4, 3, 2],
  [11, 4, 4, 10, 4, 3, 3],
  [12, 4, 4, 10, 4, 3, 3],
  [13, 5, 5, 11, 4, 3, 3, 1],
  [14, 5, 5, 11, 4, 3, 3, 1],
  [15, 5, 5, 12, 4, 3, 3, 2],
  [16, 5, 5, 12, 4, 3, 3, 2],
  [17, 6, 6, 14, 4, 3, 3, 3, 1],
  [18, 6, 6, 14, 4, 3, 3, 3, 1],
  [19, 6, 6, 15, 4, 3, 3, 3, 2],
  [20, 6, 6, 15, 4, 3, 3, 3, 2],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  // No cantrips column: a Ranger has none, as a Paladin has none.
  preparedSpells: row[3] ?? 0,
  spellSlots: row.slice(4),
}));

/** SRD Favored Enemy: free castings of Hunter's Mark per Long Rest, by level. */
export const FAVORED_ENEMY_USES: readonly number[] = TABLE.map((row) => row[2] ?? 0);

export const RANGER: ClassDefinition = {
  id: 'ranger',
  name: 'Ranger',
  // SRD prints "Dexterity and Wisdom". Spells run off Wisdom, which is what
  // `spellcasting.ability` records; Dexterity is what the weapons read.
  primaryAbility: 'dex',
  spellcasting: { ability: 'wis', style: 'known', progression: 'half', startsAtLevel: 1 },
  hitDie: 10,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    skills: { choose: 1 },
    tools: [],
  },
  saveProficiencies: ['str', 'dex'],
  skillChoices: {
    choose: 3,
    from: [
      'animal-handling',
      'athletics',
      'insight',
      'investigation',
      'nature',
      'perception',
      'stealth',
      'survival',
    ],
  },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: true, heavy: false, shields: true },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'studded-leather-armor', quantity: 1 },
        { id: 'scimitar', quantity: 1 },
        { id: 'shortsword', quantity: 1 },
        { id: 'longbow', quantity: 1 },
        { id: 'arrows', quantity: 20 },
        { id: 'quiver', quantity: 1 },
        // SRD prints "Druidic Focus (sprig of mistletoe)".
        { id: 'sprig-of-mistletoe', quantity: 1, detail: 'Druidic Focus' },
        { id: 'explorers-pack', quantity: 1 },
      ],
      goldPieces: 7,
    },
    { option: 'B', items: [], goldPieces: 150 },
  ],
  features: [
    {
      id: 'ranger:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and the known spell list are tracked. Half-caster slots top out at level 5, and a Ranger has no cantrips at all.',
    },
    {
      id: 'ranger:favored-enemy',
      name: 'Favored Enemy',
      level: 1,
      automation: 'manual',
      note: 'Half of it is applied, which is why this is no longer marked as executed. SRD: "You always have the _Hunter’s Mark_ spell prepared" — a fixed spells grant, and the spell is executed, so the rider really does fire at the marked creature. The rest is not: "You can cast it twice without expending a spell slot, and you regain all expended uses of this ability when you finish a Long Rest" needs a pool a casting can be paid out of, and a feature carries one grant. It was marked executed on the strength of a note that said the free castings had somewhere to come out of, and nothing ever declared one — `freeCastPoolKey` names a free-cast pool for a **feat**’s granted spell and for nothing a class feature grants.',
      grants: { kind: 'spells', fixed: ['hunters-mark'] },
    },
    {
      id: 'ranger:weapon-mastery',
      name: 'Weapon Mastery',
      level: 1,
      automation: 'manual',
      note: 'Mastery properties are parsed onto weapons but not executed, and which two a Ranger has mastery with is recorded nowhere yet.',
    },
    {
      id: 'ranger:deft-explorer',
      name: 'Deft Explorer',
      level: 2,
      automation: 'engine',
      note: 'Expertise in one skill the character is proficient in, applied to the sheet. The two extra languages are recorded by the caller.',
      grants: { kind: 'expertise' },
      choice: { kind: 'skill', choose: 1 },
    },
    {
      id: 'ranger:fighting-style',
      name: 'Fighting Style',
      level: 2,
      automation: 'manual',
      note: 'The chosen Fighting Style feat is recorded and validated against the SRD list, and applied no more than a Fighter’s: each is a modifier the caller passes to a roll.',
      choice: { kind: 'feat', choose: 1, category: 'fighting-style' },
    },
    {
      id: 'ranger:subclass',
      name: 'Ranger Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'ranger:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Ranger levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'ranger:extra-attack',
      name: 'Extra Attack',
      level: 5,
      automation: 'engine',
      note: 'SRD: "You can attack twice instead of once whenever you take the Attack action." The Attack action holds two attacks now rather than costing an action each.',
      grants: { kind: 'extra-attack', attacks: 2 },
    },
    {
      id: 'ranger:roving',
      name: 'Roving',
      level: 6,
      automation: 'engine',
      note: 'SRD: "Your Speed increases by 10 feet while you aren’t wearing Heavy armor. You also have a Climb Speed and a Swim Speed equal to your Speed." The ten feet are applied by speedOf, so they reach the movement allowance, the Dash and the mounting cost. The Climb and Swim Speeds are not: movement has one speed and no modes, and a mode nothing reads would be a vocabulary with no reader.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'speed', feet: 10 }],
        requires: [{ kind: 'not-wearing-heavy-armor' }],
      },
    },
    {
      id: 'ranger:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Ranger levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as ranger:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'ranger:expertise',
      name: 'Expertise',
      level: 9,
      automation: 'engine',
      note: 'Expertise in two more skills, applied the same way as Deft Explorer’s.',
      grants: { kind: 'expertise' },
      choice: { kind: 'skill', choose: 2 },
    },
    {
      id: 'ranger:tireless',
      name: 'Tireless',
      level: 10,
      automation: 'manual',
      note: 'Temporary Hit Points as a Magic action, and reducing Exhaustion on a Short Rest, are not modelled as their own pool.',
    },
    {
      id: 'ranger:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Ranger levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as ranger:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'ranger:relentless-hunter',
      name: 'Relentless Hunter',
      level: 13,
      automation: 'manual',
      note: 'Keeping Concentration on Hunter’s Mark through damage is not applied: the Concentration save reads the damage and knows nothing about which spell it threatens.',
    },
    {
      id: 'ranger:natures-veil',
      name: "Nature's Veil",
      level: 14,
      automation: 'manual',
      note: 'The Invisible condition as a Bonus Action is not applied; the condition exists and nothing spends a Ranger’s uses to impose it.',
    },
    {
      id: 'ranger:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Ranger levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as ranger:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'ranger:precise-hunter',
      name: 'Precise Hunter',
      level: 17,
      automation: 'manual',
      note: 'Advantage against the target of your Hunter’s Mark is not applied. The mark itself is tracked — the casting’s attack rider fires only against the creature it resolved on — and what nothing can say is the other half: a `RollSelector` names a family, an ability and a skill, and has no way to pick out the attack rolls made against **one named creature**.',
    },
    {
      id: 'ranger:feral-senses',
      name: 'Feral Senses',
      level: 18,
      automation: 'engine',
      note: 'SRD: "Your connection to the forces of nature grants you Blindsight with a range of 30 feet." The whole of the trait, and a `sense` grant says it: `sightBetween` consults a sense wherever nobody has declared a sight line, so a Ranger 18 sees a creature within 30 feet that nobody declared them able to see. The note this replaces said Blindsight was not modelled, which stopped being true when the sense vocabulary arrived for Darkvision.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'blindsight', feet: 30 }],
      },
    },
    {
      id: 'ranger:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Dimensional Travel is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'ranger:foe-slayer',
      name: 'Foe Slayer',
      level: 20,
      automation: 'manual',
      note: 'Not applied. SRD 5.2.1 writes the whole feature as one sentence — "The damage die of your _Hunter’s Mark_ is a d10 rather than a d6" — so it is a feature reaching into a casting the character made and changing the notation the definition pinned, and the casting pins its numbers at the casting for exactly the reason that cannot happen.',
    },
  ],
};

/** SRD "Ranger Subclass: Hunter" — the subclass the SRD publishes. */
export const HUNTER: SubclassDefinition = {
  id: 'hunter',
  name: 'Hunter',
  classId: 'ranger',
  features: [
    {
      id: 'hunter:hunters-lore',
      name: "Hunter's Lore",
      level: 3,
      automation: 'manual',
      note: 'Learning a marked creature’s immunities, resistances and vulnerabilities is narration the engine could answer but is not asked.',
    },
    {
      id: 'hunter:hunters-prey',
      name: "Hunter's Prey",
      level: 3,
      automation: 'engine',
      note: 'Colossus Slayer is executed: a hit with a weapon on a target missing any of its Hit Points deals an extra 1d8 of the weapon’s own type, once per turn. Horde Breaker is not — an extra attack inside the Attack action against a second creature is a shape the engine does not have — and a character who chose it gains nothing here. Swapping the option on a rest is not modelled.',
      choice: { kind: 'option', choose: 1, from: ['Colossus Slayer', 'Horde Breaker'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        // SRD: "When you hit a creature with a weapon, the weapon deals an
        // extra 1d8 damage to the target if it's missing any of its Hit
        // Points. You can deal this extra damage only once per turn."
        //
        // No damage type is named, so it is the weapon's own — a bonus, like
        // Sneak Attack. "With a weapon" excludes an Unarmed Strike.
        onlyIfChoice: 'Colossus Slayer',
        effects: [
          {
            kind: 'attack-damage',
            dice: '1d8',
            oncePerTurn: true,
            weaponOnly: true,
            targetMissingHitPoints: true,
          },
        ],
      },
    },
    {
      id: 'hunter:defensive-tactics',
      name: 'Defensive Tactics',
      level: 7,
      automation: 'manual',
      note: 'Escape the Horde and Multiattack Defense both impose Disadvantage on somebody else’s attack, which nothing carries between rolls.',
      choice: { kind: 'option', choose: 1, from: ['Escape the Horde', 'Multiattack Defense'] },
    },
    {
      id: 'hunter:superior-hunters-prey',
      name: "Superior Hunter's Prey",
      level: 11,
      automation: 'manual',
      note: 'Spreading Hunter’s Mark damage to a second creature is not modelled. The spell is executed and the mark is tracked; what has no shape is a feature reaching into a casting the character already made and giving its rider a second creature to fire at.',
    },
    {
      id: 'hunter:superior-hunters-defense',
      name: "Superior Hunter's Defense",
      level: 15,
      automation: 'manual',
      note: 'SRD: "When you take damage, you can take a Reaction to give yourself Resistance to that damage **and any other damage of the same type until the end of the current turn**." Three of the four pieces are built and the fourth is a feature task rather than a primitive. The window exists and Uncanny Dodge answers it; IE-017 made a Resistance something an effect can grant, through `damage-defense-granted`; and the deadline is `end-of-current-turn`, which IE-043 built because `endOfNextTurn` said of the creature whose turn it is resolves two turn-endings away and this Reaction is usually taken on somebody else\'s turn. What is left is a fifth `ReactionEffect` member — `reduce-damage` is not a substitute, because SRD orders Uncanny Dodge\'s halving as an adjustment and Resistance second, so a Ranger who already resists would take a quarter under the wrong one — and a decision the book declines to make: which type "that damage" names when a hit deals two, exactly as it prints no worked example for which type Uncanny Dodge comes off.',
    },
  ],
};

export const RANGER_SUBCLASSES: readonly SubclassDefinition[] = [HUNTER];
