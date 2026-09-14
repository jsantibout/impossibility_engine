import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from './progression.js';

/**
 * The Rogue, transcribed from SRD 5.2.1 "Classes".
 *
 * The sixth class, and the second user of `grants: { kind: 'expertise' }`.
 * That grant was introduced to stop `creation.ts` matching `wizard:scholar` by
 * id, and until now the Wizard's Scholar was the only feature in it — a
 * generalisation with one user is a guess. The Rogue's Expertise is the same
 * rule, wants **two** skills rather than one, and comes round a second time at
 * level 6, which is three ways it differs while still being the same grant.
 *
 * Two other things it is first at:
 *
 * - **Four class skills**, where every class so far has chosen two.
 * - **A tool proficiency from the class**, rather than from a background.
 *   Thieves' Tools are granted outright, not chosen.
 */

/** Rogue Features table: level, PB, Sneak Attack dice. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 1],
  [2, 2, 1],
  [3, 2, 2],
  [4, 2, 2],
  [5, 3, 3],
  [6, 3, 3],
  [7, 3, 4],
  [8, 3, 4],
  [9, 4, 5],
  [10, 4, 5],
  [11, 4, 6],
  [12, 4, 6],
  [13, 5, 7],
  [14, 5, 7],
  [15, 5, 8],
  [16, 5, 8],
  [17, 6, 9],
  [18, 6, 9],
  [19, 6, 10],
  [20, 6, 10],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
}));

/** SRD Sneak Attack: the number of d6 at each Rogue level. */
export const SNEAK_ATTACK_DICE: readonly number[] = TABLE.map((row) => row[2] ?? 0);

export const ROGUE: ClassDefinition = {
  id: 'rogue',
  name: 'Rogue',
  primaryAbility: 'dex',
  hitDie: 8,
  saveProficiencies: ['dex', 'int'],
  // SRD: "Choose 4" — every class before this chose two.
  skillChoices: {
    choose: 4,
    from: [
      'acrobatics',
      'athletics',
      'deception',
      'insight',
      'intimidation',
      'investigation',
      'perception',
      'persuasion',
      'sleight-of-hand',
      'stealth',
    ],
  },
  // SRD: "Simple weapons and Martial weapons that have the Finesse or Light
  // property." The qualified half is recorded as a category the engine does
  // not evaluate — it cannot check a weapon's properties against a class's
  // proficiency, and pretending otherwise would let a Rogue wield a greataxe.
  weaponProficiencies: ['simple', 'martial-finesse-or-light'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'leather-armor', quantity: 1 },
        { id: 'dagger', quantity: 2 },
        { id: 'shortsword', quantity: 1 },
        { id: 'shortbow', quantity: 1 },
        { id: 'arrows', quantity: 20 },
        { id: 'quiver', quantity: 1 },
        { id: 'thieves-tools', quantity: 1 },
        { id: 'burglars-pack', quantity: 1 },
      ],
      goldPieces: 8,
    },
    { option: 'B', items: [], goldPieces: 100 },
  ],
  features: [
    {
      id: 'rogue:expertise',
      name: 'Expertise',
      level: 1,
      automation: 'engine',
      note: 'Expertise in the two chosen skills is applied to the sheet, doubling the proficiency bonus on them. The second pair at Rogue level 6 is a separate feature.',
      grants: { kind: 'expertise' },
      choice: { kind: 'skill', choose: 2 },
    },
    {
      id: 'rogue:sneak-attack',
      name: 'Sneak Attack',
      level: 1,
      automation: 'engine',
      note: 'The dice are read off the Rogue table at the character’s Rogue level and added to a qualifying hit, once per turn — *a* turn, so an Opportunity Attack on somebody else’s turn qualifies again. The qualifications are checked: Advantage on the roll, or a non-Incapacitated ally within 5 feet of the target and no Disadvantage, and a Finesse or Ranged weapon either way. The damage is of the weapon’s own type, so Resistance to the weapon resists it too, and a critical doubles the dice. What the engine cannot settle is the ally clause where nobody has declared who is on whose side: it withholds the benefit and says so rather than inventing an ally. Cunning Strike’s trade of dice for effects is a separate feature and is not modelled.',
      grants: {
        kind: 'standing',
        reach: 'self',
        // SRD: "Once per turn, you can deal an extra 1d6 damage to one
        // creature you hit with an attack roll if you have Advantage on the
        // roll and the attack uses a Finesse or a Ranged weapon. The extra
        // damage's type is the same as the weapon's type."
        //
        // No `damageType`, which is what makes it a *bonus* rather than extra
        // typed damage — the weapon's own type, riding with it through
        // Resistance.
        effects: [
          {
            kind: 'attack-damage',
            dice: '1d6',
            oncePerTurn: true,
            finesseOrRangedWeapon: true,
            advantageOrAdjacentAlly: true,
          },
        ],
        diceCountByLevel: SNEAK_ATTACK_DICE,
      },
    },
    {
      id: 'rogue:thieves-cant',
      name: "Thieves' Cant",
      level: 1,
      automation: 'manual',
      note: 'A language with no mechanics attached; recorded as a proficiency and read by nobody.',
    },
    {
      id: 'rogue:weapon-mastery',
      name: 'Weapon Mastery',
      level: 1,
      automation: 'manual',
      note: 'Mastery properties are parsed onto weapons but not executed, and which two a Rogue has mastery with is recorded nowhere yet.',
    },
    {
      id: 'rogue:cunning-action',
      name: 'Cunning Action',
      level: 2,
      automation: 'manual',
      note: 'Dash, Disengage or Hide as a Bonus Action is not offered: the action economy tracks whether a Bonus Action was spent, not which actions a class may spend it on.',
    },
    {
      id: 'rogue:subclass',
      name: 'Rogue Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'rogue:steady-aim',
      name: 'Steady Aim',
      level: 3,
      automation: 'manual',
      note: 'SRD: "you can take a Bonus Action to give yourself Advantage on your next attack roll on the current turn. You can use this Bonus Action only if you haven’t moved during this turn, and after you use it, your Speed is 0 until the end of the current turn." Not modelled, and neither half of the Speed sentence is the blocker any more: `speedOf` reads a grant like any other, and "until the end of the current turn" is `end-of-current-turn`, which IE-043 built for Stinking Cloud. What is left is the clause this feature is actually for — a one-shot Advantage that is consumed by the roll it changes, which nothing here consumes — and the "haven’t moved during this turn" condition on spending the Bonus Action.',
    },
    {
      id: 'rogue:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'manual',
      note: 'Whether a feat does anything is a property of the feat, not of this feature: Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. What is not modelled here is taking the increase as ability scores rather than as a feat — the choice is always a feat.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'rogue:cunning-strike',
      name: 'Cunning Strike',
      level: 5,
      automation: 'manual',
      note: 'Trading Sneak Attack dice for Poison, Trip or Withdraw is not modelled, because Sneak Attack itself is not.',
    },
    {
      id: 'rogue:uncanny-dodge',
      name: 'Uncanny Dodge',
      level: 5,
      automation: 'engine',
      note: 'SRD: "When an attacker that you can see hits you with an attack roll, you can take a Reaction to halve the attack’s damage against you (round down)." The hit holds its damage open, the Reaction is spent, and the halving comes off the total before defences — so a Rogue with Resistance takes a quarter, which is what the order of application says.',
      grants: {
        kind: 'reaction',
        costsReaction: true,
        reach: { kind: 'self' },
        // "an attacker **that you can see**".
        requiresSight: true,
        does: [
          {
            kind: 'reduce-damage',
            amount: { halve: true },
            // "hits you with an attack roll" — not a Fireball.
            fromAttackOnly: true,
          },
        ],
      },
    },
    {
      id: 'rogue:second-expertise',
      name: 'Expertise',
      level: 6,
      automation: 'engine',
      note: 'Expertise in two more skills, applied the same way as the first pair. A second feature rather than a bigger choice, because the SRD grants it at a different level.',
      grants: { kind: 'expertise' },
      choice: { kind: 'skill', choose: 2 },
    },
    {
      id: 'rogue:evasion',
      name: 'Evasion',
      level: 7,
      automation: 'engine',
      note: 'SRD: \"When you’re subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw and only half damage if you fail.\" Applied by the save-for-damage path, read off the target’s own features. It bites only where the effect already offers half on a success: Sacred Flame offers nothing, and Evasion says nothing about it.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'evasion' }],
      },
    },
    {
      id: 'rogue:reliable-talent',
      name: 'Reliable Talent',
      level: 7,
      automation: 'manual',
      note: 'Treating a d20 below 10 as a 10 on a proficient check is not applied; the dice layer substitutes values on damage dice, not on a D20 Test.',
    },
    {
      id: 'rogue:improved-cunning-strike',
      name: 'Improved Cunning Strike',
      level: 11,
      automation: 'manual',
      note: 'Two Cunning Strike effects at once, neither of which is modelled.',
    },
    {
      id: 'rogue:devious-strikes',
      name: 'Devious Strikes',
      level: 14,
      automation: 'manual',
      note: 'Daze, Knock Out and Obscure as Cunning Strike options are not modelled.',
    },
    {
      id: 'rogue:slippery-mind',
      name: 'Slippery Mind',
      level: 15,
      automation: 'engine',
      note: 'SRD: "You gain proficiency in Wisdom and Charisma saving throws." Unioned into the sheet’s save proficiencies at creation; proficiency is binary, so one the character already had is a no-op rather than a doubling.',
      grants: { kind: 'save-proficiency', abilities: ['wis', 'cha'] },
    },
    {
      id: 'rogue:elusive',
      name: 'Elusive',
      level: 18,
      automation: 'manual',
      note: 'No attack roll having Advantage against you while you are not Incapacitated is not applied.',
    },
    {
      id: 'rogue:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'manual',
      note: 'Whether a boon does anything is a property of the boon, not of this feature. No Epic Boon is executed: the SRD’s boons raise an ability score maximum above 20 or grant an effect the engine has no hook for, and the choice is recorded and validated rather than applied.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'rogue:stroke-of-luck',
      name: 'Stroke of Luck',
      level: 20,
      automation: 'manual',
      note: 'Turning a miss into a hit or a failed check into a 20 once per Short Rest is not modelled.',
    },
  ],
};

/** SRD "Rogue Subclass: Thief" — the subclass the SRD publishes. */
export const THIEF: SubclassDefinition = {
  id: 'thief',
  name: 'Thief',
  classId: 'rogue',
  features: [
    {
      id: 'thief:fast-hands',
      name: 'Fast Hands',
      level: 3,
      automation: 'manual',
      note: 'Sleight of Hand, Thieves’ Tools and the Utilize action as a Bonus Action are not offered, for the same reason as Cunning Action.',
    },
    {
      id: 'thief:second-story-work',
      name: 'Second-Story Work',
      level: 3,
      automation: 'manual',
      note: 'Climbing at full Speed and the longer running jump are not modelled; movement has one speed and no modes.',
    },
    {
      id: 'thief:supreme-sneak',
      name: 'Supreme Sneak',
      level: 9,
      automation: 'manual',
      note: 'Spending Sneak Attack dice for Stealth Advantage is not modelled.',
    },
    {
      id: 'thief:use-magic-device',
      name: 'Use Magic Device',
      level: 13,
      automation: 'manual',
      note: 'Attuning to more items and using any Spell Scroll are not modelled; magic items are not modelled at all.',
    },
    {
      id: 'thief:thiefs-reflexes',
      name: "Thief's Reflexes",
      level: 17,
      automation: 'manual',
      note: 'A second turn in the first round of combat is not modelled: the Initiative order takes one entry per creature.',
    },
  ],
};

export const ROGUE_SUBCLASSES: readonly SubclassDefinition[] = [THIEF];
