/**
 * SRD 5.2.1 species, backgrounds, feats, languages and alignments,
 * transcribed as data.
 *
 * Every species and background the SRD prints is here, transcribed from
 * `packages/srd/raw/character-origins.md` sentence by sentence. Much of what a
 * species trait does is still a mechanic the engine has never had — a breath
 * weapon, a lineage's spells, a Hit Point maximum that grows — so many of
 * these features are `manual` and each note says what the DM is left holding
 * and why. A trait that is one of the shapes already built is wired to it,
 * and Darkvision became one of those the day a sense got a grant kind.
 */
import type {
  AlignmentDefinition,
  BackgroundDefinition,
  FeatDefinition,
  FeatureOptionMeaning,
  LanguageDefinition,
  SpeciesDefinition,
} from '@ie/engine';

/**
 * A table of options against the damage type each one names, as a feature's
 * `optionMeans` — the second column of a table the SRD prints beside a choice.
 *
 * Two species print one: the Draconic Ancestors and the Fiendish Legacies. The
 * shape is the engine's and the rows are the book's, which is the whole of the
 * split: a trait written as "the damage type determined by your X trait" reads
 * the choice made on X and looks the option up here.
 */
const meansDamage = (
  table: Readonly<Record<string, string>>,
): Readonly<Record<string, FeatureOptionMeaning>> =>
  Object.fromEntries(
    Object.entries(table).map(([option, type]) => [option, { damageTypes: [type] }]),
  );

/**
 * SRD Draconic Ancestors: the ten dragons the table prints and the damage type
 * beside each, in the book's own order.
 *
 * **Both columns, because both are now read.** The types used to be left out
 * on purpose — a grant took its damage types only from a choice made on its
 * own feature, the Damage Resistance trait is a different feature from the one
 * that chooses a dragon, and "listing the types here would be a table with no
 * reader". A grant can now name the sibling whose choice it reads and look the
 * option up in that sibling's table, so the reader exists and the other half
 * of the book's table can be transcribed.
 */
const DRACONIC_ANCESTORS: Readonly<Record<string, string>> = {
  Black: 'acid',
  Blue: 'lightning',
  Brass: 'fire',
  Bronze: 'lightning',
  Copper: 'acid',
  Gold: 'fire',
  Green: 'poison',
  Red: 'fire',
  Silver: 'cold',
  White: 'cold',
};

/**
 * SRD Fiendish Legacies: the three legacies and the damage type each one's
 * level 1 benefit names.
 *
 * The other columns of that table are the cantrip each legacy knows and the
 * level 3 and level 5 spells, and those are **not** transcribed, for the
 * reason the damage types were not until now: a species feature granting a
 * spell reaches no spellcasting route, so there would be nothing to read them.
 */
const FIENDISH_LEGACIES: Readonly<Record<string, string>> = {
  Abyssal: 'poison',
  Chthonic: 'necrotic',
  Infernal: 'fire',
};

export const DRAGONBORN: SpeciesDefinition = {
  id: 'dragonborn',
  name: 'Dragonborn',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'dragonborn:draconic-ancestry',
      name: 'Draconic Ancestry',
      level: 1,
      automation: 'manual',
      note: 'Half of what the chosen dragon decides is applied, which is why this is not marked as executed. The Damage Resistance trait reads this choice and the damage type printed beside the dragon, and applies the Resistance. The Breath Weapon is written in terms of the same choice and none of it is applied - see its own note - and the appearance the trait also decides is fiction the DM narrates.',
      choice: { kind: 'option', choose: 1, from: Object.keys(DRACONIC_ANCESTORS) },
      optionMeans: meansDamage(DRACONIC_ANCESTORS),
    },
    {
      id: 'dragonborn:breath-weapon',
      name: 'Breath Weapon',
      level: 1,
      automation: 'manual',
      note: 'None of it is applied. Replacing one of the Attack action attacks with a 15-foot Cone or a 30-foot Line, the Dexterity save against DC 8 plus Constitution modifier and Proficiency Bonus, and the 1d10 that becomes 2d10, 3d10 and 4d10 at character levels 5, 11 and 17 are the DM to adjudicate. Not even the uses are declared: the engine sizes a pool from a class table column, an ability modifier or a multiple of a class level, and "a number of times equal to your Proficiency Bonus" is none of the three.',
    },
    {
      id: 'dragonborn:damage-resistance',
      name: 'Damage Resistance',
      level: 1,
      automation: 'engine',
      note: 'Applied whole: the Resistance is a standing grant measured against every hit, and the type is "determined by your Draconic Ancestry trait" - so the grant names that trait as where its choice was made and takes the damage type the Draconic Ancestors table prints beside the chosen dragon.',
      grants: {
        kind: 'standing',
        reach: 'self',
        // The types come from a choice made on another trait, through that
        // trait's own table. SRD prints no condition on this Resistance, so
        // nothing takes it away.
        effects: [{ kind: 'damage-resistance', damageTypes: [] }],
        damageTypesFromChoice: true,
        choiceFrom: 'dragonborn:draconic-ancestry',
      },
    },
    {
      id: 'dragonborn:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
      },
    },
    {
      id: 'dragonborn:draconic-flight',
      name: 'Draconic Flight',
      level: 5,
      automation: 'manual',
      note: 'Not applied: the Bonus Action, the 10 minutes of spectral wings, the Fly Speed equal to your Speed and the ending on Incapacitated are all the DM. A creature has one Speed and there is no Fly Speed beside it; a placement carries an elevation and nothing grants the movement that would use it.',
    },
  ],
};

export const DWARF: SpeciesDefinition = {
  id: 'dwarf',
  name: 'Dwarf',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'dwarf:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 120 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 120 }],
      },
    },
    {
      id: 'dwarf:dwarven-resilience',
      name: 'Dwarven Resilience',
      level: 1,
      automation: 'engine',
      note: 'Applied whole, in the two halves the sentence has. "You have Resistance to Poison damage" is a standing grant that every hit is measured against. "Advantage on saving throws you make to avoid or end the Poisoned condition" is a roll mode keyed to the condition the save is about — the axis a selector gained for this trait and its three siblings — so the dwarf rolls two dice against Contagion and one against everything else her Constitution answers for.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          { kind: 'damage-resistance', damageTypes: ['poison'] },
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', condition: 'poisoned' },
            },
          },
        ],
      },
    },
    {
      id: 'dwarf:dwarven-toughness',
      name: 'Dwarven Toughness',
      level: 1,
      automation: 'manual',
      note: 'Not applied: "Your Hit Point maximum increases by 1, and it increases by 1 again whenever you gain a level" needs a feature that raises the hit point maximum, which the engine does not have - Draconic Resilience wants the same thing and says so. A DM adds one hit point per character level.',
    },
    {
      id: 'dwarf:stonecunning',
      name: 'Stonecunning',
      level: 1,
      automation: 'manual',
      note: 'Not applied: Tremorsense is a sense the engine now names, and none of what this trait does with it is expressible. The sense is switched on for 10 minutes by a Bonus Action rather than had, the engine has no notion of a stone surface for it to be in contact with, and the uses are not declared either - "a number of times equal to your Proficiency Bonus" is not one of the three ways the engine sizes a pool. A DM runs the whole trait.',
    },
  ],
};

export const ELF: SpeciesDefinition = {
  id: 'elf',
  name: 'Elf',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'elf:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
      },
    },
    {
      id: 'elf:elven-lineage',
      name: 'Elven Lineage',
      level: 1,
      automation: 'manual',
      note: 'One of the three level 1 benefits is applied and the rest are the DM, which is why this is not marked as executed. The Wood Elf "Speed increases to 35 feet" is five feet of standing Speed, granted only to the lineage that chose it and read by speedOf like any other. The Drow "range of your Darkvision increases to 120 feet" is a sense the engine now reads, and it is still not applied here: a feature carries at most one grant, this one is already the Wood Elf\'s Speed, and there is no second option gate to hang a Drow sense on. A DM gives the Drow the further sixty feet. Neither the cantrip each lineage knows nor the level 3 and level 5 spells that are always prepared and free once per Long Rest are applied either: the engine gathers a spells grant only from the features of a class that casts, so a species cannot grant one.',
      choice: { kind: 'option', choose: 1, from: ['Drow', 'High Elf', 'Wood Elf'] },
      grants: {
        kind: 'standing',
        reach: 'self',
        // SRD: an Elf's Speed is 30 and the Wood Elf's "increases to 35 feet",
        // so the grant is the difference — and only for the lineage that took
        // it, which is what `onlyIfChoice` says.
        onlyIfChoice: 'Wood Elf',
        effects: [{ kind: 'speed', feet: 5 }],
      },
    },
    {
      id: 'elf:fey-ancestry',
      name: 'Fey Ancestry',
      level: 1,
      automation: 'engine',
      note: 'Applied: "Advantage on saving throws you make to avoid or end the Charmed condition" is a roll mode keyed to the condition, on the axis a selector gained for this trait and its three siblings. Both halves of "avoid or end" are the one grant — the save Charm Person forces and the save a turn boundary repeats against a charm already standing are the same sentence at two moments.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', condition: 'charmed' },
            },
          },
        ],
      },
    },
    {
      id: 'elf:keen-senses',
      name: 'Keen Senses',
      level: 1,
      automation: 'engine',
      note: 'The chosen skill proficiency is applied to the sheet, and the choice is held to the three the trait offers.',
      choice: { kind: 'skill', choose: 1, from: ['insight', 'perception', 'survival'] },
    },
    {
      id: 'elf:trance',
      name: 'Trance',
      level: 1,
      automation: 'manual',
      note: 'Not applied: a Long Rest is eight hours for everybody in this engine, one constant with no per-creature answer, so finishing one in four hours of meditation is a DM ruling. Not needing to sleep, and magic not being able to put you to sleep, are the same: nothing models sleep.',
    },
  ],
};

export const GNOME: SpeciesDefinition = {
  id: 'gnome',
  name: 'Gnome',
  creatureType: 'Humanoid',
  sizes: ['Small'],
  speed: 30,
  features: [
    {
      id: 'gnome:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
      },
    },
    {
      id: 'gnome:gnomish-cunning',
      name: 'Gnomish Cunning',
      level: 1,
      automation: 'engine',
      note: 'Applied whole: three standing roll modes, one per ability the trait names, gathered at the save like any other Advantage and settled by the same presence rule - so a Gnome saving against a spell that imposes Disadvantage rolls one die rather than three.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', ability: 'int' },
            },
          },
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', ability: 'wis' },
            },
          },
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', ability: 'cha' },
            },
          },
        ],
      },
    },
    {
      id: 'gnome:gnomish-lineage',
      name: 'Gnomish Lineage',
      level: 1,
      automation: 'manual',
      note: 'The lineage is recorded and its benefits are the DM. Both options are spells - the Forest Gnome Minor Illusion and a Speak with Animals free a Proficiency Bonus of times a day, the Rock Gnome Mending and Prestidigitation and the clockwork device - and a species feature cannot grant a spell, because the engine gathers a spells grant only from the features of a class that casts.',
      choice: { kind: 'option', choose: 1, from: ['Forest Gnome', 'Rock Gnome'] },
    },
  ],
};

export const GOLIATH: SpeciesDefinition = {
  id: 'goliath',
  name: 'Goliath',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 35,
  features: [
    {
      id: 'goliath:giant-ancestry',
      name: 'Giant Ancestry',
      level: 1,
      automation: 'manual',
      note: 'The chosen boon is recorded and none of the six is applied, and for two different reasons. Four of them are mechanisms the engine does not have: a teleport on a Bonus Action, extra damage a feature adds to a hit of the holder own choosing, a Speed reduction until the start of your next turn, and the Prone condition given on a hit. Stone\'s Endurance is not one of those - "take a Reaction to roll 1d12, add your Constitution modifier and reduce the damage by that total" is the shape Uncanny Dodge already answers the damage window with - and it is still not wired, because a Reaction grant has no way to say it belongs to one option of six (only a standing grant can), and because "a number of times equal to your Proficiency Bonus" is not one of the three ways the engine sizes a pool. Storm\'s Thunder, which deals damage back rather than reducing it, is a mechanism that really is absent.',
      choice: {
        kind: 'option',
        choose: 1,
        from: [
          "Cloud's Jaunt",
          "Fire's Burn",
          "Frost's Chill",
          "Hill's Tumble",
          "Stone's Endurance",
          "Storm's Thunder",
        ],
      },
    },
    {
      id: 'goliath:large-form',
      name: 'Large Form',
      level: 5,
      automation: 'manual',
      note: 'Not applied: a creature size in this engine belongs to the scene rather than to the sheet, and nothing changes one mid-fight, so the Bonus Action, the 10 minutes, the Advantage on Strength checks and the extra 10 feet of Speed are the DM.',
    },
    {
      id: 'goliath:powerful-build',
      name: 'Powerful Build',
      level: 1,
      automation: 'manual',
      note: 'Not applied: "Advantage on any ability check you make to end the Grappled condition" names a condition, and the condition axis a selector now carries is legal on a saving throw and refused on an ability check — no check roller says what it is about, so a grant written there would pick out nothing for ever. This is the trait the refusal names by way of apology. Counting as one size larger for carrying capacity reaches nothing either: the catalogue records a weight for every item and nothing adds them up, so there is no capacity to widen.',
    },
  ],
};

export const HALFLING: SpeciesDefinition = {
  id: 'halfling',
  name: 'Halfling',
  creatureType: 'Humanoid',
  sizes: ['Small'],
  speed: 30,
  features: [
    {
      id: 'halfling:brave',
      name: 'Brave',
      level: 1,
      automation: 'engine',
      note: 'Applied: "Advantage on saving throws you make to avoid or end the Frightened condition" is a roll mode keyed to the condition, on the axis a selector gained for this trait and its three siblings. It reaches the save that would frighten the halfling and no other Wisdom save she makes, which is the whole of the narrowing the trait needed.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          {
            kind: 'roll-mode',
            modifier: {
              mode: 'advantage',
              selector: { roll: 'saving-throw', relation: 'roller', condition: 'frightened' },
            },
          },
        ],
      },
    },
    {
      id: 'halfling:halfling-nimbleness',
      name: 'Halfling Nimbleness',
      level: 1,
      automation: 'manual',
      note: 'Not applied: moving through the space of a creature one size larger is a rule the engine writes for a two-size difference and for nothing else, and it is not read off a feature. A DM allows the move.',
    },
    {
      id: 'halfling:luck',
      name: 'Luck',
      level: 1,
      automation: 'engine',
      note: 'Applied. "When you roll a 1 on the d20 of a D20 Test, you can reroll the die, and you must use the new roll" is a rule read after the die lands, so it is neither a roll mode nor the Reaction reroll Indomitable takes: it costs nothing, is offered by nobody and fires on the face. The grant names the face, sheetAsItStands derives it onto the sheet on every read, and the two rollers that throw a d20 for a test read it there - so it reaches every ability check, every saving throw, every attack roll, Initiative and a death saving throw without a single roll site having to remember it. Exactly one reroll: a 1 on the new die stands, because "the new roll" is the roll the test made. Under Advantage or Disadvantage it is the die the mode picked out that is thrown again and the other stands. Both faces are in the log - the first on roll-recorded supersedes, the second as the roll itself - and it never touches a face a table read out, because a stated die takes the other path.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'reroll-test-die', on: 1 }],
      },
    },
    {
      id: 'halfling:naturally-stealthy',
      name: 'Naturally Stealthy',
      level: 1,
      automation: 'manual',
      note: 'Not applied. The ordinary case this trait is an exception to exists now - takeHide asks for Three-Quarters Cover, Total Cover or a declared Heavy Obscurement before the DC 15 check - and what the trait widens is that test itself: no feature widens the concealment a Hide asks for, because it is a constant inside the command rather than anything on the sheet. A DM allows the Hide behind a creature one size larger.',
    },
  ],
};

export const HUMAN: SpeciesDefinition = {
  id: 'human',
  name: 'Human',
  creatureType: 'Humanoid',
  sizes: ['Medium', 'Small'],
  speed: 30,
  features: [
    {
      id: 'human:resourceful',
      name: 'Resourceful',
      level: 1,
      automation: 'manual',
      note: 'Heroic Inspiration is not modelled, so finishing a Long Rest does not grant it.',
    },
    {
      id: 'human:skillful',
      name: 'Skillful',
      level: 1,
      automation: 'engine',
      note: 'The chosen skill proficiency is applied to the sheet.',
      choice: { kind: 'skill', choose: 1 },
    },
    {
      id: 'human:versatile',
      name: 'Versatile',
      level: 1,
      automation: 'engine',
      note: 'The chosen Origin feat is validated, and applied as far as that feat is executed - see the feat own note, which says what a DM still has to do.',
      choice: { kind: 'feat', choose: 1, category: 'origin' },
    },
  ],
};

export const ORC: SpeciesDefinition = {
  id: 'orc',
  name: 'Orc',
  creatureType: 'Humanoid',
  sizes: ['Medium'],
  speed: 30,
  features: [
    {
      id: 'orc:adrenaline-rush',
      name: 'Adrenaline Rush',
      level: 1,
      automation: 'manual',
      note: 'Half of it is applied, which is why this is not marked as executed. SRD: "You can take the Dash action as a Bonus Action" is an action rule the trait holds, derived on every read like any other standing grant, and `takeDash` charges the Bonus Action when the Orc asks for that price. The other half is not: the Temporary Hit Points equal to your Proficiency Bonus are real state the engine holds, and no feature route reaches them, so a DM hands them over; and the uses are not declared either - "equal to your Proficiency Bonus" is not one of the three ways the engine sizes a pool, so nothing counts them and nothing refuses the fourth Dash of the day.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [
          { kind: 'action-rule', rule: { kind: 'allows', action: 'dash', from: 'bonus-action' } },
        ],
      },
    },
    {
      id: 'orc:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 120 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 120 }],
      },
    },
    {
      id: 'orc:relentless-endurance',
      name: 'Relentless Endurance',
      level: 1,
      automation: 'manual',
      note: 'Not applied: dropping to 1 Hit Point instead of 0 is a decision taken at the moment damage lands, and the only thing a feature may do there is reduce the damage as a Reaction. A DM holds the Orc at 1 hit point once between Long Rests.',
    },
  ],
};

export const TIEFLING: SpeciesDefinition = {
  id: 'tiefling',
  name: 'Tiefling',
  creatureType: 'Humanoid',
  sizes: ['Medium', 'Small'],
  speed: 30,
  features: [
    {
      id: 'tiefling:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Every engine rule that asks whether one creature can see another goes through canSee, so this trait is read by the rule that wanted it rather than waiting on a declared line. What is left around it is the light: what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'sense', sense: 'darkvision', feet: 60 }],
      },
    },
    {
      id: 'tiefling:fiendish-legacy',
      name: 'Fiendish Legacy',
      level: 1,
      automation: 'manual',
      note: 'The Resistance each legacy names is applied and the rest is the DM, which is why this is not marked as executed. The choice is a legacy rather than a damage type, and the legacy names one - Poison, Necrotic or Fire - so the trait declares what each of its options means and the grant reads the type out of that table. The cantrip beside it, and the level 3 and level 5 spells, reach nothing: the engine gathers a spells grant only from the features of a class that casts, so a species cannot grant one, and the spellcasting ability this trait chooses has nowhere to be recorded.',
      choice: { kind: 'option', choose: 1, from: Object.keys(FIENDISH_LEGACIES) },
      optionMeans: meansDamage(FIENDISH_LEGACIES),
      grants: {
        kind: 'standing',
        reach: 'self',
        // The choice is on this feature, so the grant names no other — what it
        // needed was the table, which turns a legacy into a damage type.
        effects: [{ kind: 'damage-resistance', damageTypes: [] }],
        damageTypesFromChoice: true,
      },
    },
    {
      id: 'tiefling:otherworldly-presence',
      name: 'Otherworldly Presence',
      level: 1,
      automation: 'manual',
      note: 'Not applied: knowing the Thaumaturgy cantrip is a spells grant the engine gathers only from the features of a class that casts, so a species feature granting one reaches no spellcasting route and the spellcasting ability the Fiendish Legacy trait chose has nowhere to be recorded. A DM lets the Tiefling cast it.',
    },
  ],
};

export const ACOLYTE: BackgroundDefinition = {
  id: 'acolyte',
  name: 'Acolyte',
  abilities: ['int', 'wis', 'cha'],
  feat: 'Magic Initiate (Cleric)',
  skillProficiencies: ['insight', 'religion'],
  toolProficiency: "Calligrapher's Supplies",
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'calligraphers-supplies', quantity: 1 },
        { id: 'book', quantity: 1, detail: 'prayers' },
        { id: 'holy-symbol', quantity: 1 },
        { id: 'parchment', quantity: 10, detail: 'sheets' },
        { id: 'robe', quantity: 1 },
      ],
      goldPieces: 8,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'acolyte:magic-initiate-cleric',
      name: 'Magic Initiate (Cleric)',
      level: 1,
      automation: 'engine',
      note: 'The chosen spells reach usable state: castable through resolveSpell on the feat own spellcasting ability, and the level 1 spell free daily casting is a long-rest pool. The list is pinned to the Cleric one the background names, and a spell chosen off another list is refused. What is missing is a definition for each spell - the engine executes only the spells it has been taught.',
      grantsFeat: { featId: 'magic-initiate', spellList: 'cleric' },
    },
  ],
};

export const CRIMINAL: BackgroundDefinition = {
  id: 'criminal',
  name: 'Criminal',
  abilities: ['dex', 'con', 'int'],
  feat: 'Alert',
  skillProficiencies: ['sleight-of-hand', 'stealth'],
  toolProficiency: "Thieves' Tools",
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'dagger', quantity: 2 },
        { id: 'thieves-tools', quantity: 1 },
        { id: 'crowbar', quantity: 1 },
        { id: 'pouch', quantity: 2 },
        { id: 'clothes-travelers', quantity: 1 },
      ],
      goldPieces: 16,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'criminal:alert',
      name: 'Alert',
      level: 1,
      automation: 'engine',
      note: 'The granted feat is validated, and applied as far as that feat is executed: the Initiative Proficiency comes back from creation as a named bonus rollInitiative takes like any other. The Initiative swap does not - see the feat own note, which says what a DM still has to do.',
      grantsFeat: { featId: 'alert' },
    },
  ],
};

export const SAGE: BackgroundDefinition = {
  id: 'sage',
  name: 'Sage',
  abilities: ['con', 'int', 'wis'],
  feat: 'Magic Initiate (Wizard)',
  skillProficiencies: ['arcana', 'history'],
  toolProficiency: "Calligrapher's Supplies",
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'quarterstaff', quantity: 1 },
        { id: 'calligraphers-supplies', quantity: 1 },
        { id: 'book', quantity: 1, detail: 'history' },
        { id: 'parchment', quantity: 8, detail: 'sheets' },
        { id: 'robe', quantity: 1 },
      ],
      goldPieces: 8,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'sage:magic-initiate-wizard',
      name: 'Magic Initiate (Wizard)',
      level: 1,
      automation: 'engine',
      note: 'The chosen spells reach usable state: castable through resolveSpell on the feat own spellcasting ability, and the level 1 spell free daily casting is a long-rest pool. What is missing is a definition for each spell - the engine executes only the spells it has been taught.',
      grantsFeat: { featId: 'magic-initiate', spellList: 'wizard' },
    },
  ],
};

export const SOLDIER: BackgroundDefinition = {
  id: 'soldier',
  name: 'Soldier',
  abilities: ['str', 'dex', 'con'],
  feat: 'Savage Attacker',
  skillProficiencies: ['athletics', 'intimidation'],
  // SRD: "Choose one kind of Gaming Set." The kind is the player's and the
  // sheet holds one string, the way the Bard's "Musical Instrument" does.
  toolProficiency: 'Gaming Set',
  startingEquipment: [
    {
      option: 'A',
      items: [
        { id: 'spear', quantity: 1 },
        { id: 'shortbow', quantity: 1 },
        { id: 'arrows', quantity: 20 },
        { id: 'gaming-set', quantity: 1, detail: 'the kind chosen above' },
        { id: 'healers-kit', quantity: 1 },
        { id: 'quiver', quantity: 1 },
        { id: 'clothes-travelers', quantity: 1 },
      ],
      goldPieces: 14,
    },
    { option: 'B', items: [], goldPieces: 50 },
  ],
  features: [
    {
      id: 'soldier:savage-attacker',
      name: 'Savage Attacker',
      level: 1,
      automation: 'engine',
      note: 'Applied, and for free: the background names the Origin feat, creation checks that it is the right one and grants it, and the feat own standing grant is what executes. Rolling the weapon damage dice twice once per turn and using either roll is the feat sentence rather than the background, so this feature holds no second copy of it - see the feat own note for what the rule does and what it reaches.',
      grantsFeat: { featId: 'savage-attacker' },
    },
  ],
};

/** Every species the SRD publishes, in the order the book prints them. */
export const SPECIES: readonly SpeciesDefinition[] = [
  DRAGONBORN,
  DWARF,
  ELF,
  GNOME,
  GOLIATH,
  HALFLING,
  HUMAN,
  ORC,
  TIEFLING,
];

/** Every background the SRD publishes, in the order the book prints them. */
export const BACKGROUNDS: readonly BackgroundDefinition[] = [ACOLYTE, CRIMINAL, SAGE, SOLDIER];

/** SRD "Origin Feats". The four the SRD publishes, no more. */
export const ORIGIN_FEATS: readonly FeatDefinition[] = [
  {
    id: 'alert',
    name: 'Alert',
    category: 'origin',
    requires: { kind: 'none' },
    repeatable: false,
    // SRD prints two benefits under Alert and both are declared here, because
    // the feat prints two sentences and a definition carries one grant.
    // Creation reads the first into initiativeBonuses under this feat name,
    // where rollInitiative takes it like any other named bonus; the second is
    // the permission swapInitiativeBetween asks for before it will write a
    // swap at all.
    grants: { kind: 'initiative', proficiency: true, swap: true },
    note: 'Both printed benefits are applied. Initiative Proficiency adds the Proficiency Bonus to the roll. Initiative Swap is the permission the swap command asks for: the owner ruled on 2026-09-20 that the choice is the feat-holder’s and has a window, so the swap is refused outside the first turn of the fight, refused for a swapper without this grant, and refused for an ally whose consent the table has not stated - which is asked for rather than refused, because a fact nobody has said is missing rather than wrong.',
  },
  {
    id: 'magic-initiate',
    name: 'Magic Initiate',
    category: 'origin',
    requires: { kind: 'magic-initiate', lists: ['cleric', 'druid', 'wizard'] },
    repeatable: true,
    note: 'The chosen spells are castable, on this feat own spellcasting ability, and the level 1 spell free daily casting is a long-rest pool the engine spends. Spell change on levelling is not modelled, and a chosen spell still needs an executable definition before it does anything.',
  },
  {
    id: 'savage-attacker',
    name: 'Savage Attacker',
    category: 'origin',
    requires: { kind: 'none' },
    repeatable: false,
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [{ kind: 'attack-roll-rule', rule: { kind: 'roll-twice-keep-either' }, oncePerTurn: true }],
    },
    note: 'Applied. "Roll the weapon damage dice twice and use either roll" is a rule about the roll rather than about a die in it, which is the scope rollUnder in the dice layer answers and the one Great Weapon Fighting beside it does not: the second throw is made, the lower total is dropped rather than discarded, and both throws reach the log in the one damage roll they are two halves of. It reaches the weapon own dice and nothing else, so a Sneak Attack riding on the same hit is thrown once; on a Critical Hit it is the doubled set that is thrown twice, because that is what the weapon damage dice are by then. No narrowing is declared, because the sentence has none - it says "a weapon", not which. "Once per turn" is the combat ledger own mark, so a second hit on the same turn rolls once; out of combat there is no turn to be once in. "Use either" is taken as the higher of the two, which is the only choice a player has a reason to make and is stated rather than asked.',
  },
  {
    id: 'skilled',
    name: 'Skilled',
    category: 'origin',
    requires: { kind: 'proficiencies', choose: 3 },
    repeatable: true,
    note: 'The three chosen proficiencies *are* applied to the sheet; nothing else about the feat needs applying.',
  },
];

/**
 * SRD "General Feats" — the one of the two whose whole text the engine says.
 *
 * The other is Grappler, and it is **left out** for rule 1 of `items.ts`
 * applied to a feat: its bracket prints "Strength or Dexterity 13+", which is
 * a prerequisite on a *score* and `FeatDefinition` gates only on a level, and
 * three of its four benefits are Unarmed Strike and Grapple rules the attack
 * layer has no notion of. A record carrying one point and four notes would be
 * a feat that looks transcribed.
 */
export const GENERAL_FEATS: readonly FeatDefinition[] = [
  {
    id: 'ability-score-improvement',
    name: 'Ability Score Improvement',
    category: 'general',
    // SRD: "Increase one ability score of your choice by 2, or increase two
    // ability scores of your choice by 1." Both branches of one sentence,
    // each as the points it puts into that many distinct scores.
    requires: { kind: 'ability-score', spreads: [[2], [1, 1]] },
    // SRD: "_General Feat (Prerequisite: Level 4+)_".
    minimumLevel: 4,
    // SRD: "You can take this feat more than once."
    repeatable: true,
    // No grant: "This feat can't increase an ability score above 20" is the
    // ceiling every score already has, so there is nothing for the feat to
    // lift and a grant saying 20 would be refused for saying nothing.
    note: 'The whole of the feat is applied: the points land on the scores the player named, and the 20 they cannot pass is the maximum every score of every character already keeps.',
  },
];

/**
 * SRD "Epic Boon Feats" — the seven the SRD publishes.
 *
 * **Seven, and the count is worth saying**, because the note this brief
 * inherited said nine: `feats.md` prints Combat Prowess, Dimensional Travel,
 * Fate, Irresistible Offense, Spell Recall, the Night Spirit and Truesight,
 * and the wider game's list is longer than the SRD's.
 *
 * Every one of them opens with the same mechanical sentence — "Increase one
 * ability score of your choice by 1, to a maximum of 30" — and that is the
 * half transcribed here: the question in `requires`, the lifted ceiling in
 * `grants`. Two of the seven narrow which scores and say so.
 *
 * **The second benefit is a note on every one of them**, and each note says
 * which mechanic is missing rather than "not automated". Truesight's is the
 * closest to expressible and still is not: `sense` is a standing grant the
 * vocabulary has, and a feat carries **one** grant, which this feat has
 * already spent on the ceiling — the `a-feature-that-carries-a-second-grant`
 * shape, arriving at a feat's door.
 */
export const EPIC_BOON_FEATS: readonly FeatDefinition[] = [
  {
    id: 'boon-of-combat-prowess',
    name: 'Boon of Combat Prowess',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Peerless Aim is not applied: "When you miss with an attack roll, you can hit instead" replaces the outcome of a roll after it is made, which is the substitution the D20 pipeline has for damage dice and not for a D20 Test, and it is spent out of a once-per-turn allowance no feat can declare.',
  },
  {
    id: 'boon-of-dimensional-travel',
    name: 'Boon of Dimensional Travel',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Blink Steps is not applied: teleporting up to 30 feet immediately after the Attack or Magic action is a move a feature hands its holder outside the turn’s allowance, and nothing in the grant vocabulary offers one.',
  },
  {
    id: 'boon-of-fate',
    name: 'Boon of Fate',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Improve Fate is not applied: rolling 2d4 and applying it as a bonus or a penalty to somebody else’s finished D20 Test is a modifier put on another creature after the roll, and the recovery it is spent against ("until you roll Initiative or finish a Short or Long Rest") is a pool a feat cannot declare.',
  },
  {
    id: 'boon-of-irresistible-offense',
    name: 'Boon of Irresistible Offense',
    category: 'epic-boon',
    // SRD: "Increase your Strength or Dexterity score by 1, to a maximum of 30."
    requires: { kind: 'ability-score', spreads: [[1]], from: ['str', 'dex'] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Overcome Defenses is not applied: "the Bludgeoning, Piercing, and Slashing damage you deal always ignores Resistance" reads the target’s defences as an input to the attacker’s own damage, and applyDamage is the only reader of a defence. Overwhelming Strike is not applied either: extra damage on a natural 20, sized by the very score this feat raised.',
  },
  {
    id: 'boon-of-spell-recall',
    name: 'Boon of Spell Recall',
    category: 'epic-boon',
    // SRD: "Increase your Intelligence, Wisdom, or Charisma score by 1."
    requires: { kind: 'ability-score', spreads: [[1]], from: ['int', 'wis', 'cha'] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'The second half of the bracket is not enforced: SRD prints "Prerequisite: Level 19+, Spellcasting Feature" and a feat gates on a level and on nothing else, so a character with no Spellcasting feature is not refused this boon. Free Casting is not applied either: rolling 1d4 against the slot’s level to refund it is a roll made inside a casting, which no grant hangs anything on.',
  },
  {
    id: 'boon-of-the-night-spirit',
    name: 'Boon of the Night Spirit',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Merge with Shadows and Shadowy Form are not applied: both are gated on standing "within Dim Light or Darkness", which is a fact about where a creature is standing that no StandingRequirement asks; the first also gives its holder the Invisible condition, which no feature may impose.',
  },
  {
    id: 'boon-of-truesight',
    name: 'Boon of Truesight',
    category: 'epic-boon',
    requires: { kind: 'ability-score', spreads: [[1]] },
    minimumLevel: 19,
    repeatable: false,
    grants: { kind: 'ability-score-increase', maximum: 30 },
    note: 'Truesight with a range of 60 feet is not applied, and it is the one clause in this family the vocabulary could otherwise say: a sense standing grant is exactly that sentence. What stops it is that a feat carries one grant and this one is spent on the ceiling, which is the second-grant shape arriving at a feat’s door.',
  },
];

/**
 * SRD "Fighting Style Feats" — the four the SRD publishes.
 *
 * Their prerequisite is the Fighting Style *feature*, which is how the SRD
 * writes "only a class that grants this may take one". The feature's choice
 * names the category, and `checkFeats` already refuses a feat from the wrong
 * one, so the prerequisite is enforced by where the choice is offered rather
 * than by a rule here.
 *
 * **Two of the four are declarations now, and two are still notes** — and the
 * two that are left are blocked on different things, which an earlier version
 * of this comment got wrong. It said three of them wanted one *narrowing*; in
 * fact only two ever did.
 *
 * | | The clause | What it wanted |
 * |---|---|---|
 * | **Archery** | "with **Ranged weapons**" | a weapon narrowing — built |
 * | **Great Weapon Fighting** | "a **Melee** weapon that you are **holding with two hands** … **Two-Handed or Versatile**" | the same narrowing, and a rule about the dice — built |
 * | **Defense** | "while you're **wearing Light, Medium, or Heavy armor**" | a `StandingRequirement` about **armour**, which is a different clause |
 * | **Two-Weapon Fighting** | "an extra attack as a result of using the **Light** property" | which hand an attack came from, which nothing records |
 *
 * What the two that are built needed besides the narrowing was a *reader*:
 * `FEAT_GRANT_KINDS` admits a grant kind only once `creation.ts` reads it off a
 * feat, and `standing` joined that list with `standingFromFeats`. So a feat
 * carries a standing grant now, which is why Defense's note names one blocker
 * rather than two.
 *
 * Great Weapon Fighting's arithmetic was always built — `treatLowRollsAs` in
 * the dice layer — and what was missing was a declaration asking for it and a
 * command supplying it. `StandingGrant`'s `attack-die-rule` is the first and
 * `standingDamageEffects` feeding `AttackOptions.damageEffects` is the second.
 * A spell says how its own dice behave through `SpellDefinition.dieRule`, and
 * this is the other scope of the same idea: a rule about every die an *attack*
 * throws rather than about one spell's.
 *
 * What `bonuses.ts` said when it was written — "whether Archery is in play is a
 * question about feats and inventory, which the engine does not model; the
 * layer that knows passes them in" — is retired for Archery: the sheet knows,
 * and the swing asks it.
 */
export const FIGHTING_STYLE_FEATS: readonly FeatDefinition[] = [
  {
    id: 'archery',
    name: 'Archery',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [
        {
          kind: 'flat-bonus',
          applies: ['attack'],
          flat: 2,
          onlyWithWeapon: { weapons: [{ kind: 'ranged' }] },
        },
      ],
    },
    note: 'Applied. The +2 is a named contribution on the attack roll, gathered by standingBonuses from the sheet rather than passed in by a caller, and "with Ranged weapons" is read off the weapon record the swing resolved - so a Shortbow gets it and the Longsword on the same belt does not.',
  },
  {
    id: 'defense',
    name: 'Defense',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'The +1 to Armour Class is not applied, and one thing is left between the feat and the number. The arithmetic is a standing flat-bonus applying to ac, which magic armour already uses; a feat carries a standing grant now, which is how Archery and Great Weapon Fighting beside it are declared. What is missing is a StandingRequirement for "while wearing Light, Medium, or Heavy armour" — an **armour** clause rather than the weapon clause the other two wanted, and the union has unarmored and not-wearing-heavy-armor, which are its opposites.',
  },
  {
    id: 'great-weapon-fighting',
    name: 'Great Weapon Fighting',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    grants: {
      kind: 'standing',
      reach: 'self',
      effects: [
        {
          kind: 'attack-die-rule',
          rule: { kind: 'treat-low-rolls-as', atMost: 2, as: 3 },
          onlyWithWeapon: {
            weapons: [
              { kind: 'melee', properties: ['two-handed'] },
              { kind: 'melee', properties: ['versatile'] },
            ],
            heldInTwoHands: true,
          },
        },
      ],
    },
    note: 'Applied. The substitution is treatLowRollsAs in the dice layer, asked for by the grant and supplied to the swing as an attack-wide die rule, so a 1 or a 2 on a damage die counts as a 3 and the log shows what the die physically showed beside what it counted as. The narrowing is the sentence\'s own: a Melee weapon with the Two-Handed or Versatile property, held in two hands, which is the hand the attack itself declares. Attack-wide rather than weapon-only, which is what the printed sentence conditions on: a rider\'s die rolled for the same swing is raised with the blade\'s.',
  },
  {
    id: 'two-weapon-fighting',
    name: 'Two-Weapon Fighting',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'Adding the ability modifier to the off-hand attack is not applied; the engine does not model which hand an attack came from.',
  },
];

/**
 * SRD 5.2.1 "Choose Languages", as the catalogue's own answer.
 *
 * "Your character knows at least three languages: Common plus two languages
 * you roll or choose from the Standard Languages table." Common is the one
 * every character speaks without spending a choice; the rest of the table is
 * what the two choices come from. The Rare Languages the book prints beside
 * them are a GM's to hand out rather than a character's to choose, and are
 * not transcribed yet — adding one is `availability: 'rare'` and nothing else.
 */
export const LANGUAGES: readonly LanguageDefinition[] = [
  { id: 'common', name: 'Common', availability: 'everyone' },
  { id: 'common-sign-language', name: 'Common Sign Language' },
  { id: 'draconic', name: 'Draconic' },
  { id: 'dwarvish', name: 'Dwarvish' },
  { id: 'elvish', name: 'Elvish' },
  { id: 'giant', name: 'Giant' },
  { id: 'gnomish', name: 'Gnomish' },
  { id: 'goblin', name: 'Goblin' },
  { id: 'halfling', name: 'Halfling' },
  { id: 'orc', name: 'Orc' },
];

/**
 * SRD 5.2.1 Step 4: "Choose your character's alignment... and note it on your
 * character sheet."
 *
 * The nine the book prints. Nothing in 2024 hangs off the choice
 * mechanically, so these are recorded rather than read from; they exist so a
 * typo cannot slip through as an alignment nobody has heard of, and a setting
 * with a different axis — or none — simply supplies its own.
 */
export const ALIGNMENTS: readonly AlignmentDefinition[] = [
  { id: 'lawful-good', name: 'Lawful Good' },
  { id: 'neutral-good', name: 'Neutral Good' },
  { id: 'chaotic-good', name: 'Chaotic Good' },
  { id: 'lawful-neutral', name: 'Lawful Neutral' },
  { id: 'neutral', name: 'Neutral' },
  { id: 'chaotic-neutral', name: 'Chaotic Neutral' },
  { id: 'lawful-evil', name: 'Lawful Evil' },
  { id: 'neutral-evil', name: 'Neutral Evil' },
  { id: 'chaotic-evil', name: 'Chaotic Evil' },
];
