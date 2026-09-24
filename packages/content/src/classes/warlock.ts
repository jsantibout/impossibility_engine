import type { ClassDefinition, ClassLevelRow, SubclassDefinition } from '@ie/engine';

/**
 * The Warlock, transcribed from SRD 5.2.1 "Classes".
 *
 * The seventh class, and the only one whose spell slots work differently from
 * everybody else's. **Pact Magic** gives a Warlock very few slots, all at the
 * same level, and gives them back on a **Short Rest** — SRD: "You regain all
 * expended Pact Magic spell slots when you finish a Short or Long Rest."
 *
 * Two slots that come back every hour is a different resource from eight that
 * come back every day, and it is most of what makes a Warlock a Warlock. The
 * engine needed one new field for it: `spellcasting.feature`, which names Pact
 * Magic as the distinct SRD feature it is — its own pool, its own recovery, and
 * out of the Multiclass Spellcaster table. Everything
 * else fitted — the slot table already stores counts per spell level, and "two
 * level 3 slots and nothing below" is `[0, 0, 2]`, which is what the SRD's
 * two-column "Spell Slots / Slot Level" table means when written out.
 *
 * Mystic Arcanum is the other half of the Warlock's casting and is **not**
 * modelled: one free casting each of a level 6, 7, 8 and 9 spell, once per Long
 * Rest, which is four one-use pools attached to spells chosen at those levels.
 * That is a shape the engine does not have, and it says so rather than
 * pretending a Warlock has ninth-level slots.
 */

/**
 * Warlock Features table: level, PB, Invocations, cantrips, prepared, slots,
 * slot level.
 *
 * The last two columns are the unusual pair. Every other class prints a row of
 * counts across nine slot levels; a Warlock prints how many and at what level.
 */
const TABLE: readonly (readonly number[])[] = [
  [1, 2, 1, 2, 2, 1, 1],
  [2, 2, 3, 2, 3, 2, 1],
  [3, 2, 3, 2, 4, 2, 2],
  [4, 2, 3, 3, 5, 2, 2],
  [5, 3, 5, 3, 6, 2, 3],
  [6, 3, 5, 3, 7, 2, 3],
  [7, 3, 6, 3, 8, 2, 4],
  [8, 3, 6, 3, 9, 2, 4],
  [9, 4, 7, 3, 10, 2, 5],
  [10, 4, 7, 4, 10, 2, 5],
  [11, 4, 7, 4, 11, 3, 5],
  [12, 4, 8, 4, 11, 3, 5],
  [13, 5, 8, 4, 12, 3, 5],
  [14, 5, 8, 4, 12, 3, 5],
  [15, 5, 9, 4, 13, 3, 5],
  [16, 5, 9, 4, 13, 3, 5],
  [17, 6, 9, 4, 14, 4, 5],
  [18, 6, 10, 4, 14, 4, 5],
  [19, 6, 10, 4, 15, 4, 5],
  [20, 6, 10, 4, 15, 4, 5],
];

/**
 * "Two slots at level 3" written as the engine stores slots: `[0, 0, 2]`.
 *
 * Zeros below rather than a special case above. A Warlock genuinely has no
 * level 1 or 2 slots once they reach level 5 — their slots *become* level 3 —
 * and every reader of the slot table already handles a zero.
 */
const pactSlots = (count: number, level: number): readonly number[] => {
  const slots = Array.from({ length: level }, () => 0);
  slots[level - 1] = count;
  return slots;
};

const rows: readonly ClassLevelRow[] = TABLE.map((row) => ({
  level: row[0] ?? 0,
  proficiencyBonus: row[1] ?? 0,
  cantripsKnown: row[3] ?? 0,
  preparedSpells: row[4] ?? 0,
  spellSlots: pactSlots(row[5] ?? 0, row[6] ?? 1),
}));

/** SRD Eldritch Invocations known, by level. */
export const ELDRITCH_INVOCATIONS: readonly number[] = TABLE.map((row) => row[2] ?? 0);

export const WARLOCK: ClassDefinition = {
  id: 'warlock',
  name: 'Warlock',
  primaryAbility: 'cha',
  spellcasting: {
    ability: 'cha',
    style: 'known',
    startsAtLevel: 1,
    // The field this class exists to need.
    feature: 'pact-magic',
  },
  hitDie: 8,
  // SRD "As a Multiclass Character": what this class grants when it is not your first.
  multiclass: {
    weapons: [],
    armorTraining: { light: true, medium: false, heavy: false, shields: false },
    tools: [],
  },
  saveProficiencies: ['wis', 'cha'],
  skillChoices: {
    choose: 2,
    from: ['arcana', 'deception', 'history', 'intimidation', 'investigation', 'nature', 'religion'],
  },
  weaponProficiencies: ['simple'],
  armorTraining: { light: true, medium: false, heavy: false, shields: false },
  subclassLevel: 3,
  table: rows,
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'leather-armor', quantity: 1 },
        { id: 'sickle', quantity: 1 },
        { id: 'dagger', quantity: 2 },
        // SRD prints "Arcane Focus (orb)": the focus row varies in price, and
        // the orb is the variant this package names.
        { id: 'orb', quantity: 1, detail: 'Arcane Focus' },
        { id: 'book', quantity: 1, detail: 'occult lore' },
        { id: 'scholars-pack', quantity: 1 },
      ],
      goldPieces: 15,
    },
    { option: 'B', items: [], goldPieces: 100 },
  ],
  features: [
    {
      id: 'warlock:eldritch-invocations',
      name: 'Eldritch Invocations',
      level: 1,
      automation: 'engine',
      note: 'SRD: "You gain one invocation of your choice ... You gain more invocations at higher levels, as shown in the Invocations column of the Warlock Features table." The count is that column and every invocation offered is executed. Agonizing Blast adds Charisma to every damage roll of the one cantrip its holder named, Eldritch Spear lengthens that cantrip’s range by thirty feet for each Warlock level, and Repelling Blast shoves a Large or smaller creature ten feet straight away on every beam that hits it. Armor of Shadows, Ascendant Step, Fiendish Vigor, Mask of Many Faces, Master of Myriad Forms, Misty Visions and Otherworldly Leap each cast their spell for nothing as often as asked, and Fiendish Vigor takes the highest face of the die rather than rolling it. Devil’s Sight sees through Darkness magical and nonmagical to 120 feet, Eldritch Mind gives Advantage on the Constitution save that maintains Concentration, Gift of the Depths swims at its holder’s own Speed and casts Water Breathing once until a Long Rest, One with Shadows casts Invisibility for nothing while its caster stands in Dim Light or Darkness and is refused in Bright Light, Lessons of the First Ones grants the Origin feat its holder names, and Pact of the Tome prepares three cantrips and two Ritual-tagged level 1 spells from any class’s list, as Warlock spells. Pact of the Blade conjures the Simple or Martial Melee weapon its holder names, in a Bonus Action that runs to no deadline: until the bond ends they are proficient with that weapon, may use Charisma for its attack and damage rolls instead of Strength or Dexterity, and may make it deal Necrotic, Psychic or Radiant damage instead of its own; a second use of the Bonus Action ends the first bond and the weapon it conjured, and so does death. Pact of the Chain casts Find Familiar as a Magic action with no slot spent and adds the seven special forms the book prints to the ones the spell offers, and on the Attack action its holder may forgo one of their own attacks so the familiar strikes with its Reaction — which is the sentence that lets a familiar attack at all, since the spell itself forbids it. Each grant is gated on the invocation chosen, so a Warlock holds what they took and nothing else, a Prerequisite the book prints over an option is checked at creation, and the four the book prints as Repeatable may be taken more than once, each copy naming a different cantrip or feat and a copy that repeats an earlier answer refused. The invocations not offered are refused outright rather than handed over as options that do nothing: Gaze of Two Minds borrows the senses of a willing creature, which is a state nothing here has, and those whose Prerequisite is a Warlock level above 5 are out of this ledger’s reach. What the table keeps is named rather than left to be discovered. Pact of the Blade’s other half — "create a bond with a magic weapon you touch", and with it the two exclusions the same sentence prints — is not offered, because a weapon rider is keyed on a catalogue id, so two Warlocks with two Longswords cannot be told from two Warlocks with one; a conjuring is refused any item the catalogue marks as magical by what a magic item is made of — grants of its own, an attunement requirement or a charge pool — so the half that is not offered is not reachable through the half that is; the bond also ends if the weapon is more than five feet away for a minute, which is a distance measured over time and nothing here measures one. Pact of the Tome conjures a book at the end of a rest that disappears if you conjure another or if you die, and the book is a Spellcasting Focus, as a pact weapon is: the first is fiction and the second is the component rules, and this engine models neither. Gift of the Depths also says you can breathe underwater, and nothing here drowns anybody, so breathing underwater is left to the table. And "a Warlock cantrip that deals damage" is checked as a Warlock cantrip and not as one that deals damage, so a cantrip that deals none simply reaches nothing.',
      choices: [
        // "as shown in the Invocations column of the Warlock Features table" —
        // the column itself, the way Weapon Mastery reads the Fighter's.
        {
          kind: 'option',
          chooseByLevel: ELDRITCH_INVOCATIONS,
          from: [
            'Agonizing Blast',
            'Armor of Shadows',
            'Ascendant Step',
            "Devil's Sight",
            'Eldritch Mind',
            'Eldritch Spear',
            'Fiendish Vigor',
            'Gift of the Depths',
            'Lessons of the First Ones',
            'Mask of Many Faces',
            'Master of Myriad Forms',
            'Misty Visions',
            'One with Shadows',
            'Otherworldly Leap',
            'Pact of the Blade',
            'Pact of the Chain',
            'Pact of the Tome',
            'Repelling Blast',
          ],
          // "You can't pick the same invocation more than once unless its
          // description says otherwise." Four descriptions say otherwise, each
          // in the same words: "You can gain this invocation more than once.
          // Each time you do so, choose a different qualifying cantrip" — or,
          // for Lessons of the First Ones, a different feat.
          repeatable: [
            'Agonizing Blast',
            'Eldritch Spear',
            'Lessons of the First Ones',
            'Repelling Blast',
          ],
          // "If an invocation has a prerequisite, you must meet it to learn
          // that invocation." Every line the SRD prints over an offered
          // invocation, and no line it does not.
          prerequisites: [
            { option: 'Agonizing Blast', level: 2 },
            { option: 'Ascendant Step', level: 5 },
            { option: "Devil's Sight", level: 2 },
            { option: 'Eldritch Spear', level: 2 },
            { option: 'Fiendish Vigor', level: 2 },
            { option: 'Gift of the Depths', level: 5 },
            { option: 'One with Shadows', level: 5 },
            { option: 'Lessons of the First Ones', level: 2 },
            { option: 'Mask of Many Faces', level: 2 },
            { option: 'Master of Myriad Forms', level: 5 },
            { option: 'Misty Visions', level: 2 },
            { option: 'Otherworldly Leap', level: 2 },
            { option: 'Repelling Blast', level: 2 },
          ],
        },
        // "Choose one of your known Warlock cantrips that deals damage" — the
        // second question, asked of nobody who did not take the invocation.
        {
          key: 'agonizing-blast',
          kind: 'spell',
          choose: 1,
          maxLevel: 0,
          onlyIfChoice: 'Agonizing Blast',
        },
        // Eldritch Spear: "Choose one of your known Warlock cantrips that deals
        // damage" — the same sentence Agonizing Blast prints, over a different
        // number, so it is the same question asked of whoever took it.
        {
          key: 'eldritch-spear',
          kind: 'spell',
          choose: 1,
          maxLevel: 0,
          onlyIfChoice: 'Eldritch Spear',
        },
        // Repelling Blast: "Choose one of your known Warlock cantrips that
        // deals damage with an attack roll" — the third feature of the caster
        // written over one named cantrip, and the third asking of one question.
        {
          key: 'repelling-blast',
          kind: 'spell',
          choose: 1,
          maxLevel: 0,
          onlyIfChoice: 'Repelling Blast',
        },
        // "You have received knowledge from an elder entity of the multiverse,
        // allowing you to gain one Origin feat of your choice."
        {
          key: 'lessons',
          kind: 'feat',
          choose: 1,
          category: 'origin',
          onlyIfChoice: 'Lessons of the First Ones',
        },
        // "When the book appears, choose three cantrips, and choose two level 1
        // spells that have the Ritual tag. The spells can be from any class's
        // spell list, and they must be spells you don't already have prepared."
        {
          key: 'tome-cantrips',
          kind: 'spell',
          choose: 3,
          maxLevel: 0,
          fromAnyList: true,
          onlyIfChoice: 'Pact of the Tome',
        },
        {
          key: 'tome-rituals',
          kind: 'spell',
          choose: 2,
          maxLevel: 1,
          fromAnyList: true,
          ritualOnly: true,
          onlyIfChoice: 'Pact of the Tome',
        },
      ],
      grants: [
        // Agonizing Blast: "You can add your Charisma modifier to that spell's
        // damage rolls." The spell is the answer to the question above, read
        // off its own key; the plural is `everyRoll`, which is what makes a
        // level 5 Warlock's two beams each carry the modifier.
        {
          kind: 'standing',
          reach: 'self',
          onlyIfChoice: 'Agonizing Blast',
          choiceFrom: 'warlock:eldritch-invocations:agonizing-blast',
          spellFromChoice: true,
          effects: [
            {
              kind: 'casting-damage',
              when: { dealsDamage: true },
              alters: { kind: 'ability-modifier', ability: 'cha', everyRoll: true },
            },
          ],
        },
        // Eldritch Spear: "When you cast the chosen cantrip, its range
        // increases by a number of feet equal to 30 times your Warlock level."
        // The spell is the answer to the question above; the level is the
        // Warlock's own, pinned by creation.
        {
          kind: 'standing',
          reach: 'self',
          onlyIfChoice: 'Eldritch Spear',
          choiceFrom: 'warlock:eldritch-invocations:eldritch-spear',
          spellFromChoice: true,
          effects: [
            {
              kind: 'casting-range',
              when: { dealsDamage: true },
              perClassLevel: 30,
            },
          ],
        },
        // Repelling Blast: "When you hit a Large or smaller creature with the
        // chosen cantrip, you can push the creature up to 10 feet straight away
        // from you." The shove a spell's own rider already performs, hung on
        // the caster's side because the sentence is printed on the Warlock.
        {
          kind: 'standing',
          reach: 'self',
          onlyIfChoice: 'Repelling Blast',
          choiceFrom: 'warlock:eldritch-invocations:repelling-blast',
          spellFromChoice: true,
          effects: [
            {
              kind: 'casting-rider',
              when: { dealsDamage: true },
              rides: { movement: { feet: 10, kind: 'push', targetNoLargerThan: 'large' } },
            },
          ],
        },
        // Gift of the Depths: "You can breathe underwater, and you gain a Swim
        // Speed equal to your Speed." The Swim Speed is the derivation
        // `match-walk` already writes for SRD Second-Story Work's Climb Speed;
        // breathing underwater is the table's, and the note says so.
        {
          kind: 'standing',
          reach: 'self',
          onlyIfChoice: 'Gift of the Depths',
          effects: [{ kind: 'speed', change: 'match-walk', mode: 'swim' }],
        },
        // "You can also cast Water Breathing once without expending a spell
        // slot. You regain the ability to cast it in this way when you finish a
        // Long Rest." A pool of one, which is what a sizing naming nothing but
        // its floor comes to — SRD Faithful Steed's shape on another spell.
        {
          kind: 'spells',
          onlyIfChoice: 'Gift of the Depths',
          fixed: ['water-breathing'],
          freeCasting: {
            spell: 'water-breathing',
            pool: 'warlock:gift-of-the-depths',
            poolLabel: 'Gift of the Depths',
            declares: { minimum: 1, recovers: 'long-rest' },
          },
        },
        // One with Shadows: "While you're in an area of Dim Light or Darkness,
        // you can cast Invisibility on yourself without expending a spell
        // slot." The route is at will and the clause is where its caster is
        // standing, read off the world at the moment of the cast.
        {
          kind: 'spells',
          onlyIfChoice: 'One with Shadows',
          fixed: ['invisibility'],
          atWill: true,
          requires: [{ kind: 'in-dim-light-or-darkness' }],
        },
        // Pact of the Blade: "As a Bonus Action, you can conjure a pact weapon
        // in your hand — a Simple or Martial Melee weapon of your choice with
        // which you bond ... Until the bond ends, you have proficiency with the
        // weapon ... Whenever you attack with the bonded weapon, you can use
        // your Charisma modifier for the attack and damage rolls instead of
        // using Strength or Dexterity; and you can cause the weapon to deal
        // Necrotic, Psychic, or Radiant damage or its normal damage type."
        //
        // An activation that makes the object it imbues. The bond has **no
        // deadline** — the sentence prints three endings and not one of them is
        // a span — which is what `lastsUntilEnded` says; a second use of the
        // Bonus Action is the activation's own "or until you use this feature
        // again", and death is the `endsOn` clause beside it.
        {
          kind: 'activated',
          onlyIfChoice: 'Pact of the Blade',
          action: 'bonus-action',
          // Nothing is rationed: the book prints no count and no rest.
          pool: null,
          lastsUntilEnded: true,
          // "if you die" — the third of the three endings, and the only one
          // besides the second use that is a fact about state.
          endsOn: ['death'],
          conjuresWeapon: true,
          imbuesWeapon: {
            // "a Simple or Martial Melee weapon of your choice" — both
            // categories written out, because that is how the book prints it
            // and because a reader should not have to know that the two are
            // between them every weapon there is.
            weapons: {
              weapons: [
                { category: 'simple', kind: 'melee' },
                { category: 'martial', kind: 'melee' },
              ],
            },
            // "you have proficiency with the weapon" — with **that** weapon,
            // which is why it rides the imbuing and not the sheet's list of
            // categories.
            grantsProficiency: true,
            // "you can use your Charisma modifier for the attack and damage
            // rolls instead of using Strength or Dexterity" — offered, which
            // is what "can" means, so a Warlock with the better Strength keeps
            // it. Shillelagh's field, and it reaches both rolls.
            offersAbility: 'cha',
            // "you can cause the weapon to deal Necrotic, Psychic, or Radiant
            // damage or its normal damage type" — three offered instead of the
            // weapon's own, answered per hit, and naming none leaves the
            // Glaive slashing.
            damageTypes: ['necrotic', 'psychic', 'radiant'],
          },
        },
        // Pact of the Chain: "You learn the Find Familiar spell and can cast it
        // as a Magic action without expending a spell slot. When you cast the
        // spell, you choose one of the normal forms for your familiar or one
        // of the following special forms: Imp, Pseudodragon, Quasit, Skeleton,
        // Sphinx of Wonder, Sprite, or Venomous Snake."
        //
        // Two sentences and two terms of the **route**: the spell prints an
        // hour and a Ritual tag, and this Warlock's licence prints an Action;
        // the spell prints eleven Beasts and any other of Challenge Rating 0,
        // and this licence prints seven more. Neither is a fact about Find
        // Familiar — a Wizard who prepared it takes the hour and is offered
        // the Beasts — which is why both ride the grant.
        {
          kind: 'spells',
          onlyIfChoice: 'Pact of the Chain',
          fixed: ['find-familiar'],
          atWill: true,
          castingTime: 'action',
          widensForm: [
            'imp',
            'pseudodragon',
            'quasit',
            'skeleton',
            'sphinx-of-wonder',
            'sprite',
            'venomous-snake',
          ],
        },
        // "Additionally, when you take the Attack action, you can forgo one of
        // your own attacks to allow your familiar to make one attack of its own
        // with its Reaction."
        //
        // The third sentence of the Pact, and the one that pays twice: a swing
        // out of the Attack action the Warlock has already taken, and the
        // familiar's Reaction. The spell names which creature is "your
        // familiar", so a Warlock who somehow keeps a second summons cannot
        // order that one to strike.
        {
          kind: 'summons-attack',
          onlyIfChoice: 'Pact of the Chain',
          from: 'find-familiar',
        },
        // "You can cast Mage Armor on yourself without expending a spell slot."
        // No count, no pool, nothing that runs out.
        {
          kind: 'spells',
          onlyIfChoice: 'Armor of Shadows',
          fixed: ['mage-armor'],
          atWill: true,
        },
        // "You can cast Levitate on yourself without expending a spell slot."
        {
          kind: 'spells',
          onlyIfChoice: 'Ascendant Step',
          fixed: ['levitate'],
          atWill: true,
        },
        // "You can see normally in Dim Light and Darkness — both magical and
        // nonmagical — within 120 feet of yourself." The grant a devil's own
        // line writes, on a Warlock.
        {
          kind: 'standing',
          reach: 'self',
          onlyIfChoice: "Devil's Sight",
          effects: [{ kind: 'sees-through', through: 'darkness', feet: 120 }],
        },
        // "You have Advantage on Constitution saving throws that you make to
        // maintain Concentration."
        {
          kind: 'standing',
          reach: 'self',
          onlyIfChoice: 'Eldritch Mind',
          effects: [
            {
              kind: 'roll-mode',
              modifier: {
                mode: 'advantage',
                selector: {
                  roll: 'saving-throw',
                  relation: 'roller',
                  ability: 'con',
                  onlyConcentration: true,
                },
              },
            },
          ],
        },
        // "You can cast False Life on yourself without expending a spell slot.
        // When you cast the spell with this feature, you don't roll the die for
        // the Temporary Hit Points; you automatically get the highest number on
        // the die."
        {
          kind: 'spells',
          onlyIfChoice: 'Fiendish Vigor',
          fixed: ['false-life'],
          atWill: true,
          maximisedDice: true,
        },
        // "You can cast Disguise Self without expending a spell slot."
        {
          kind: 'spells',
          onlyIfChoice: 'Mask of Many Faces',
          fixed: ['disguise-self'],
          atWill: true,
        },
        // "You can cast Alter Self without expending a spell slot."
        {
          kind: 'spells',
          onlyIfChoice: 'Master of Myriad Forms',
          fixed: ['alter-self'],
          atWill: true,
        },
        // "You can cast Silent Image without expending a spell slot."
        {
          kind: 'spells',
          onlyIfChoice: 'Misty Visions',
          fixed: ['silent-image'],
          atWill: true,
        },
        // "You can cast Jump on yourself without expending a spell slot."
        {
          kind: 'spells',
          onlyIfChoice: 'Otherworldly Leap',
          fixed: ['jump'],
          atWill: true,
        },
        // Pact of the Tome: "While the book is on your person, you have the
        // chosen spells prepared, and they function as Warlock spells for you."
        // Three cantrips on the Warlock's cantrip list and two Rituals on its
        // prepared list — which is what makes each of them castable as a Ritual
        // by the ordinary rule, with no licence of its own.
        {
          kind: 'spells',
          onlyIfChoice: 'Pact of the Tome',
          choiceFrom: 'warlock:eldritch-invocations:tome-cantrips',
        },
        {
          kind: 'spells',
          onlyIfChoice: 'Pact of the Tome',
          choiceFrom: 'warlock:eldritch-invocations:tome-rituals',
        },
      ],
    },
    {
      id: 'warlock:pact-magic',
      name: 'Pact Magic',
      level: 1,
      automation: 'engine',
      note: 'Slots are declared at the level the table prints, all at once, and recharge on a Short Rest. Mystic Arcanum is separate and not modelled.',
    },
    {
      id: 'warlock:magical-cunning',
      name: 'Magical Cunning',
      level: 2,
      automation: 'engine',
      note: 'SRD: "you regain expended Pact Magic spell slots but no more than a number equal to half your maximum (round up). Once you use this feature, you can’t do so again until you finish a Long Rest." The slots are the engine’s and the once-a-day limit is a pool of one. The one-minute esoteric rite is the table’s: no state distinguishes a minute of ritual from a minute of walking, and performing a rite is not arithmetic.',
      grants: {
        kind: 'recovery',
        pool: 'warlock:magical-cunning',
        poolLabel: 'Magical Cunning',
        restores: { kind: 'pact-slots' },
        upTo: 'half-pool-maximum',
        moment: 'declared',
      },
    },
    {
      id: 'warlock:subclass',
      name: 'Warlock Subclass',
      level: 3,
      automation: 'engine',
      note: 'The subclass is recorded and its features granted.',
      grantsSubclass: true,
      choice: { kind: 'subclass', choose: 1 },
    },
    {
      id: 'warlock:ability-score-improvement',
      name: 'Ability Score Improvement',
      level: 4,
      automation: 'engine',
      note: 'SRD: "You gain the Ability Score Improvement feat (see “Feats”) or another feat of your choice for which you qualify." Executed, and the points are the feat’s sentence rather than this feature’s: the feature grants a feat, the player names which, and creation applies whatever that feat declares — for the Ability Score Improvement feat, "Increase one ability score of your choice by 2, or increase two ability scores of your choice by 1", whose points land on the scores the player named and stop at the 20 every score keeps. Whether a feat does anything beyond that is a property of the feat and is recorded on the feat. The same paragraph ends with "You gain this feature again at Warlock levels 8, 12, and 16." Each of those levels is an entry of its own here with an id of its own, so the player is offered as many grants as the book offers.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'warlock:ability-score-improvement-2',
      name: 'Ability Score Improvement',
      level: 8,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Warlock levels 8, 12, and 16." The second of them, at level 8. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as warlock:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'warlock:contact-patron',
      name: 'Contact Patron',
      level: 9,
      automation: 'manual',
      note: 'Contact Other Plane always prepared, and the free casting per Long Rest, are not modelled.',
    },
    {
      id: 'warlock:mystic-arcanum',
      name: 'Mystic Arcanum',
      level: 11,
      automation: 'manual',
      note: 'One free casting each of a level 6, 7, 8 and 9 spell, once per Long Rest, gained at levels 11, 13, 15 and 17. Four one-use pools attached to spells chosen at those levels: a shape the engine does not have, and the reason a Warlock has no high-level slots here.',
    },
    {
      id: 'warlock:ability-score-improvement-3',
      name: 'Ability Score Improvement',
      level: 12,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Warlock levels 8, 12, and 16." The third of them, at level 12. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as warlock:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'warlock:ability-score-improvement-4',
      name: 'Ability Score Improvement',
      level: 16,
      automation: 'engine',
      note: 'SRD: "You gain this feature again at Warlock levels 8, 12, and 16." The fourth of them, at level 16. A repeat is a whole grant rather than a second reading of the first — its own feat, chosen and applied on its own — and it is executed exactly as warlock:ability-score-improvement is, carrying no sentence beyond the level it arrives at.',
      choice: { kind: 'feat', choose: 1 },
    },
    {
      id: 'warlock:epic-boon',
      name: 'Epic Boon',
      level: 19,
      automation: 'engine',
      note: 'SRD: "You gain an Epic Boon feat (see “Feats”) or another feat of your choice for which you qualify. Boon of Fate is recommended." Executed: the choice is held to the Epic Boon category, and this catalogue publishes the seven the SRD prints. Every one of them opens with an Ability Score Increase that creation reads — five of them "Increase one ability score of your choice by 1, to a maximum of 30", while Boon of Irresistible Offense narrows the choice to Strength or Dexterity and Boon of Spell Recall to Intelligence, Wisdom or Charisma — so the point lands on the score the player named out of the set that boon offers, and lifts that one score’s ceiling and no other’s. What a boon leaves undone is its own second benefit, which is recorded on the boon rather than here.',
      choice: { kind: 'feat', choose: 1, category: 'epic-boon' },
    },
    {
      id: 'warlock:eldritch-master',
      name: 'Eldritch Master',
      level: 20,
      automation: 'manual',
      note: 'Regaining all Mystic Arcanum castings on a Long Rest is not modelled, because Mystic Arcanum is not.',
    },
  ],
};

/** SRD "Warlock Subclass: Fiend Patron" — the subclass the SRD publishes. */
export const FIEND_PATRON: SubclassDefinition = {
  id: 'fiend-patron',
  name: 'Fiend Patron',
  classId: 'warlock',
  features: [
    {
      id: 'fiend-patron:dark-ones-blessing',
      name: "Dark One's Blessing",
      level: 3,
      automation: 'engine',
      note: 'SRD: "When you reduce an enemy to 0 Hit Points, you gain Temporary Hit Points equal to your Charisma modifier plus your Warlock level (minimum of 1 Temporary Hit Point). You also gain this benefit if someone else reduces an enemy within 10 feet of you to 0 Hit Points." Executed: both damage roads and the sentence that drops a creature without damage ask the same reader once the outcome is known, so a sword, a Fire Bolt and a Sea Hag\'s glare each pay it. **What the scene answers is the second sentence and only that**: a Warlock\'s own kill pays wherever it happened, and somebody else\'s pays only within ten feet of the body, which is a distance and therefore a question the map answers — with no scene, only the Warlock\'s own kills count. **What the table answers is who is an enemy**: hostility is the declared sides and nothing derived, so a kill where either side is unsaid pays nothing and says so. The Charisma modifier is read off the sheet as it stands and the Warlock level off that class\'s own column, so a Warlock 3 / Fighter 5 gains three plus the modifier. Nothing is rationed, because the sentence rations nothing — four goblins in a round pay four times, and the pool that is kept is the larger, which is the SRD\'s own choice between two pools made the only way it is ever made.',
      grants: {
        kind: 'on-dropping-a-hostile',
        temporaryHitPoints: { ability: 'cha', plusClassLevel: true, minimum: 1 },
        within: 10,
      },
    },
    {
      id: 'fiend-patron:fiend-spells',
      name: 'Fiend Spells',
      level: 3,
      automation: 'engine',
      note: 'The level 3 spells are always prepared and do not count against the class table. The later grants at Warlock levels 5 and 7 are not automatic.',
      grants: {
        kind: 'spells',
        fixed: ['burning-hands', 'command', 'scorching-ray', 'suggestion'],
      },
    },
    {
      id: 'fiend-patron:dark-ones-own-luck',
      name: "Dark One's Own Luck",
      level: 6,
      automation: 'engine',
      note: 'SRD: "When you make an ability check or a saving throw, you can use this feature to add 1d10 to your roll. You can do so **after seeing the roll but before any of the roll’s effects occur**." That clause is the `test-rolled` window written out, which is what makes it a real instant rather than a convenient one. A pool of Charisma-modifier uses, minimum one, and **no Reaction**; "no more than once per roll" falls out of the offer being spent when it is answered.',
      grants: {
        kind: 'reaction',
        costsReaction: false,
        reach: { kind: 'self' },
        pool: 'fiend-patron:dark-ones-own-luck',
        poolLabel: "Dark One's Own Luck",
        declares: { fromAbilityModifier: 'cha', minimum: 1, recovers: 'long-rest' },
        does: [
          {
            kind: 'intervene',
            amount: { dice: '1d10' },
            direction: 'bonus',
            tests: ['ability-check', 'saving-throw'],
            // "When you make an ability check or a saving throw" — it says
            // nothing about the outcome, so either one is answerable.
            outcome: 'either',
          },
        ],
      },
    },
    {
      id: 'fiend-patron:fiendish-resilience',
      name: 'Fiendish Resilience',
      level: 10,
      automation: 'manual',
      note: 'Choosing a damage type to resist after each rest is not modelled: defences are declared when a creature is added and nothing changes them later.',
    },
    {
      id: 'fiend-patron:hurl-through-hell',
      name: 'Hurl Through Hell',
      level: 14,
      automation: 'manual',
      note: 'Banishing a target for a turn and the 8d10 Psychic damage on its return are not modelled; it needs a creature removed from and returned to the battlefield.',
    },
  ],
};

export const WARLOCK_SUBCLASSES: readonly SubclassDefinition[] = [FIEND_PATRON];
