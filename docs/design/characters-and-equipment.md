# Characters, progression, equipment, and monsters

Progression, creation and execution kept apart; multiclassing; what a pool buys; owning versus wearing; and how a monster states what a character derives. **Read this before changing character creation, advancement, class features, inventory, or monster adaptation.**

> **Authority.** This document is authoritative for its subject. It was
> extracted verbatim from `CLAUDE.md` when that file became the
> constitution and router; the sentences below are the repository's own
> reasoning, unchanged. `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` outranks it,
> and `CLAUDE.md` outranks it on anything it still states directly.

---
## Progression, Creation And Execution Are Three Jobs

They arrive together in a rulebook and are kept apart here, because conflating
them is how a character sheet ends up claiming abilities nothing honours.

| | |
|---|---|
| **Progression** (`progression.ts`) | What a level grants. Pure data and lookups; knows nothing about any character |
| **Creation** (`creation.ts`) | Turning choices into a character, validated |
| **Execution** (everywhere else) | Actually doing what a feature does |

**Every feature says which of the last two owns it.** `automation: 'engine'`
means the engine applies the mechanical effect; `'manual'` means the feature is
recorded and a DM applies it, and a required `note` says exactly what is
missing. There is no third state where the engine half-does something, and an
unexplained "not automated" is not a useful thing to read at three in the
morning. A level 3 Evoker carries five manual features, and the sheet says so
rather than implying Potent Cantrip is being applied to damage rolls.

**The choices are the character.** `CharacterChoices` is stored on the creature
and everything else is derived from it, so the sheet can be rebuilt byte for
byte after a reload — and so gaining a level is a matter of adding to a record
rather than re-creating a creature. That second point is load-bearing:
re-creating would silently heal every wound, lift every condition and refund
every spent slot, which is the kind of bug nobody notices until a boss fight.
`advanceCharacter` emits only the differences: the hit points gained, the pools
that grew, the sheet the new level derives.

**Pools grow rather than being re-declared**, for the same reason.
`resource-pool-resized` changes a maximum and leaves what has been spent spent.

### Two lists of pool kinds is how a level silently stops granting one

Creation declared seven kinds of pool — the Hit Die pool, the spell slots, a
feat's free casting, a feature that is switched on, a feature that *is* a
resource, a Reaction with a limit of its own, and a recovery's single daily
use. **Advancement carried a second list, and that list held two of them.**
The comment above it said "Pools that already exist grow; pools that did not
exist are declared", which was true of the two below it and false of the other
five, which is exactly why it read as complete.

What that cost was a wrong number in a shipped path — the class of failure
this file calls its worst, because it looks like a rules bug forever after:

| Feature | SRD sizing | A character advanced 3 → 4 had |
|---|---|---|
| Lay On Hands | "five times your Paladin level" | 15 hit points in the pool, not 20 |
| Sorcery Points | the Sorcerer level | 3, not 4 |
| Rage, Channel Divinity, Wild Shape, Second Wind, Bardic Inspiration | a column of the class table | whatever the table printed at the level they were *created* at |

And a pool that arrives later never arrived at all: a Fighter advanced to 9 had
Indomitable on the sheet and nothing to spend, so `takeTestReaction` refused a
Reaction the character was entitled to.

So `poolsFor` is the one derivation and both callers reach it. Creation maps
every pool to a declaration; advancement declares what the creature does not
hold, resizes what it holds at a different maximum, and **emits nothing at all
for a pool the level left alone** — a resize to the number already stored is an
event recording that nothing happened, and the log should not carry one per
level per feature. The level is read off `choices` rather than passed beside
it, because a caller that can hand in a different number is a caller that can
hand in the wrong one.

**Shrinking is proven absent rather than branched on.** A downward resize would
clamp `spent` to the new maximum and quietly hand back a use already spent, so
it wants a rule rather than a guess — and no SRD progression asks for one.
`class-pools.test.ts` sweeps every pool-declaring feature in the twelve classes
and asserts no column falls and no per-level multiple is negative, which is
what says so.

**Two frozen logs fold unchanged, and that is the compatibility story.**
`golden-log-2.json` contains a real advancement, written before any of these
events existed. The fixture is a *log*: folding it applies the events it
records, and a fold that would now emit more of them changes nothing about what
those events mean. Regenerating it to match a richer batch would have converted
a compatibility test into a rubber stamp.

**Validation reports every problem, not the first.** `checkCharacter` returns a
list with a `field` on each, because a caller filling in a character does not
want to be told about one mistake at a time; `planCharacter` returns the first
as an ordinary `Result` error for a caller that just wants a character or a
refusal.

### Rules the validator actually enforces

Transcribed, not recalled, and each with a test: the standard array is exactly
15/14/13/12/10/8; point buy is 27 points with no score outside 8–15 before
origin increases; a background raises one ability by 2 and another by 1 *or*
all three by 1, never above 20, and only among the three it lists; a class
skill must be one the class offers and must not be chosen twice; Scholar's
Expertise requires proficiency in that skill first; a subclass is refused
before its level and required at it; a Wizard's spellbook holds six spells at
level 1 and two more per level after; prepared spells must be in the book and
must number what the table prints.

Hit points follow the SRD: the maximum die at level 1, then the fixed value or
a roll, plus the Constitution modifier, never less than 1 per level.

### The tables are transcribed by hand

`classes.md` has no parser, so all twelve class tables and their subclasses
are written out from the SRD text, one file each. Transcription is where typos
hide, so the tests assert *relationships* rather than presence — every printed
Proficiency Bonus against `proficiencyBonusForLevel`, slots never decreasing,
a subclass granted at the level the class says, a hit die the game uses — and
that suite runs against **every registered class**, not the one it was written
for. Pointing it at all twelve immediately found that Pact Magic breaks "slots
never go backwards", which is a rule rather than a typo: a Warlock's slots move
up rather than accumulate.

Growth tables get their own assertions for the same reason: Sneak Attack's dice
per level, the Monk's Martial Arts die, Bardic Inspiration, Rage, Wild Shape,
Favored Enemy. A table that climbs by the wrong step in the middle is exactly
what a transcription gets wrong and nothing else would catch.

A `classes.md` parser is the eventual home for this, and would replace the
hand-written tables without touching the structures around them.

### Twelve classes, and the seams that opening them exposed

All twelve SRD classes, each with the subclass the SRD publishes and a level
1–20 table. Creation and advancement are validated for every one of them.

**A class says what it is; a feature says what it does.** Three string matches
on feature ids came out over the course of getting here, and each was found by
a class the previous code could not have anticipated:

| Seam | Found by | Now |
|---|---|---|
| `wizard:scholar` for Expertise | Rogue, Bard, Ranger | `grants: { kind: 'expertise' }` |
| `evoker:evocation-savant` for free spells | Life Domain, Draconic, Fiend | `grants: { kind: 'spells' }` |
| `human:skillful` for a skill proficiency | Barbarian's Primal Knowledge | any feature whose choice is a skill |

A generalisation with one user is a guess dressed up as a structure. Each of
these became real when a second class needed it and differed in some way the
first had not — Expertise takes *two* skills and comes round twice, a domain
grant is **fixed** where the Evoker's is chosen.

**Three spellcasting styles, which are not interchangeable.** SRD's 2024 tables
head the column "Prepared Spells" for every caster, which is exactly what makes
three rules look like one:

| Style | Classes | Means |
|---|---|---|
| `spellbook` | Wizard | prepared from a book you had to fill |
| `prepared-from-list` | Cleric, Druid, Paladin | chosen fresh from the class list |
| `known` | Bard, Sorcerer, Warlock, Ranger | a fixed set; never prepared |
| *(absent)* | Barbarian, Fighter, Monk, Rogue | casts nothing at all |

**Absent is not zero.** A Fighter does not know zero cantrips; a Fighter has no
cantrips, so `cantripsKnown` is *absent* and `checkSpells` short-circuits
before it can ask a Fighter for a spellbook. The distinction earned its keep
twice: once for a class that casts nothing, and once for the Paladin and Ranger
— genuine casters, with slots and prepared lists, that have no cantrips.

**Two rules corrections from reading the tables rather than recalling them:**
2024 gives the **Paladin and Ranger spellcasting at level 1** (2014 started
both at 2), and SRD's **Multiclass Spellcaster table is identical to every full
caster's own**, which is why it is read off one rather than transcribed twice.

Class *features* are a different matter from class *tables*: 91 of 230 are
executed, and every one of the rest carries a note saying what a DM still does.
`npm run coverage` counts them, because a project that does not count them
will believe it has twelve working classes when it has twelve validated ones.
The recurring blockers, each wanted by several classes:

- **A class feature that replaces the Armour Class calculation.** Unarmoured
  Defense, wanted by Barbarian (Constitution), Monk (Wisdom) and Draconic
  Sorcery. Two classes wanting the same missing hook is what makes it a shape.
- **Extra attacks inside the Attack action.** The economy counts one Attack
  action, not the attacks in it, so Extra Attack is offered by nobody.
- **Reactions with triggers — built.** See "A Reaction Is A Window, Not A
  Trigger". Uncanny Dodge, Deflect Attacks, Deflect Energy, Cutting Words,
  Peerless Skill, Indomitable, Dark One's Own Luck and Retaliation all run.
  What is left in this family is named rather than vague: Countercharm needs a
  spell's saving throws to be interruptible *and* a save that remembers what it
  was against; Slow Fall needs falling; Disciplined Survivor's reroll needs a
  feature to carry two grants; a stat block's printed Reactions are not read at
  all.

  **Superior Hunter's Defense is the one whose blocker moved rather than
  cleared**, and it is worth saying what is left instead of striking it off.
  "A Resistance with a deadline" is built — `damage-defense-granted` hangs one
  and the `grants` timer ends it — and reading the SRD sentence against the
  machinery turns up **three further things, none of them the grant**: "When
  you take damage, you can take a Reaction to give yourself Resistance to that
  damage and any other damage of the same type until the end of the current
  turn."

  | | |
  |---|---|
  | A fifth `ReactionEffect` member | the union's own rule is that a member exists because **at least two** features write it, and this is one. `reduce-damage` is not a substitute: SRD orders Uncanny Dodge's halving as an *adjustment* and Resistance second, so a Ranger who already resists would take a quarter under the wrong one |
  | "that damage", when a hit deals two types | the SRD prints no worked example, exactly as it prints none for which type Uncanny Dodge comes off — so it is a choice the engine would have to make and state, like `adjustmentsFor`'s |
  | ~~"the end of the **current** turn"~~ | **built** — `endOfCurrentTurn`, the fifth `Duration` member. `endOfNextTurn` said of the creature whose turn it is resolves two turn-endings away, which is a round late, and this Reaction is usually taken on somebody else's turn |

  So **both** deadlines are built and the runtime user is not, which is the
  honest order: the parts nothing could express were the grant's lifetime and
  the moment it ends at, and what is left is a feature task with two decisions
  in it. Stinking Cloud is what supplied the moment — the member arrived with
  a writer rather than ahead of one, which is the rule a closed union is held
  to everywhere else here.
- **Auras that follow a creature.** Every Paladin aura, Spirit Guardians.
- **Defences that change after a rest.** Fiendish Resilience, Rage.
- **A grant that can be re-chosen on a rest.** Circle of the Land's spells, and
  every "swap a prepared spell on a Long Rest" rule.

### Multiclassing

`multiclass.ts` holds the rules that belong to no single class, because every
one of them reads *across* the set. `CharacterChoices.multiclass` carries the
classes beyond the starting one — SRD's own framing, since the starting class
is the one that grants its proficiencies in full.

- **Proficiency Bonus and character level come from the total**, never from a
  class level. A level 3 Fighter / level 2 Rogue is a level 5 character.
- **Spell slots come from a weighted sum** — all your levels in the five full
  casters, half rounded up in Paladin and Ranger — read off the full-caster
  table, not from adding two classes' tables together.
- **Pact Magic is a second pool.** SRD keeps it out of the sum and then lets
  the two be spent on each other's spells, so merging them would invent a slot.
- **Prerequisites read both directions**: 13 in the primary ability of the new
  class *and* every class you already have.
- **Hit Dice pool by die type**, and hit points pay the maximum die once, for
  the starting class, at total character level 1.

**And that last line was a claim about a function nothing called.** SRD: "If
these dice are the same die type, you can pool them together... If your classes
give you Hit Dice of different types, track them separately." `hitDicePools`
has said exactly that, correctly, since it was written, and is tested against
both of the SRD's own worked examples — and `poolsFor` declared **one** pool,
from the *starting* class, sized at that class's level. So the rule described
here was true of the engine's arithmetic and false of every character it built.

That is wrong in two directions at once, and which one a character meets
depends only on what they took: a Cleric 4 / Fighter 1 had four d8 and **no d10
at all**, while a Paladin 4 / Fighter 1 — who shares the die, both being "D10
per level" — had **four** d10 where the SRD gives five. The second is the
nastier of the two, because one pool of a plausible size is what a correct
implementation also produces, and only the *number* is wrong.

**The fix is the call, and that is the whole of it.** This is the eleventh
recorded instance in this file of a pure function that is correct, tested and
unreachable, and the remedy has never once been to write a second one. The
derivation is `hitDicePools`; `hitDiePools` in `creation.ts` adapts its
`{ sides: count }` to pool declarations and does no arithmetic of its own.

**A single-class character comes out byte-identical** — same key, same label,
same maximum, same `recovers` — which is the entire compatibility story, since
both frozen logs fold through that pool. One class in gives one entry out at
`choices.level`, which is what the starting class always produced. It is
asserted directly rather than relied upon, because "unchanged" is exactly the
kind of claim that is cheap to believe and cheap to check.

**Advancement needed no change of its own.** IE-008's declare-or-resize loop
reads whatever `poolsFor` returns, so a level in a class whose die is new
declares that pool and a level in a class whose die is already held resizes the
one pool — and both leave what has been spent spent, because `resize` moves
only the maximum. Two lists of pool kinds that have to agree is the shape the
bug IE-008 fixed had; this is the payoff for there being one.

Numeric keys iterate in ascending order, so a Cleric / Paladin's d8 pool always
precedes their d10. The declarations reach the log, so that order has to be a
property of the character rather than of the order their classes were written
down.

**Two casting classes is refused**, and the refusal is the honest answer rather
than a gap. SRD requires each prepared spell to remember which class prepared
it and to use that class's spellcasting ability; a creature here carries one
prepared list and one ability, so validating a merged list would record a
character the rules do not describe. The slot arithmetic for that case is
implemented and tested against the SRD's worked example — per-class preparation
is what is missing.

### What is still missing around the class system
- **Three of the four Origin feats are executed; one is not.** The choices
  every feat demands are checked — Magic Initiate's spell list, spellcasting
  ability, two cantrips and level 1 spell, all against the parsed SRD;
  Skilled's three proficiencies; and the rule that Magic Initiate taken twice
  must use different lists. Beyond validation: Magic Initiate's spells are
  castable on the feat's own ability with its free daily casting as a pool,
  Alert's Initiative Proficiency rides on the roll, and Skilled's proficiencies
  are on the sheet. **Savage Attacker's reroll is not applied**, and Alert's
  Initiative *swap* is not offered. Each feat's note says which it is, and so
  does every Ability Score Improvement feature that grants one — because
  whether a feat does anything is a property of the feat, not of the class
  feature that handed it over.
- **Ability Score Improvements taken as score increases** rather than as feats
  are not modelled; the choice is always a feat.
- **Owning and wearing are separate; weight and attunement are not modelled.**
  `inventory` is everything the character has — class package, background
  package, and anything the GM added — and `equipped` is the subset actually
  worn or held. Armour Class reads `equipped`, so a chain shirt in the backpack
  protects nobody. What is still missing: weight, attunement, containers, and
  whether the quarterstaff in the package is the same object as the arcane
  focus. Every package entry is a catalogue id and packs are opened; what is
  missing is weight, containers and attunement.
- **Species traits above level 1 are not reached.** The structures handle a
  trait that arrives at character level 3 — `cumulativeFeatures` reads a species
  exactly as it reads a class — but the Human has none, so nothing exercises it.
- **Spell *execution* is still the caller's.** Creation now validates every
  spell choice against the parsed SRD, but knowing a Wizard has Fireball
  prepared does not make `resolveCast` aware of Fireball's effects; a spell's
  own mechanics are narrated and applied through the existing commands.
- **Arcane Recovery is a pool, not a behaviour.** The single use is declared and
  spends correctly; choosing which slots to recover, and the half-level cap, are
  the caller's.

### The SRD creation workflow, step by step

Audited against SRD 5.2.1 "Character Creation". Every required choice and grant
is accounted for, for every class; anything the engine does not execute says so.
The table below names the Wizard path it was first written against, and every
check in it runs for all twelve.

| SRD step | Required choice or grant | Where | Test |
|---|---|---|---|
| 1. Choose Class | Class | `resolveParts` | refuses an unknown class |
| 2. Origin — background | Which background | `resolveParts` | refuses an unknown background |
| | Ability scores: +2/+1 or +1/+1/+1 among its three, never past 20 | `checkAbilities` | four cases, including the all-three shape |
| | Origin feat (Sage → Magic Initiate (Wizard)) | `grantsFeat` + `checkFeats` | refuses a feat the background did not grant |
| | Two skill proficiencies | `gatherProficiencies` | gathered from every source |
| | One tool proficiency | `gatherProficiencies` | `toolProficiencies` |
| | Equipment: package A or B | `inventoryOf` | both packages, and mixing them |
| 2. Origin — species | Which species | `resolveParts` | refuses an unknown species |
| | Species traits, and their choices (Human: a skill, an Origin feat) | `grantedFeatures`, `checkFeats` | Skillful applies; Versatile demands a feat |
| 2. Origin — languages | Common plus two from the Standard Languages table | `checkLanguages` | count, duplicate, off-table |
| 3. Ability Scores | Standard array, point buy, or manual | `checkAbilities` | array and 27-point budget |
| 4. Alignment | One of the nine | `checkCharacter` | refuses one that is not |
| 5. Details — features | Class features recorded, with their choices made | `grantedFeatures`, `checkFeatureChoices` | every feature granted; missing choice names the feature |
| 5. Details — numbers | Saves, skills, Passive Perception, hit points, AC, Initiative | `planCharacter` → `CharacterSheet` | save DC, skill modifiers, AC, hit points |
| 5. Details — hit points | Max die at level 1, fixed or rolled after, minimum 1 per level | `hitPointsFor` | fixed, rolled, and a Constitution penalty |
| Spellcasting | Cantrips known, spellbook, prepared — all against the parsed SRD | `checkSpells` | id, class list, level, duplicate, preparation, acquisition level |
| Subclass (level 3) | Which subclass, and its own choices | `resolveParts`, `checkEvocationSavant` | refused early, required at 3; school and level cap |
| Level Advancement | New spells per level, kept apart from copied ones | `advanceCharacter` | advances preserving copied spells and current state |
| Starting at Higher Levels | Minimum XP for the level | `planCharacter` | 900 XP at level 3, 0 at level 1 |
| | GM's extra equipment, money and magic items | `checkDmGrants` | refused when unstated above level 1 |

**Missing choices are errors with a field attached, never silent defaults.**
`checkCharacter` returns every problem at once with the `field` it belongs to,
so a caller can point at what needs fixing; `planCharacter` returns the first
as an ordinary `Result` error.

### Two places the SRD does not answer, and what the engine does instead

**Overlapping proficiencies.** SRD 5.2.1 gives no rule letting a player re-pick
a proficiency they already have — the 2014 guidance to that effect is not
reproduced anywhere in it. So the engine does not invent one. Proficiency is
binary, as the glossary says, so overlapping grants **union**; the redundant
pick comes back in `plan.warnings` as `redundant_proficiency`, and the table
decides whether to swap it. Not an error, because the rules do not make it one.

**What a higher-level character starts with.** SRD: "The GM decides whether
your character starts with more than the standard equipment for a level 1
character, possibly even one or more magic items." That is a decision the
engine cannot make, so above level 1 it must be *stated* — `dmGrants` with a
note, even if the note says "nothing beyond the standard package". An absent
grant is refused rather than defaulted, because a silent zero would be the
engine answering a question the SRD asked the GM.

### Spells are validated against the parsed SRD

Choices are **stable spell ids** (`magic-missile`), not names, checked against a
generated index of all 339 SRD spells. Every selection is checked for
existence, class-list membership, level, and duplication; the spellbook also
checks that the acquisition level is one the character has reached, and
preparation checks membership in the book and that the spell is of a level the
character has slots for.

The Evoker's two free spells are checked **separately**, on the feature's own
terms — Evocation school, level 2 or lower, not already in the book — so a bad
pick says which of the feature's rules it broke rather than a generic
spellbook complaint.

### Level-granted spells and spells found in play

SRD gives a Wizard six spells at level 1 and two per level after, and
*separately* lets them copy any Wizard spell they find. So a spellbook entry
records where it came from: `level`, `copied`, or `feature`. **The count rule
measures only the `level` subset.** An earlier version enforced an exact total,
which meant levelling up would reject a Wizard for the crime of having looted a
spell scroll. Copied spells ride along and are preserved across advancement.

They are still checked: a copied spell must be a real Wizard spell of a level
the character can prepare, which is what the SRD requires to copy it at all.

## Owning Is Not Wearing

Equipment is two separate facts about a creature, and collapsing them is the
bug this design exists to prevent: **chain mail in a backpack protects nobody.**
`inventory` is what is owned, `equipped` is the subset worn or wielded, and
Armour Class reads only the second. Equipping is an event, so the log shows the
moment the shirt went on.

**`equipped` is the fact; `sheet.armor` is a view of it.** The reducer derives
both armour fields from the whole equipped list after every equipment event
rather than patching one slot at a time, because patching is only correct while
events arrive in order and nothing else replaces the sheet — and
`character-advanced` replaces the sheet wholesale. One derivation, used
everywhere, is what keeps the two from drifting; a test walks the whole log
prefix by prefix asserting they agree at every step.

**One suit, one Shield, at creation as well as in play.** `equipItem` refuses a
second of either, and `checkEquipped` now refuses the same thing at creation.
Without that, a character could be born wearing two suits and the sheet would
have to pick one.

**Ids, not names.** `catalogue.ts` is one lookup over the SRD's four separate
equipment tables — gear, tools, weapons, armour — keyed by the slug the parsers
assign. A display name is not an identifier: the gear table alphabetises by
inverting them, so it prints `Lantern, Hooded` where a person says "hooded
lantern", and matching on display text is how a starting package silently stops
containing a lantern.

**A pack is its contents.** The SRD prices a pack as a bundle and lists what is
in it in prose, so `parsePackContents` resolves that sentence back to the rows
it names — through the plurals ("10 flasks of Oil") and the inversions
("Hooded Lantern" → `lantern-hooded`) — and an unresolved phrase is a parser
*problem*, never a silently dropped item. A Scholar's Pack is nine things.
Owning the label is owning nothing.

**Money is copper.** Every SRD coin divides into it, and a Blanket at 5 SP has
no representation in gold-only arithmetic. Prices the SRD prints as "Varies"
stay `null` and a purchase of one is refused with `no_price` — the book
declined to say, and inventing a number is worse than asking.

**One of A or B, never both.** A starting package is the items *or* the gold.
Each package contributes exactly one of its halves, and both halves come from
the same chosen option, so no route grants a package and the money instead of
it. Levelling up grants neither again: `advanceCharacter` emits differences,
and equipment is not one of them.

**A purchase is atomic.** The items and the coin move in one batch, so there is
no state in which a character has paid and not received. Refusals — unknown
item, no price, cannot afford, a quantity that is not a count — cost nothing,
which is the same "validate before rolling" discipline applied to a purse.

**Advancement recalculates the sheet and keeps the equipment.** The new level
derives everything a level changes — hit points, proficiency, slots — and knows
nothing about what is worn, so the reducer takes the *new* sheet and puts the
armour back from `equipped`. Gaining a level does not take your armour off, and
it does not put back what you took off either.

**What is worn is state, not a creation choice.** `choices.equipped` records a
decision made at level 1; the chain shirt bought in play was never part of it,
and the one taken off in play is still named by it. So `advanceCharacter` plans
against the creature's *live* inventory and equipped set, and writes those into
the record it stores. Before that, a GM note for level 4 that did not re-list
last season's chain shirt made the plan's inventory forget it, and advancement
was refused with `not_owned` for a character wearing armour they owned. That is
the shape of the bug this split prevents: a snapshot standing in for state.

### What equipment does not model yet

- **Nothing weighs anything.** Weight is in the catalogue; carrying capacity,
  encumbrance and the Strength score that governs them are not.
- **No containers.** Items are a flat list per creature. A pack's contents are
  granted, not held *inside* it, so nothing is lost by putting the pack down.
- **No magic items and no attunement.** `dmGrants.magicItems` records names
  only; none of them is in the catalogue and none has an effect.
- **Ammunition is owned, not spent.** Arrows are a line in the inventory; no
  attack consumes one, and none is recovered after a fight.
- **"Varies" rows cannot be bought.** Arcane Focus, Component Pouch and the
  other open-priced rows can be granted by a package or a GM, but not
  purchased, because the SRD prints no single price.
- **A package's `detail` is documentation.** The SRD's "Arcane Focus
  (Quarterstaff)" grants a quarterstaff and notes what it is for; the note
  stays on the package definition and does not reach the inventory, because the
  engine does not model what a focus is.
- **The Spellbook is class text, not a gear row.** SRD 5.2.1's equipment tables
  have no Spellbook; the Wizard's feature describes it. `CLASS_ITEMS` in
  `catalogue.ts` carries it from there, with no price, rather than letting a
  starting package name an item that resolves to nothing.
- **Only armour and weapons can be equipped.** Clothing, an instrument and a
  holy symbol are carried; none has a mechanical slot. Nothing checks that two
  hands are free, either.

## Monsters State Their Numbers; Characters Derive Them

A character's Armour Class follows from their armour and Dexterity. A monster's
is printed. The same goes for saves, skills and the proficiency bonus — an
Adult Red Dragon has a +0 Dexterity modifier and a **+6** Dexterity save, which
no combination of proficiency and ability produces.

So `CharacterSheet` carries an optional `stated` block that wins over
derivation, and `adaptMonster` fills it from the stat block rather than
reverse-engineering proficiencies that happen to add up. Characters are
untouched: with no `stated`, every derivation behaves exactly as before.

**A stat block prints damage types and conditions in one run.** A Zombie's
immunities read "Poison, Exhaustion, Poisoned" — one damage type and two
conditions, which the engine treats completely differently. `adaptMonster`
splits them, and anything it recognises as neither is kept as a caveat rather
than silently dropped.

**A qualified defence is not an unconditional one.** "Charmed (except from its
vampire master)" applied as flat immunity makes the vampire unable to charm the
one creature the entry exists to let it charm. The engine cannot evaluate a
qualification, so it does not pretend to: qualified entries stay *out* of the
automatic tables and `conditionApplicability` returns one of three answers —
`allowed`, `immune`, or `needs-adjudication` with the qualification attached.

Three outcomes rather than a boolean, because they mean different things
upstream: proceed, refuse, or ask. Collapsing the third into either of the
others is exactly how a conditional immunity becomes an absolute one.

### A monster enters through a command, and its printed immunities arrive with it

**`adaptMonster` had no caller outside its own test**, and `conditionApplicability`
had none either — which is the fourteenth recorded instance of this repository's
most persistent finding, and it cost two things at once. Nothing above the
engine could put a monster into a game without folding a `creature-added` by
hand, which is narration writing straight to truth; and the condition half of
the run a stat block prints in one line reached nothing at all, so **a Zombie
was Poisoned by Ray of Sickness like anybody** — a wrong number with no symptom,
which is the class of failure this file calls its worst.

`addCreature` in `commands/creatures.ts` is the command. It **wraps**
`adaptMonster` and computes nothing of its own: the printed Armour Class, the
stated saves and skills, the average hit points, "a monster dies the instant it
drops to 0", the creature type the parser has read since `Small Fey
(Goblinoid)`, and both halves of the defence run.

**It takes the parsed `Monster` rather than an id, and that is the parser
rather than a decision.** `@ie/srd` ships no monster index — `generated/monsters.json`
is untracked and nothing consumes it — so there is nothing for an "unknown stat
block" refusal to refuse, and a guard nothing can reach is not a rule. For the
same reason it **declares no spellcasting**: a stat block prints its spells as
English prose in a trait and `Monster` carries no ability, no list and no slots,
so reading one out would be the engine deciding a fact the SRD wrote for a
person. `declareSpellcasting` states it, and `declareCreatureSide` states the
allegiance, each in a second command — which is what those commands are, and a
second way to say either would be two answers to one question.

**It refuses exactly what the reducer would call corrupt and nothing more** — a
creature already in the game — and the refusal sits *below* the duplicate check,
because the command's own first run is what makes the world answer
`already_present`. `once` is why there is nowhere above it to write one.

**It spends nothing, so `mayAct` is not consulted**, and `DECLARED_NOT_ACTED` is
where that is written down and checked. `commands/creatures.ts` joined
`DECLARING_MODULES` on that sweep's own rule — *a module joins only when every
public command in it declares rather than acts* — so the five commands beside it
are accounted for too: damage, healing, an Exhaustion level, Temporary Hit
Points and a creature leaving are every one of them the **outcome** of something
that spent its own cost through its own command, which is `stabiliseCreature`'s
reading applied to the module. Filing `addCreature` there alone was not an
option; the scope is the module.

**`conditionImmunitiesOf` is the one gatherer, in `defensesOf`'s shape and
beside it**, and `applyConditionTo` reads it. That parameter used to be the
*caller's* to supply and **no caller in the engine ever supplied one** — every
call site passed the empty list. It survives as a caller's *addition*, unioned
rather than overriding: a caller may know an immunity the record does not hold
and none may take one away that it does. Removing it outright was the preference
and would have meant editing `commands/casting.ts`, which another builder held
in the same tranche. **`SpellEffectOptions.immuneTo` beneath it is gone** —
IE-053 held that file as a reader and made the deletion, so the only `immuneTo`
left is `applyConditionTo`'s own, and `applySpellEffect` passes it the empty
list.

**Suppression is deliberately not folded in.** SRD Aura of Courage says a
Frightened ally's condition "has no effect on that ally while there" — the
condition is still on them and comes back when they leave, which is what
`suppressedConditions` and `effectiveConditions` are for. An immunity refuses the
condition outright; a suppression lets it land and does nothing with it, and
merging them would get both wrong.

**An *implied* condition is not checked against the immunity, and that is a
residue rather than a decision.** `applyCondition` expands SRD's implication
table — Unconscious carries Incapacitated and Prone — in the **fold**, after
the command has asked about the condition the caller *named*. So a creature
immune to Prone and Incapacitated but not to Unconscious acquires both the
moment something makes it Unconscious, and the witness is a real stat block:
SRD's Swarm of Crawling Claws prints eleven conditions including Incapacitated
and Prone and **not** Unconscious. It is written down rather than fixed because
the book does not settle it — Unconscious "includes" the other two and nothing
says what an immunity to one of them does to that sentence, so filtering the
implications would be the engine answering a question the rules declined to
ask, and **a test freezing today's answer would be the same mistake in the
other direction**. The reading `TurnBudget.movementGained` already takes of an
open question. What is pinned instead is the *witness*: the stat block's list
and the implication edge that meets it, so the residue cannot quietly stop
being about a live case. It is narrow in practice — a monster `diesAtZero`, so
the hit-point route to Unconscious is mostly closed and what is reachable is
`applyConditionTo` and a `condition` effect naming it directly — and a ruling,
from errata or from the table, is what would end it.

**Inside a casting an immune creature is unaffected; the casting still
happens.** `applyConditionTo` refuses with `immune`, which is the right answer to
a DM who has said "make this creature Poisoned" — a verdict they asked for, the
spell lands and does nothing. It is *not* a verdict about the casting: Ray of
Sickness aimed at a Zombie still rolls its attack and deals its (immune,
therefore zero) Poison damage, and a whole spell refused because one clause could
not touch one target would be a rules bug in the other direction — worse, one
that also left the generator advanced with no events emitted. So the *decision*
stays in one place and `imposeCondition` in `commands/spell-resolution.ts` reads
its answer, for both condition sites, rather than each interpreting the code.
`held` is added **after** the attempt, because a condition that never landed put
nothing there for the casting to be holding — and what it is holding is half of
what `spellOn` answers.

**A qualified entry is withheld and reported, and this command is the only thing
that ever sees one.** "Charmed (except from its vampire master)" as a flat
immunity makes the vampire unable to charm the one creature the entry exists to
let it charm — so it stays out of `conditionImmunities`, the condition is
`allowed`, and the qualification comes back in `AddCreatureOutcome.unverified`
verbatim, beside any defence entry the adapter could classify as neither a damage
type nor a condition. It is reported at the moment the creature arrives rather
than carried in state, because the qualification is a rule the engine cannot
evaluate and has no business holding as though it could; carrying it so a later
casting can say so is a named next step rather than a gap left unsaid.

**The event field is optional and absent means none**, so both frozen logs fold
unchanged and neither fixture was regenerated — and a `conditionImmunities` an
*effect* grants is the seventh sourced-grant family, which belongs beside
`grantedDefenses` and not in this table, which is the creature's own and never
grows.

**`conditionApplicability` and `monsterCanReceive` still have no runtime
caller, and that is the honest residue rather than a half-finished job.** Both
take an `AdaptedMonster`, which is what the *adapter* returns and not what
state holds: a creature record carries the classification's **answers** —
`defenses` and `conditionImmunities` — and never the stat block it came from.
So the route a running game takes is `conditionImmunitiesOf`, and a second
reader that first re-adapted the monster would be the fold consulting the
bestiary, which is the fence `upgradeOngoing` stands behind. What `addCreature`
uses of the adapter is the whole classification — the two tables and the
qualified entries — where `conditionApplicability` answers about one condition
at a time. The three-valued answer it gives is therefore preserved by *where
each entry goes* rather than by that function being called: unconditional
entries into state, qualified ones into `unverified`, and nothing invented for
either. The day something holds an `AdaptedMonster` at the point of a
question — a summon, or a stat block a tool surface is inspecting before it
commits — is the day that function gets its caller.

**And two exemptions fell rather than being reworded**, which is what an
exemption naming the fact that would end it is for. `unknownCreature`'s request
said "a creature-added event for …" under a written reason ending "a barrel
command that adds a creature is what would end this exemption"; it names
`addCreature` now and `NAMES_AN_EVENT_ON_PURPOSE` is **empty**, so every context
request in the engine names a command a caller can send. And
`OUTSIDE_THE_COMMAND_LAYER` is four rather than five: `creation.ts` still emits
a `creature-added` too, and an event type is emitted once *something* writes it,
so a second writer neither adds nor removes an exemption.
