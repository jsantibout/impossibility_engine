import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';
import { FIGHTING_STYLE_FEATS } from '../origins.js';

/**
 * The Paladin, transcribed from SRD 5.2.1 "Classes".
 *
 * The fifth class, and the first **half-caster**: its slot table tops out at
 * level 5 rather than level 9, and it gains slots at half the rate a Wizard
 * does. That is the whole of what "half-caster" means mechanically, and it
 * needed no new machinery at all — the table already held slots per level, and
 * a shorter row is a shorter row.
 *
 * It is also the first caster with **no cantrips**. SRD's Paladin Features
 * table has a Prepared Spells column and no Cantrips column, so `cantripsKnown`
 * is absent rather than zero, and a Paladin who writes one down is refused.
 * Absent-versus-zero has now earned its keep twice: once for a class that
 * casts nothing, and once for a caster that casts no cantrips.
 *
 * **2024 moved Paladin spellcasting to level 1.** The 2014 Paladin cast from
 * level 2, and that is the version most tables remember; the SRD 5.2.1 table
 * prints two prepared spells and two level 1 slots at level 1. Worth stating
 * because `spellcasting.startsAtLevel` exists to record exactly this, and the
 * answer here is 1.
 */

/** Paladin Features table: level, PB, Channel Divinity, prepared, slots 1-5. */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 0, 2, 2],
  [2, 2, 0, 3, 2],
  [3, 2, 2, 4, 3],
  [4, 2, 2, 5, 3],
  [5, 3, 2, 6, 4, 2],
  [6, 3, 2, 6, 4, 2],
  [7, 3, 2, 7, 4, 3],
  [8, 3, 2, 7, 4, 3],
  [9, 4, 2, 9, 4, 3, 2],
  [10, 4, 2, 9, 4, 3, 2],
  [11, 4, 3, 10, 4, 3, 3],
  [12, 4, 3, 10, 4, 3, 3],
  [13, 5, 3, 11, 4, 3, 3, 1],
  [14, 5, 3, 11, 4, 3, 3, 1],
  [15, 5, 3, 12, 4, 3, 3, 2],
  [16, 5, 3, 12, 4, 3, 3, 2],
  [17, 6, 3, 14, 4, 3, 3, 3, 1],
  [18, 6, 3, 14, 4, 3, 3, 3, 1],
  [19, 6, 3, 15, 4, 3, 3, 3, 2],
  [20, 6, 3, 15, 4, 3, 3, 3, 2],
];

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  // No cantrips column: a Paladin has none, which is not the same as zero.
  preparedSpells: row[3] ?? 0,
  spellSlots: row.slice(4),
}));

/** SRD Channel Divinity uses, by level. Two from level 3, three from 11. */
export const PALADIN_CHANNEL_DIVINITY: readonly number[] = TABLE.map((row) => row[2] ?? 0);

const FIGHTING_STYLE_IDS = FIGHTING_STYLE_FEATS.map((feat) => feat.id);

export const PALADIN: ClassDefinition = {
  id: 'paladin',
  name: 'Paladin',
  // SRD prints "Strength and Charisma". The engine takes one, and spells run
  // off Charisma, so `spellcasting.ability` is the field that matters here.
  primaryAbility: 'str',
  spellcasting: { ability: 'cha', style: 'prepared-from-list', progression: 'half', startsAtLevel: 1 },
  hitDie: 10,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: ['martial'],
    armorTraining: { light: true, medium: true, heavy: false, shields: true },
    tools: [],
  },
  saveProficiencies: ['wis', 'cha'],
  skillChoices: {
    choose: 2,
    from: ['athletics', 'insight', 'intimidation', 'medicine', 'persuasion', 'religion'],
  },
  weaponProficiencies: ['simple', 'martial'],
  armorTraining: { light: true, medium: true, heavy: true, shields: true },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'chain-mail', quantity: 1 },
        { id: 'shield', quantity: 1 },
        { id: 'longsword', quantity: 1 },
        { id: 'javelin', quantity: 6 },
        { id: 'holy-symbol', quantity: 1 },
        { id: 'priests-pack', quantity: 1 },
      ],
      goldPieces: 9,
    },
    { option: 'B', items: [], goldPieces: 150 },
  ],
  features: [
    {
      id: 'paladin:lay-on-hands',
      name: 'Lay On Hands',
      level: 1,
      automation: 'engine',
      note: 'Declared as a pool of five hit points per Paladin level, refilling on a Long Rest — SRD: "a total number of Hit Points equal to five times your Paladin level". A pool of hit points rather than of uses, which the pool system carries without caring. Spending it is the engine’s too: a Bonus Action, a touch within five feet, hit points restored one for one, and five more to end the Poisoned condition — "those points don’t also restore Hit Points to the creature".',
      grants: {
        kind: 'pool',
        key: 'lay-on-hands',
        label: 'Lay On Hands',
        perClassLevel: 5,
        recovers: 'long-rest',
        // SRD: "As a Bonus Action, you can touch a creature (which could be
        // yourself)... You can also expend 5 Hit Points ... to remove the
        // Poisoned condition."
        touchHeals: { action: 'bonus-action', lifts: ['poisoned'], costPerCondition: 5 },
      },
    },
    {
      id: 'paladin:spellcasting',
      name: 'Spellcasting',
      level: 1,
      automation: 'engine',
      note: 'Slots and prepared spells are tracked, prepared from the Paladin list. Half-caster slots top out at level 5, which is what the class table says and all it takes.',
    },
    {
      id: 'paladin:weapon-mastery',
      name: 'Weapon Mastery',
      level: 1,
      automation: 'manual',
      note: 'Mastery properties are parsed onto weapons but not executed, and which two a Paladin has mastery with is recorded nowhere yet.',
    },
    {
      id: 'paladin:fighting-style',
      name: 'Fighting Style',
      level: 2,
      automation: 'manual',
      note: 'The chosen Fighting Style feat is recorded and validated against the SRD list, and applied no more than a Fighter’s: each is a modifier the caller passes to a roll.',
      choice: { kind: 'feat', choose: 1, category: 'fighting-style' },
    },
    {
      id: 'paladin:smite',
      name: "Paladin's Smite",
      level: 2,
      automation: 'manual',
      note: 'Half of it is applied, which is why this is not marked as executed. SRD: "You always have the _Divine Smite_ spell prepared" — a fixed spells grant, the move Favored Enemy already makes with Hunter’s Mark, so the spell is on the sheet without being one of the prepared spells the class table counts. The rest is not: "you can cast it without expending a spell slot, but you must finish a Long Rest before you can cast it in this way again" needs a pool a casting can be paid out of, and a feature carries one grant; and casting it as a Bonus Action after a hit needs a reaction-shaped trigger the engine does not have.',
      grants: { kind: 'spells', fixed: ['divine-smite'] },
    },
    {
      id: 'paladin:channel-divinity',
      name: 'Channel Divinity',
      level: 3,
      automation: 'engine',
      note: 'Declared as a pool sized by the Channel Divinity column, refilling on a Long Rest. A Short Rest gives back one use, which is applied without emptying the pool. What each use buys is not executed.',
      grants: {
        kind: 'pool',
        key: 'channel-divinity',
        label: 'Channel Divinity',
        usesByLevel: PALADIN_CHANNEL_DIVINITY,
        recovers: 'long-rest',
        // SRD: "You regain one expended use when you finish a Short Rest."
        regainsOnShortRest: 1,
      },
    },
    {
      id: 'paladin:subclass',
      name: 'Paladin Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'paladin:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "increase one ability score of your choice by 2, or increase two ability scores of your choice by 1 each", or take a feat instead. Both halves reach the sheet: the points land on the scores the player named and stop at 20 unless a later feature has lifted that score’s own ceiling, and a feat is recorded and read exactly as it always was. Whether a feat does anything is a property of the feat, not of this feature — Alert’s Initiative Proficiency, Magic Initiate’s spells and free daily casting, and Skilled’s three proficiencies all reach the sheet, while Savage Attacker’s reroll does not. What is still short of the book is the **repeats**: the class table says "You gain this feature again" at later levels and this catalogue holds one entry for it, so a character past level 4 is offered the choice once.',
      choice: { kind: 'ability-score', spreads: [[2], [1, 1]], orFeat: {} },
    },
    {
      id: 'paladin:extra-attack',
      name: 'Extra Attack',
      level: 5,
      automation: 'engine',
      note: 'SRD: "You can attack twice instead of once whenever you take the Attack action." The Attack action holds two attacks now rather than costing an action each.',
      grants: { kind: 'extra-attack', attacks: 2 },
    },
    {
      id: 'paladin:faithful-steed',
      name: 'Faithful Steed',
      level: 5,
      automation: 'manual',
      note: 'Find Steed always prepared, and the free casting per Long Rest, are not modelled; summons are a shape the engine does not have.',
    },
    {
      id: 'paladin:aura-of-protection',
      name: 'Aura of Protection',
      level: 6,
      automation: 'engine',
      note: 'SRD: "You radiate a protective, unseeable aura in a 10-foot Emanation that originates from you. The aura is inactive while you have the Incapacitated condition. You and your allies in the aura gain a bonus to saving throws equal to your Charisma modifier (minimum bonus of +1)." Two Paladins do not stack: the better aura applies, which is the choice the SRD gives the creature.',
      grants: {
        kind: 'standing',
        reach: 'aura',
        auraFeet: 10,
        effects: [{ kind: 'save-bonus', fromAbility: 'cha', minimum: 1 }],
        requires: [{ kind: 'not-incapacitated' }],
      },
    },
    {
      id: 'paladin:abjure-foes',
      name: 'Abjure Foes',
      level: 9,
      automation: 'manual',
      note: 'Not executed. Every part of it is a thing a feature cannot do: SRD asks each target to "succeed on a Wisdom saving throw", a failure hangs the Frightened condition on them for a minute, and while Frightened in this way a target "can do only one of the following on its turns: move, take an action, or take a Bonus Action", which is the action economy answering to somebody other than the engine.',
    },
    {
      id: 'paladin:aura-of-courage',
      name: 'Aura of Courage',
      level: 10,
      automation: 'engine',
      note: 'SRD: "You and your allies have Immunity to the Frightened condition while in your Aura of Protection. If a Frightened ally enters the aura, that condition has no effect on that ally while there." Suppression rather than removal: the condition stays on the creature and bites again the moment they leave.',
      grants: {
        kind: 'standing',
        reach: 'aura',
        effects: [{ kind: 'condition-immunity', condition: 'frightened' }],
        requires: [{ kind: 'not-incapacitated' }],
      },
    },
    {
      id: 'paladin:radiant-strikes',
      name: 'Radiant Strikes',
      level: 11,
      automation: 'engine',
      note: 'SRD: "When you hit a target with an attack roll using a Melee weapon or an Unarmed Strike, the target takes an extra 1d8 Radiant damage." Radiant rather than the weapon’s own type, so a target that resists the weapon does nothing to this.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          { kind: 'attack-damage', dice: '1d8', damageType: 'radiant', meleeOnly: true },
        ],
      },
    },
    {
      id: 'paladin:restoring-touch',
      name: 'Restoring Touch',
      level: 14,
      automation: 'engine',
      note: 'SRD: "When you use Lay On Hands on a creature, you can also remove one or more of the following conditions from the creature: Blinded, Charmed, Deafened, Frightened, Paralyzed, or Stunned. You must expend 5 Hit Points from the healing pool of Lay On Hands for each of these conditions you remove; those points don’t also restore Hit Points." It lengthens the list Lay On Hands carries and changes nothing else.',
      grants: {
        kind: 'lifts-conditions',
        pool: 'lay-on-hands',
        conditions: ['blinded', 'charmed', 'deafened', 'frightened', 'paralyzed', 'stunned'],
      },
    },
    {
      id: 'paladin:aura-expansion',
      name: 'Aura Expansion',
      level: 18,
      automation: 'engine',
      note: 'SRD: "Your Aura of Protection is now a 30-foot Emanation." It grants no benefit of its own; it resizes the one aura every other aura feature is spoken of as being inside.',
      grants: { kind: 'standing', reach: 'aura', auraFeet: 30 },
    },
    {
      id: 'paladin:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat or another feat of your choice for which you qualify", and every Epic Boon the book prints opens with one sentence — "Increase one ability score of your choice by 1, to a maximum of 30". That sentence is the boon half this feature offers: the point lands on the score the player named, and 30 becomes that score’s ceiling and no other score’s. The catalogue publishes no Epic Boon feat, so what a particular boon does beyond the increase is that boon’s own debt rather than this feature’s, which is the reading the Ability Score Improvement already takes of a feat; naming one instead is still offered and still held to the category.',
      choice: { kind: 'ability-score', spreads: [[1]], orFeat: { category: 'epic-boon' } },
      grants: { kind: 'ability-score-increase', maximum: 30 },
    },
  ],
};

/** SRD "Paladin Subclass: Oath of Devotion" — the subclass the SRD publishes. */
export const OATH_OF_DEVOTION: SubclassDefinition = {
  id: 'oath-of-devotion',
  name: 'Oath of Devotion',
  classId: 'paladin',
  features: [
    {
      id: 'oath-of-devotion:spells',
      name: 'Oath of Devotion Spells',
      level: 3,
      automation: 'engine',
      note: 'The level 3 spells are always prepared and do not count against the class table. The later grants at Paladin levels 5 and 9 are not automatic.',
      grants: {
        kind: 'spells',
        fixed: ['protection-from-evil-and-good', 'shield-of-faith'],
      },
    },
    {
      id: 'oath-of-devotion:sacred-weapon',
      name: 'Sacred Weapon',
      level: 3,
      automation: 'manual',
      note: 'The Charisma bonus to attack rolls and the emitted light are not applied; the attack bonus is one the caller passes in.',
    },
    {
      id: 'oath-of-devotion:aura-of-devotion',
      name: 'Aura of Devotion',
      level: 7,
      automation: 'engine',
      note: 'SRD: "You and your allies have Immunity to the Charmed condition while in your Aura of Protection." The same suppression as Aura of Courage, and inside the same aura — including after Aura Expansion widens it.',
      grants: {
        kind: 'standing',
        reach: 'aura',
        effects: [{ kind: 'condition-immunity', condition: 'charmed' }],
        requires: [{ kind: 'not-incapacitated' }],
      },
    },
    {
      id: 'oath-of-devotion:smite-of-protection',
      name: 'Smite of Protection',
      level: 15,
      automation: 'manual',
      note: 'Half cover from Divine Smite is not applied; cover is declared rather than derived, and nothing declares it from a spell.',
    },
    {
      id: 'oath-of-devotion:holy-nimbus',
      name: 'Holy Nimbus',
      level: 20,
      automation: 'manual',
      note: 'None of it is modelled. The bright light is fiction. The Radiant damage to enemies in the aura is damage a feature deals with no attack roll and no save. The Advantage on any saving throw a Fiend or an Undead forces is a mode selected by who is on the other end of the save, which no selector can name. And the ten minutes it runs for, and the level 5 slot that buys the use back, are each their own absence.',
    },
  ],
};

export const PALADIN_SUBCLASSES: readonly SubclassDefinition[] = [OATH_OF_DEVOTION];

/** Fighting Style ids a Paladin may take — the same four a Fighter may. */
export const PALADIN_FIGHTING_STYLES: readonly string[] = FIGHTING_STYLE_IDS;
