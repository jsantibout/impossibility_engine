import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Monk, transcribed from SRD 5.2.1 "Classes".
 *
 * The second class with Unarmoured Defense and a different formula for it —
 * 10 + Dexterity + Wisdom, where a Barbarian's is Constitution. Two classes
 * wanting the same missing hook is worth more than one: it says the gap is a
 * *shape* (a class feature that replaces the Armour Class calculation) rather
 * than a Barbarian quirk, and that is how it is recorded in PROGRESS.md.
 *
 * Martial Arts is a die that grows with level rather than a number, so it is
 * exported as notation and pinned by a test — the same treatment Sneak Attack
 * gets, because a growth table is exactly what a transcription gets wrong.
 */

/** Monk Features table: level, PB, Martial Arts die, Focus Points, movement. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 6, 0, 0],
  [2, 2, 6, 2, 10],
  [3, 2, 6, 3, 10],
  [4, 2, 6, 4, 10],
  [5, 3, 8, 5, 10],
  [6, 3, 8, 6, 15],
  [7, 3, 8, 7, 15],
  [8, 3, 8, 8, 15],
  [9, 4, 8, 9, 15],
  [10, 4, 8, 10, 20],
  [11, 4, 10, 11, 20],
  [12, 4, 10, 12, 20],
  [13, 5, 10, 13, 20],
  [14, 5, 10, 14, 25],
  [15, 5, 10, 15, 25],
  [16, 5, 10, 16, 25],
  [17, 6, 12, 17, 25],
  [18, 6, 12, 18, 30],
  [19, 6, 12, 19, 30],
  [20, 6, 12, 20, 30],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
}));

/** SRD Martial Arts: the die a Monk's unarmed strike deals, by level. */
export const MARTIAL_ARTS_DIE: readonly string[] = TABLE.map((row) => `1d${row[2] ?? 6}`);
/** SRD Monk's Focus: Focus Points, by level. None before level 2. */
export const FOCUS_POINTS: readonly number[] = TABLE.map((row) => row[3] ?? 0);
/** SRD Unarmored Movement: extra Speed in feet, by level. */
export const UNARMORED_MOVEMENT: readonly number[] = TABLE.map((row) => row[4] ?? 0);

export const MONK: ClassDefinition = {
  id: 'monk',
  name: 'Monk',
  // SRD prints "Dexterity and Wisdom". The engine takes one; Dexterity is what
  // Martial Arts and Unarmoured Defense both read first.
  primaryAbility: 'dex',
  hitDie: 8,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: false, medium: false, heavy: false, shields: false },
    tools: [],
  },
  saveProficiencies: ['str', 'dex'],
  skillChoices: {
    choose: 2,
    from: ['acrobatics', 'athletics', 'history', 'insight', 'religion', 'stealth'],
  },
  // SRD: "Simple weapons and Martial weapons that have the Light property."
  // The qualified half is a category the engine records and does not evaluate.
  weaponProficiencies: ['simple', 'martial-light'],
  armorTraining: { light: false, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'spear', quantity: 1 },
        { id: 'dagger', quantity: 5 },
        { id: 'explorers-pack', quantity: 1 },
      ],
      goldPieces: 11,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'monk:martial-arts',
      name: 'Martial Arts',
      level: 1,
      automation: 'manual',
      note: 'The growing unarmed damage die, using Dexterity for unarmed strikes, and the Bonus Action unarmed strike are not applied: the attack layer reads a weapon or the fixed Unarmed Strike, and has no notion of a class changing either.',
    },
    {
      id: 'monk:unarmored-defense',
      name: 'Unarmored Defense',
      level: 1,
      automation: 'engine',
      note: 'SRD: "While you aren’t wearing armor or wielding a Shield, your base Armor Class equals 10 plus your Dexterity and Wisdom modifiers." The Shield clause takes the whole calculation away, not just the Shield’s bonus.',
      grants: { kind: 'unarmored-defense', ability: 'wis', shieldAllowed: false },
    },
    {
      id: 'monk:focus',
      name: "Monk's Focus",
      level: 2,
      automation: 'engine',
      note: 'Declared as a pool of Focus Points sized by the class table, refilling on a **Short** Rest — SRD: "unavailable until you finish a Short or Long Rest, at the end of which you regain all your expended points", which is all-or-nothing and needs nothing the pool system lacks. What the points buy — Flurry of Blows, Patient Defense, Step of the Wind — is not executed.',
      grants: {
        kind: 'pool',
        key: 'focus-points',
        label: 'Focus Points',
        usesByLevel: FOCUS_POINTS,
        recovers: 'short-rest',
      },
    },
    {
      id: 'monk:unarmored-movement',
      name: 'Unarmored Movement',
      level: 2,
      automation: 'engine',
      note: 'SRD: "Your speed increases by 10 feet while you aren’t wearing armor or wielding a Shield. This bonus increases when you reach certain Monk levels, as shown on the Monk Features table." Applied by speedOf; the feet are the table\'s column, read at the Monk\'s own level, so a Monk 2 / Fighter 3 gets +10 rather than a level 5 character\'s row. The Shield half is checked as well as the armour half.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'speed', feet: 10 }],
        requires: [{ kind: 'unarmored' }],
        // The table's own column, exactly as Monk's Focus reads `FOCUS_POINTS`
        // beside it. Retyping the twenty numbers would be a second source for
        // one fact — agreeing today, and held in step by nothing: a correction
        // to `TABLE` would leave the Monk's Speed on the old column silently.
        feetByLevel: UNARMORED_MOVEMENT,
      },
    },
    {
      id: 'monk:uncanny-metabolism',
      name: 'Uncanny Metabolism',
      level: 2,
      automation: 'engine',
      note: 'SRD: "When you roll Initiative, you can regain all expended Focus Points. When you do so, roll your Martial Arts die, and regain a number of Hit Points equal to your Monk level plus the number rolled. Once you use this feature, you can’t use it again until you finish a Long Rest." The moment the engine checks is the first turn of the fight, which is the closest it holds to "when you roll Initiative" and is the same window for everyone in the order.',
      grants: {
        kind: 'recovery',
        pool: 'monk:uncanny-metabolism',
        poolLabel: 'Uncanny Metabolism',
        restores: { kind: 'pool', key: 'focus-points' },
        upTo: 'all',
        moment: 'initiative',
        heals: { diceByLevel: MARTIAL_ARTS_DIE, plus: 'class-level' },
      },
    },
    {
      id: 'monk:deflect-attacks',
      name: 'Deflect Attacks',
      level: 3,
      automation: 'engine',
      note: 'SRD: "When an attack roll hits you and its damage includes Bludgeoning, Piercing, or Slashing damage, you can take a Reaction to reduce the attack’s total damage against you. The reduction equals 1d10 plus your Dexterity modifier and Monk level." The Reaction and the reduction are the engine’s; the redirect that follows a reduction to 0 — a Focus Point, a chosen creature, a Dexterity save and damage of the attack’s own type — is not modelled, because nothing chains a second effect onto a reaction.',
      grants: {
        kind: 'reaction',
        costsReaction: true,
        reach: { kind: 'self' },
        does: [
          {
            kind: 'reduce-damage',
            amount: { dice: '1d10', plus: ['dex', 'class-level'] },
            // "**includes** Bludgeoning, Piercing, or Slashing" — one
            // qualifying type is enough, and Deflect Energy widens this list.
            damageTypes: ['bludgeoning', 'piercing', 'slashing'],
            fromAttackOnly: true,
          },
        ],
      },
    },
    {
      id: 'monk:subclass',
      name: 'Monk Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'monk:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Monk levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'monk:slow-fall',
      name: 'Slow Fall',
      level: 4,
      automation: 'manual',
      note: 'Reducing falling damage is not modelled; falling is not modelled.',
    },
    {
      id: 'monk:extra-attack',
      name: 'Extra Attack',
      level: 5,
      automation: 'engine',
      note: 'SRD: "You can attack twice instead of once whenever you take the Attack action." The Attack action holds two attacks now rather than costing an action each.',
      grants: { kind: 'extra-attack', attacks: 2 },
    },
    {
      id: 'monk:stunning-strike',
      name: 'Stunning Strike',
      level: 5,
      automation: 'manual',
      note: 'Spending a Focus Point to force a Constitution save or Stun is not wired: the Stunned condition exists and applying it is the caller’s.',
    },
    {
      id: 'monk:empowered-strikes',
      name: 'Empowered Strikes',
      level: 6,
      automation: 'manual',
      note: 'Choosing Force damage for unarmed strikes is not applied, because unarmed strikes are not a class-modified attack here.',
    },
    {
      id: 'monk:evasion',
      name: 'Evasion',
      level: 7,
      automation: 'engine',
      note: 'SRD: \"When you’re subjected to an effect that allows you to make a Dexterity saving throw to take only half damage, you instead take no damage if you succeed on the saving throw and only half damage if you fail.\" Applied by the save-for-damage path, read off the target’s own features. It bites only where the effect already offers half on a success: Sacred Flame offers nothing, and Evasion says nothing about it. The Incapacitated clause is this feature’s own and is declared on it.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'evasion' }],
        // SRD Monk: "You can't use this feature if you have the Incapacitated
        // condition." The Rogue's Evasion says no such thing, which is why the
        // requirement is declared per feature rather than assumed.
        requires: [{ kind: 'not-incapacitated' }],
      },
    },
    {
      id: 'monk:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Monk levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as monk:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'monk:acrobatic-movement',
      name: 'Acrobatic Movement',
      level: 9,
      automation: 'manual',
      note: 'Moving along vertical surfaces and across liquids is not modelled; movement has one speed and no modes.',
    },
    {
      id: 'monk:heightened-focus',
      name: 'Heightened Focus',
      level: 10,
      automation: 'manual',
      note: 'Improved Flurry of Blows, Patient Defense and Step of the Wind, none of which is modelled.',
    },
    {
      id: 'monk:self-restoration',
      name: 'Self-Restoration',
      level: 10,
      automation: 'manual',
      note: 'Ending the Charmed, Frightened or Poisoned condition at the end of your turn is not applied; the turn boundary raises saves, not condition removals.',
    },
    {
      id: 'monk:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Monk levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as monk:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'monk:deflect-energy',
      name: 'Deflect Energy',
      level: 13,
      automation: 'engine',
      note: 'SRD: "You can now use your Deflect Attacks feature against attacks that deal any damage type, not just Bludgeoning, Piercing, or Slashing." It widens the list on Deflect Attacks rather than granting a second Reaction — two grants would offer a Monk 13 two answers to one blow.',
      grants: { kind: 'widens-reaction', feature: 'monk:deflect-attacks', damageTypes: 'any' },
    },
    {
      id: 'monk:disciplined-survivor',
      name: 'Disciplined Survivor',
      level: 14,
      automation: 'engine',
      note: 'SRD: "Your physical and mental discipline grant you proficiency in all saving throws." All six are unioned into the sheet. The second half — "whenever you make a saving throw and fail, you can expend 1 Focus Point to reroll it, and you must use the new roll" — is Indomitable’s shape exactly and would be data, but a feature carries one grant and this one already grants the proficiencies. Blocked on a feature granting two things at once, not on the reroll.',
      grants: { kind: 'save-proficiency', abilities: 'all' },
    },
    {
      id: 'monk:perfect-focus',
      name: 'Perfect Focus',
      level: 15,
      automation: 'manual',
      note: 'Regaining Focus Points on Initiative when low is not modelled.',
    },
    {
      id: 'monk:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Monk levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as monk:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'monk:superior-defense',
      name: 'Superior Defense',
      level: 18,
      automation: 'manual',
      note: 'Resistance to all damage but Force for a minute is not applied: defences are declared once and do not change.',
    },
    {
      id: 'monk:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Irresistible Offense is recommended." Executed: the choice is held to the Epic Boon category, this catalogue publishes the seven the SRD prints, and each opens with "Increase one ability score of your choice by 1, to a maximum of 30" — a grant creation reads, so the point lands on the score the player named and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'monk:body-and-mind',
      name: 'Body and Mind',
      level: 20,
      automation: 'engine',
      note: 'SRD: "Your Dexterity and Wisdom scores increase by 4, to a maximum of 25." Both halves are applied: the four points land on each of the two scores, and 25 is the ceiling for those two and for no others — a Monk’s Strength still stops at 20.',
      grants: {
        kind: 'ability-score-increase',
        raises: [
          { ability: 'dex', points: 4 },
          { ability: 'wis', points: 4 },
        ],
        maximum: 25,
      },
    },
  ],
};

/** SRD "Monk Subclass: Warrior of the Open Hand" — the one the SRD publishes. */
export const WARRIOR_OF_THE_OPEN_HAND: SubclassDefinition = {
  id: 'warrior-of-the-open-hand',
  name: 'Warrior of the Open Hand',
  classId: 'monk',
  features: [
    {
      id: 'open-hand:technique',
      name: 'Open Hand Technique',
      level: 3,
      automation: 'manual',
      note: 'Addle, Push and Topple on a Flurry of Blows hit are not modelled, because Flurry of Blows is not.',
    },
    {
      id: 'open-hand:wholeness-of-body',
      name: 'Wholeness of Body',
      level: 6,
      automation: 'engine',
      note: 'Its uses are a pool sized by the Wisdom modifier with the SRD’s floor of one, refilling on a Long Rest. Spending one rolls the Martial Arts die at that Monk’s level and heals — SRD: "roll your Martial Arts die. You regain a number of Hit Points equal to the number rolled plus your Wisdom modifier (minimum of 1 Hit Point regained)."',
      grants: {
        kind: 'pool',
        key: 'wholeness-of-body',
        label: 'Wholeness of Body',
        // SRD: "a number of times equal to your Wisdom modifier (minimum of once)."
        fromAbilityModifier: 'wis',
        minimum: 1,
        recovers: 'long-rest',
        heals: {
          action: 'bonus-action',
          diceByLevel: MARTIAL_ARTS_DIE,
          plus: 'wis',
          // SRD: "(minimum of 1 Hit Point regained)".
          minimum: 1,
        },
      },
    },
    {
      id: 'open-hand:fleet-step',
      name: 'Fleet Step',
      level: 11,
      automation: 'manual',
      note: 'A free Step of the Wind alongside another Bonus Action is not modelled.',
    },
    {
      id: 'open-hand:quivering-palm',
      name: 'Quivering Palm',
      level: 17,
      automation: 'manual',
      note: 'The delayed lethal vibrations are not modelled: an effect that waits days for a trigger has no home in the duration system, which measures elapsed time and turn boundaries.',
    },
  ],
};

export const MONK_SUBCLASSES: readonly SubclassDefinition[] = [WARRIOR_OF_THE_OPEN_HAND];
