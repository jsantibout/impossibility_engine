import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from './progression.js';

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
  spellcasting: { ability: 'wis', style: 'known', startsAtLevel: 1 },
  hitDie: 10,
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
      automation: 'engine',
      note: 'Hunter’s Mark is always prepared, and the free castings are declared as a pool refilling on a Long Rest. The spell itself has no executable definition, so casting it is refused rather than approximated.',
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
      automation: 'manual',
      note: 'Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. What is not modelled here is taking the increase as ability scores rather than as a feat — the choice is always a feat.',
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
      automation: 'manual',
      note: 'The extra Speed and the Climb and Swim Speeds are not applied; movement has one speed and no modes.',
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
      id: 'ranger:precise-hunter',
      name: 'Precise Hunter',
      level: 17,
      automation: 'manual',
      note: 'Advantage against the target of your Hunter’s Mark is not applied, because nothing tracks who is marked.',
    },
    {
      id: 'ranger:feral-senses',
      name: 'Feral Senses',
      level: 18,
      automation: 'manual',
      note: 'Blindsight is not modelled; sight is declared between pairs of creatures and has no senses behind it.',
    },
    {
      id: 'ranger:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'Whether a boon does anything is a property of the boon, not of this feature. No Epic Boon is executed: the SRD’s boons raise an ability score maximum above 20 or grant an effect the engine has no hook for, and the choice is recorded and validated rather than applied.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'ranger:foe-slayer',
      name: 'Foe Slayer',
      level: 20,
      automation: 'manual',
      note: 'The extra 1d10 Force damage once per turn is a bonus the caller supplies.',
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
      note: 'Spreading Hunter’s Mark damage to a second creature is not modelled, because Hunter’s Mark is not.',
    },
    {
      id: 'hunter:superior-hunters-defense',
      name: "Superior Hunter's Defense",
      level: 15,
      automation: 'manual',
      note: 'SRD: "When you take damage, you can take a Reaction to give yourself Resistance to that damage **and any other damage of the same type until the end of the current turn**." The window exists and Uncanny Dodge answers it. What is missing is the other half: a **Resistance with a deadline**, granted in play. Defences are declared when a creature is added and nothing changes them afterwards, and applying only the first half would quietly drop a benefit that lasts the rest of the turn.',
    },
  ],
};

export const RANGER_SUBCLASSES: readonly SubclassDefinition[] = [HUNTER];
