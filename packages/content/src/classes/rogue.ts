import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

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
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    skills: { choose: 1 },
    tools: ["Thieves' Tools"],
  },
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
      note: 'The dice are read off the Rogue table at the character’s Rogue level and added to a qualifying hit, once per turn — *a* turn, so an Opportunity Attack on somebody else’s turn qualifies again. The qualifications are checked: Advantage on the roll, or a non-Incapacitated ally within 5 feet of the target and no Disadvantage, and a Finesse or Ranged weapon either way. The damage is of the weapon’s own type, so Resistance to the weapon resists it too, and a critical doubles the dice. What the engine cannot settle is the ally clause where nobody has declared who is on whose side: it withholds the benefit and says so rather than inventing an ally. Cunning Strike’s trade of these dice for effects is a separate feature and spends them through this one: the dice it forgoes come off here, before the roll.',
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
      automation: 'engine',
      note: 'SRD: "Your training with weapons allows you to use the mastery properties of two kinds of weapons of your choice with which you have proficiency, such as Daggers and Shortbows." A flat two rather than a column, and the proficiency clause the Barbarian and the Fighter leave implicit. Executed: the weapons chosen are recorded on the sheet, and the properties that follow from the record run on the attack — Graze\'s damage on a miss, Cleave\'s second swing, Push\'s forced move, Slow\'s ten feet, Topple\'s Constitution save, and Sap and Vex, which the SRD writes as things that simply happen rather than things you can do. Two clauses are still the table\'s: Nick redirects the extra attack the Light property gives, and nothing pays for one; and changing a choice on a Long Rest is an option re-answered, which a choice frozen at creation is not.',
      grants: { kind: 'weapon-mastery' },
      choice: { kind: 'weapon', choose: 2 },
    },
    {
      id: 'rogue:cunning-action',
      name: 'Cunning Action',
      level: 2,
      automation: 'engine',
      note: 'SRD: "you can take one of the following actions as a Bonus Action: Dash, Disengage, or Hide." Executed, as three action rules the feature holds: the Rogue may state the cheaper price on `takeDash`, `takeDisengage` and `takeHide`, and each command charges the Bonus Action rather than the Action. The rules are derived from the sheet on every read rather than stored on the creature, so a Rogue written into a log before any of this existed holds them too. What the feature says about "the number of times shown" is nothing — this one is free and unlimited — and Cunning Strike, which spends Sneak Attack dice on effects, is a separate feature and separately executed.',
      grants: {
        kind: 'standing',
        reach: 'self',
        // SRD: "Dash, Disengage, or Hide" — three clauses of one sentence, so
        // three rules under one feature. `allows` is the member, and it is the
        // same one SRD Conjure Woodland Beings writes from the spell side.
        effects: [
          { kind: 'action-rule', rule: { kind: 'allows', action: 'dash', from: 'bonus-action' } },
          {
            kind: 'action-rule',
            rule: { kind: 'allows', action: 'disengage', from: 'bonus-action' },
          },
          { kind: 'action-rule', rule: { kind: 'allows', action: 'hide', from: 'bonus-action' } },
        ],
      },
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
      automation: 'engine',
      note: 'SRD: "As a Bonus Action, you give yourself Advantage on your next attack roll on the current turn. You can use this feature only if you haven’t moved during this turn, and after you use it, your Speed is 0 until the end of the current turn." Executed, and every clause of it is a grant a use hangs rather than a benefit running the feature derives: the Bonus Action is spent, the Advantage is a one-shot roll modifier the next attack roll uses up, the Speed of 0 is a granted Speed, and both of them end at the end of the current turn whether or not anything spent them. The gate is `onlyIfUnmoved`, read off the feet the turn budget stored. The two clauses carry two sources because everything one source granted ends together — sharing one would hand the Speed back to the swing that spent the Advantage.',
      grants: {
        kind: 'activated',
        action: 'bonus-action',
        // No pool: the SRD prints no limit on the uses, only on when one may
        // be taken. The limit is the Bonus Action and the gate below it.
        pool: null,
        // The record of the use, which the holder is done with when their next
        // turn begins; what the use *did* ends sooner and says so itself.
        lasts: 'start-of-next-turn',
        onlyIfUnmoved: true,
        hangs: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'attack', relation: 'roller' },
              // "your next attack roll" — the roll spends it.
              oneShot: true,
            },
            // "on the current turn".
            lasts: 'end-of-current-turn',
          },
          // "after you use it, your Speed is 0 until the end of the current
          // turn" — the price, which no attack spends.
          { kind: 'speed', change: 'zero', lasts: 'end-of-current-turn' },
        ],
      },
    },
    {
      id: 'rogue:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Rogue levels 8, 10, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'rogue:cunning-strike',
      name: 'Cunning Strike',
      level: 5,
      automation: 'engine',
      note: 'SRD: "When you deal Sneak Attack damage, you can add one of the following Cunning Strike effects. Each effect has a die cost, which is the number of Sneak Attack damage dice you must forgo to add the effect. You remove the die before rolling." Executed as a rider on the hit, with the price in the one currency no rider could name before: Sneak Attack’s own dice. The swing names the feature and the option; the damage gather removes the dice before rolling, so a Rogue 5 who adds an effect rolls 2d6 instead of 3d6; and the effect happens once the damage is dealt. A blow that turns out not to be a Sneak Attack — no Advantage, no ally beside the target, the allowance already spent this turn — pays for nothing, so the rider is dropped unspent and said out loud rather than refused after the die. The DC is the feature’s own, "8 plus your Dexterity modifier and Proficiency Bonus". Poison forces a Constitution save, leaves a failure Poisoned for a minute and lets the target repeat the save at the end of each of its turns, and is refused without a Poisoner’s Kit on the Rogue’s person; Trip is a Dexterity save and the Prone condition, gated on a Large or smaller target, which the other two are not; Withdraw hands the turn half the Rogue’s Speed as feet spent out of no Speed at all, which provoke nobody. "One of the following" is the request’s own shape — a swing names one option — and a second Cunning Strike on the same turn has nothing to pay with, because Sneak Attack is once per turn.',
      grants: {
        kind: 'on-hit',
        // "the number of Sneak Attack damage dice you must forgo" — a sibling
        // feature's dice, named the way Stunning Strike names a sibling
        // feature's pool.
        forgoesDiceOf: 'rogue:sneak-attack',
        // "If a Cunning Strike effect requires a saving throw, the DC equals 8
        // plus your Dexterity modifier and Proficiency Bonus." A Rogue casts
        // nothing, so the feature prints its own.
        saveAbility: 'dex',
        options: [
          {
            id: 'poison',
            name: 'Poison',
            // "(Cost: 1d6)"
            costsDice: 1,
            // "To use this effect, you must have a Poisoner's Kit on your
            // person."
            requiresItem: 'poisoners-kit',
            // "forcing the target to make a Constitution saving throw. On a
            // failed save, the target has the Poisoned condition for 1 minute.
            // At the end of each of its turns, the Poisoned target repeats the
            // save, ending the effect on itself on a success."
            effects: [
              {
                kind: 'save',
                ability: 'con',
                condition: 'poisoned',
                repeats: { at: 'end-of-turn', onSuccess: 'end-on-target' },
              },
            ],
            durationSeconds: 60,
          },
          {
            id: 'trip',
            name: 'Trip',
            costsDice: 1,
            // "If the target is Large or smaller" — printed on this effect and
            // on neither of the others, so it is the option's gate rather than
            // the feature's.
            targetNoLargerThan: 'large',
            // "it must succeed on a Dexterity saving throw or have the Prone
            // condition." Prone ends when the creature stands up, so there is
            // no span on it.
            effects: [{ kind: 'save', ability: 'dex', condition: 'prone' }],
          },
          {
            id: 'withdraw',
            name: 'Withdraw',
            costsDice: 1,
            // "Immediately after the attack, you move up to half your Speed
            // without provoking Opportunity Attacks." The move is the whole of
            // what the option buys, so there is no effect list at all.
            effects: [],
            handsMove: { share: 'half-speed' },
          },
        ],
      },
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
      id: 'rogue:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Rogue levels 8, 10, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as rogue:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'rogue:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 10,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Rogue levels 8, 10, 12, and 16." The third of them, at level 10. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as rogue:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'rogue:improved-cunning-strike',
      name: 'Improved Cunning Strike',
      level: 11,
      automation: 'manual',
      note: 'Not applied. Using two Cunning Strike options on one hit is this feature rewriting the level 5 one, and that rewriting is the whole of what is missing: paying for an effect in Sneak Attack dice is a trade the level 5 feature now makes, and each option forces a save, imposes a condition or moves its user through the same grant. What no vocabulary says is a later feature raising an earlier one’s limit from one option to two.',
    },
    {
      id: 'rogue:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Rogue levels 8, 10, 12, and 16." The fourth of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as rogue:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'rogue:devious-strikes',
      name: 'Devious Strikes',
      level: 14,
      automation: 'manual',
      note: 'Not applied. Three more Cunning Strike options, which is this feature lengthening the level 5 feature’s list, and that lengthening is what has no member: each is bought with Sneak Attack dice at a price the grant already carries, each forces a Constitution or Dexterity saving throw, and Knock Out and Obscure hang the Unconscious and Blinded conditions on the target — all of which Cunning Strike’s own options do. Daze forbids all but one of its actions on its next turn, which is a count rather than a list and has no member either.',
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
      id: 'rogue:ability-score-improvement-5',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Rogue levels 8, 10, 12, and 16." The fifth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as rogue:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
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
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of the Night Spirit is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
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
      automation: 'engine',
      note: 'SRD: "you can use the Utilize action as a Bonus Action." Executed, as the action rule the feature holds: `takeUtilize` charges an Action or, where something has allowed it, a Bonus Action, and this is what allows it — the same `allows` member Cunning Action writes three of beside it. The spend it is offered on did not exist when this feature was first read, which is why the note used to say there was nothing to offer. What is **not** executed and is not a rule anything could hold: the sentence’s other two clauses, "you can also use that Bonus Action to make a Sleight of Hand check" and "to use Thieves’ Tools", are ability checks rather than actions, and a Bonus Action spent on a check has nothing to name itself as — an `ability_check` a DM calls for spends no slot at all. A Thief takes the Bonus Action through a Utilize and the table narrates the pick or the pocket.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'action-rule',
            rule: { kind: 'allows', action: 'utilize', from: 'bonus-action' },
          },
        ],
      },
    },
    {
      id: 'thief:second-story-work',
      name: 'Second-Story Work',
      level: 3,
      automation: 'engine',
      note: 'Executed. SRD: "You gain a Climb Speed equal to your Speed" — the same sentence Spider Climb prints, spelled the same way, so a Thief climbs at full Speed and pays no surcharge for it — and "when you make a running jump, the distance you cover increases by a number of feet equal to your Dexterity modifier", read where a running Long Jump’s reach is measured, off the Dexterity score as it stands.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          { kind: 'speed', change: 'match-walk', mode: 'climb' },
          { kind: 'jump-bonus', fromAbility: 'dex' },
        ],
      },
    },
    {
      id: 'thief:supreme-sneak',
      name: 'Supreme Sneak',
      level: 9,
      automation: 'manual',
      note: 'Not applied. SRD gives one more Cunning Strike option — "_Stealth Attack (Cost: 1d6)._ If you have the Hide action’s Invisible condition, this attack doesn’t end that condition on you if you end the turn behind Three-Quarters Cover or Total Cover" — which is this feature lengthening the level 5 feature’s list. It would want the same trade of Sneak Attack dice every Cunning Strike option needs, and that price is written now; what has no member is a later feature adding an option to an earlier one’s hit-rider menu, which a pool’s menu allows and a rider’s does not. The Hide itself is taken now, and the exception has nothing to except: the engine ends that condition on no attack at all, because the four things the SRD says end a Hide are moments the table narrates.',
    },
    {
      id: 'thief:use-magic-device',
      name: 'Use Magic Device',
      level: 13,
      automation: 'manual',
      note: 'Magic items are modelled now, and none of the three benefits reaches one. The attunement cap is a constant every creature shares and no feature raises it. The refund — SRD, "Whenever you use a magic item property that expends charges, roll 1d6. On a roll of 6, you use the property without expending the charges" — is a die the engine can throw that nothing asks it to. And the Spell Scroll benefit is waiting on two different things: the catalogue holds no Spell Scroll record, which is the item map’s entry rather than this feature’s, and what the feature would add to one is a casting made with the Thief’s Intelligence rather than the item’s or the wielder’s, gated behind an Intelligence (Arcana) check.',
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
