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
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Two things around it are still the DM. No command routes through canSee yet - every rule in the engine that requires sight asks for a declared line - so a spell cast on this character in the dark still wants one. And what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
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
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 120 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Two things around it are still the DM. No command routes through canSee yet - every rule in the engine that requires sight asks for a declared line - so a spell cast on this character in the dark still wants one. And what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
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
      automation: 'manual',
      note: 'Half of it is applied, which is why it is not marked as executed. "You have Resistance to Poison damage" is a standing grant that every hit is measured against. "Advantage on saving throws you make to avoid or end the Poisoned condition" is not: a roll selector names a family, an ability and a skill, and has no way to say which condition a save is about, so a DM gives that Advantage.',
      grants: {
        kind: 'standing',
        reach: 'self',
        effects: [{ kind: 'damage-resistance', damageTypes: ['poison'] }],
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
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Two things around it are still the DM. No command routes through canSee yet - every rule in the engine that requires sight asks for a declared line - so a spell cast on this character in the dark still wants one. And what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
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
      automation: 'manual',
      note: 'Not applied: "Advantage on saving throws you make to avoid or end the Charmed condition" names a condition, and a roll selector names a family, an ability and a skill and has no condition axis. A DM gives the Advantage on those saves.',
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
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Two things around it are still the DM. No command routes through canSee yet - every rule in the engine that requires sight asks for a declared line - so a spell cast on this character in the dark still wants one. And what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
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
      note: 'Not applied: "Advantage on any ability check you make to end the Grappled condition" names a condition, and a roll selector names a family, an ability and a skill and has no condition axis. Counting as one size larger for carrying capacity reaches nothing either: the catalogue records a weight for every item and nothing adds them up, so there is no capacity to widen.',
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
      automation: 'manual',
      note: 'Not applied: "Advantage on saving throws you make to avoid or end the Frightened condition" names a condition, and a roll selector names a family, an ability and a skill and has no condition axis. A DM gives the Advantage on those saves.',
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
      automation: 'manual',
      note: 'Not applied: rerolling a 1 on the d20 is a reroll the engine has, and only as a Reaction offered at a named window - Indomitable takes it that way. This one costs no Reaction, is not offered, and fires on the die rather than on the outcome. A DM applies the reroll, and it must be the new roll that stands.',
    },
    {
      id: 'halfling:naturally-stealthy',
      name: 'Naturally Stealthy',
      level: 1,
      automation: 'manual',
      note: 'Not applied: the engine takes no Hide action at all, so there is no ordinary case for this exception to widen. A DM allows the Hide behind a creature one size larger.',
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
      note: 'Not applied: the engine spends a Bonus Action on what a feature declares, and nothing lets a feature say that an action anybody can take becomes one. The Temporary Hit Points equal to your Proficiency Bonus are real state the engine holds, and no feature route reaches them. The uses are not declared either - "equal to your Proficiency Bonus" is not one of the three ways the engine sizes a pool.',
    },
    {
      id: 'orc:darkvision',
      name: 'Darkvision',
      level: 1,
      automation: 'engine',
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 120 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Two things around it are still the DM. No command routes through canSee yet - every rule in the engine that requires sight asks for a declared line - so a spell cast on this character in the dark still wants one. And what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
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
      note: 'The trait is one sentence and the sentence is applied: Darkvision and its 60 feet are a standing grant on the sheet, and canSee answers with them out to that range where nobody has declared a sight line and nobody has declared Total Cover. Two things around it are still the DM. No command routes through canSee yet - every rule in the engine that requires sight asks for a declared line - so a spell cast on this character in the dark still wants one. And what the SRD glossary says Darkvision does to Dim Light and Darkness is not simulated, because the engine holds no light, which is why a declared line outranks the sense rather than the other way about.',
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
      automation: 'manual',
      note: 'The feat is granted and its being the right one is checked, and that is the whole of what happens: Savage Attacker is executed nowhere. Rolling the weapon damage dice twice once per turn and using either roll is the DM, or the caller reproducing it through the dice module - see the feat own note.',
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
    note: 'Initiative Proficiency is applied: creation returns it as a named bonus in initiativeBonuses, which rollInitiative takes like any other. The Initiative swap is not - swapping two combatants after the roll needs a decision nobody has modelled, and swapInitiative exists but nothing offers it.',
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
    note: 'Rolling weapon damage twice once per turn is not applied; the caller can reproduce it through the dice module.',
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
 * SRD "Fighting Style Feats" — the four the SRD publishes.
 *
 * Their prerequisite is the Fighting Style *feature*, which is how the SRD
 * writes "only a class that grants this may take one". The feature's choice
 * names the category, and `checkFeats` already refuses a feat from the wrong
 * one, so the prerequisite is enforced by where the choice is offered rather
 * than by a rule here.
 *
 * None is executed. Every one of them is a modifier the caller supplies, and
 * the engine has said so since `bonuses.ts` was written: "whether Archery is
 * in play is a question about feats and inventory, which the engine does not
 * model; the layer that knows passes them in."
 */
export const FIGHTING_STYLE_FEATS: readonly FeatDefinition[] = [
  {
    id: 'archery',
    name: 'Archery',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'The +2 to attack rolls with Ranged weapons is a named bonus the caller passes to the roll; nothing adds it automatically.',
  },
  {
    id: 'defense',
    name: 'Defense',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'The +1 to Armour Class while wearing armour is not applied: Armour Class is derived from the armour and Dexterity, and has no place for a feat yet.',
  },
  {
    id: 'great-weapon-fighting',
    name: 'Great Weapon Fighting',
    category: 'fighting-style',
    requires: { kind: 'none' },
    repeatable: false,
    note: 'Treating a 1 or 2 on a damage die as a 3 is `treatLowRollsAs` in the dice layer, which the caller opts into per roll; taking the feat does not switch it on.',
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
