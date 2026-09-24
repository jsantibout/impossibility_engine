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

/**
 * SRD Martial Arts: "your Unarmed Strike and Monk weapons, which are the
 * following: Simple Melee weapons; Martial Melee weapons that have the Light
 * property."
 *
 * A constant because the book's phrase "a Monk weapon" is printed on two
 * features — Martial Arts defines it and Stunning Strike rides on it — and two
 * copies of one list is a second source for one fact, agreeing today and held
 * in step by nothing.
 */
const MONK_WEAPONS = [
  { category: 'simple', kind: 'melee' },
  { category: 'martial', kind: 'melee', properties: ['light'] },
] as const;

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
      automation: 'engine',
      note: 'SRD: "You gain the following benefits while you are unarmed or wielding only Monk weapons and you aren’t wearing armor or wielding a Shield." Three italicised clauses under one gate, so one grant carries all three: the Bonus Unarmed Strike, the Martial Arts die "in place of the normal damage", and Dexterous Attacks\' "you **can** use your Dexterity modifier instead of your Strength modifier" — an offer the character takes or declines, which is Finesse\'s reading of the same sentence. Monk weapons are declared here rather than on `weaponProficiencies` because the SRD prints two different sets: the Core Monk Traits table says "Simple weapons and Martial weapons that have the Light property", and this feature says the **Melee** halves of the same two lines. A Monk is proficient with a Light Crossbow and it is not a Monk weapon. What the grant does not carry is the Grapple and Shove half of Dexterous Attacks. The two options themselves are modelled now — `grappleTarget` and `shoveTarget` — and each fixes its save DC at \"8 plus your **Strength** modifier and Proficiency Bonus\", which is the sentence the book prints on the Unarmed Strike. Substituting Dexterity into that DC is this feature\'s own clause, and the engine has nowhere to read an entitlement to it: the command takes no striking ability at all, because one that did would take the caller’s word for a benefit only a Monk has.',
      grants: {
        kind: 'strike-style',
        // SRD: "your Unarmed Strike and Monk weapons, which are the following:
        // Simple Melee weapons; Martial Melee weapons that have the Light
        // property." The Unarmed Strike is every style's by construction, so
        // what is listed is the two bullets and nothing else.
        weapons: MONK_WEAPONS,
        // The table's own column, exactly as Monk's Focus reads `FOCUS_POINTS`
        // and Unarmoured Movement reads its feet. Retyping the twenty rows
        // would be a second source for one fact.
        dieByLevel: MARTIAL_ARTS_DIE,
        ability: 'dex',
        bonusUnarmedStrike: true,
        whileWieldingOnly: true,
        requires: [{ kind: 'unarmored' }],
      },
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
      note: 'Declared as a pool of Focus Points sized by the class table, refilling on a **Short** Rest — SRD: "unavailable until you finish a Short or Long Rest, at the end of which you regain all your expended points", which is all-or-nothing and needs nothing the pool system lacks. All three things the points buy are executed. Flurry of Blows is "expend 1 Focus Point to make two Unarmed Strikes as a Bonus Action" — a Bonus Action and a point buy two attacks that no weapon may take and that cost no Attack action. Patient Defense and Step of the Wind are four allowances beside the pool, because each prints two sentences: the free half moves one action to the Bonus Action, and the priced half spends a point and buys **two** actions with one spend, the second of which is handed to the turn and taken for nothing. One clause is still the table’s and it is Step of the Wind’s "your jump distance is doubled for the turn": a jump-bonus grant adds a modifier’s worth of feet to a Long Jump rather than doubling one, and nothing hangs a standing grant on a turn.',
      grants: [
        {
          kind: 'pool',
          key: 'focus-points',
          label: 'Focus Points',
          usesByLevel: FOCUS_POINTS,
          recovers: 'short-rest',
          buysBudget: [
            {
              id: 'flurry-of-blows',
              name: 'Flurry of Blows',
              // "as a Bonus Action", which is the whole of what it costs beside
              // the point itself.
              action: 'bonus-action',
              // "two Unarmed Strikes" — two, and no weapon takes one of them.
              extraAttacks: { count: 2, unarmedOnly: true },
            },
          ],
        },
        {
          kind: 'standing',
          reach: 'self',
          effects: [
            // SRD Patient Defense: "You can take the Disengage action as a
            // Bonus Action." The free half, which costs no point — and is
            // what `allowsPrice` takes when nobody asks for the other.
            {
              kind: 'action-rule',
              rule: { kind: 'allows', action: 'disengage', from: 'bonus-action' },
            },
            // "Alternatively, you can expend 1 Focus Point to take both the
            // Disengage and the Dodge actions as a Bonus Action."
            {
              kind: 'action-rule',
              rule: { kind: 'allows', actions: ['disengage', 'dodge'], from: 'bonus-action' },
              spends: 'focus-points',
            },
            // SRD Step of the Wind: "You can take the Dash action as a Bonus
            // Action."
            {
              kind: 'action-rule',
              rule: { kind: 'allows', action: 'dash', from: 'bonus-action' },
            },
            // "Alternatively, you can expend 1 Focus Point to take both the
            // Disengage and Dash actions as a Bonus Action." The jump doubling
            // in the same sentence is the note's, and the table's.
            {
              kind: 'action-rule',
              rule: { kind: 'allows', actions: ['dash', 'disengage'], from: 'bonus-action' },
              spends: 'focus-points',
            },
          ],
        },
      ],
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
      automation: 'engine',
      note: 'Executed. SRD: "When you fall, you can take a Reaction to reduce any damage you take from the fall by an amount equal to five times your Monk level." A fall the table lands (`resolve_fall`) names this feature to elect it; the engine takes five times the Monk level off the landing’s dice before the Monk’s own defences meet them, and spends the Reaction where a fight is running.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'fall-damage-reduction', perClassLevel: 5 }],
      },
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
      automation: 'engine',
      note: 'SRD: "Once per turn when you hit a creature with a Monk weapon or an Unarmed Strike, you can expend 1 Focus Point to attempt a stunning strike. The target must make a Constitution saving throw. On a failed save, the target has the Stunned condition until the start of your next turn." Executed as a rider the swing elects: the weapons are Martial Arts’ own list and the Unarmed Strike beside it, the point comes out of Monk’s Focus, the allowance is once a turn, the DC is the one Monk’s Focus prints — "8 plus your Wisdom modifier and Proficiency Bonus", which is this class’s own rather than a spell save DC a Monk has none of — and the Stunned condition ends at the start of the Monk’s next turn. The second sentence is not applied: "On a successful save, the target’s Speed is halved until the start of your next turn, and the next attack roll made against the target before then has Advantage" is a Speed reduction, which the Speed grant leaves to the condition layer, and a one-shot mode a feature has no door to hang; a save that succeeds costs the point and does nothing else.',
      grants: {
        kind: 'on-hit',
        // "expend 1 Focus Point" — Monk's Focus declares the pool and this
        // spends it, which is why the cost names a pool it does not own.
        pool: 'focus-points',
        costs: 1,
        oncePerTurn: true,
        // "with a Monk weapon or an Unarmed Strike": two clauses, because an
        // Unarmed Strike is not a weapon and is in no set of them.
        weapons: MONK_WEAPONS,
        unarmedStrike: true,
        // SRD Monk's Focus: "Some features that use Focus Points require your
        // target to make a saving throw. The save DC equals 8 plus your Wisdom
        // modifier and Proficiency Bonus."
        saveAbility: 'wis',
        options: [
          {
            id: 'stun',
            name: 'Stunning Strike',
            effects: [{ kind: 'save', ability: 'con', condition: 'stunned' }],
            lasts: 'start-of-next-turn',
          },
        ],
      },
    },
    {
      id: 'monk:empowered-strikes',
      name: 'Empowered Strikes',
      level: 6,
      automation: 'manual',
      note: 'SRD: "Whenever you deal damage with your Unarmed Strike, it can deal your choice of Force damage or its normal damage type." The choice is not applied: Martial Arts\' style carries no damage type for a second feature to change, so which die is thrown and which ability is added are the class\'s and the type the die deals is still the weapon\'s own.',
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
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Irresistible Offense is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
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
      note: 'Not applied, and the trigger is no longer the reason: a feature’s effect list can be bought by a hit now, which is how Stunning Strike rides on one. What blocks this one is the hit it names — SRD says "whenever you hit a creature with an attack granted by your Flurry of Blows", and Flurry of Blows is not modelled, so nothing can tell a swing that came out of one from any other punch. Of the three effects, Topple is a Dexterity save with Prone on a failure and would be data; Push moves the target fifteen feet, which no feature reaches; and Addle stops its Opportunity Attacks until the start of its next turn, which is the action economy answering to somebody else.',
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
