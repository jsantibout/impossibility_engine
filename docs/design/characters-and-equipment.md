# Characters, features, equipment, monsters

Read before changing `creation.ts`, `progression.ts`, `multiclass.ts`,
`character.ts`, `standing.ts`, `feature-schema.ts`, `origins.ts`,
`catalogue.ts`, `monster.ts`, `commands/features.ts` or
`commands/inventory.ts`.

## Three jobs, kept apart

| | Where | Knows |
|---|---|---|
| **Progression** — what a level grants | `progression.ts` (vocabulary) + a class definition (content) | nothing about any character |
| **Creation** — choices in, a validated character out | `creation.ts` | the content, the choices |
| **Execution** — doing what a feature does | `standing.ts`, `commands/features.ts`, the readers | the compiled sheet, never the class table |

A feature says which of the last two owns it: `automation: 'engine'` means a
reader executes it through its `grants`; `manual` means it is recorded and
the note says what a DM still applies. A feature executed through another's
declaration says so (`executedBy`), and a class's own `spellcasting` block
executes the feature it names. There is no third state.

## Creation and advancement

`checkCharacter(content, choices)` returns every problem, not the first.
`planCharacter` derives the sheet, pools, spellbook, inventory and
spellcasting routes; `createCharacter` emits `creature-added`,
`character-created`, the starting items and coins, the equip events (armour
pinned), and every pool. `advanceCharacter(state, content, id, advance)`
emits only the differences — the hit points gained, pools declared or
resized, the new sheet — so wounds, conditions and spent slots survive.

The choices are the character: they are stored on the creature, so a sheet
can be rebuilt and a level added to a record rather than a creature rebuilt.

## Classes and features are content

A `ClassDefinition` is a table (twenty rows), proficiencies, starting
equipment, a `multiclass` grant (what the class gives when it is not your
first), an optional `spellcasting` block (ability, style, `progression`
full/half or `feature: 'pact-magic'`, starting level) and features. A
`FeatureDefinition` carries one `FeatureGrant` or a list of them (normalised by
`featureGrants`; two of one kind only where the kind composes, and each may be
gated on one option of the feature's own choice) from a closed set —
`activated`, `standing`, `reaction`, `pool`, `recovery`, `expertise`,
`spells`, `unarmored-defense`, `extra-attack`, and the rest — plus what the
player chooses when they gain it. Creation compiles grants onto the sheet
(`standing`, `activated`, `recoveries`, `selfHeals`, `reactions`,
`unarmoredDefense`); readers evaluate them **from state on every read**, so
an aura stops the moment its holder is stunned without anything having to
remember to. A standing grant may bend a rule a command holds rather than a
number on the sheet: `hides-behind-larger-creature` widens the concealment
`takeHide` asks for, `half-proficiency-on-checks` joins the check bonuses,
`fall-damage-reduction` comes off a landing's dice when the faller elects it by
name, and `jump-bonus` lengthens a running Long Jump. A `reroll` Reaction names
the D20 Tests it answers and answers a failure only; `progression.ts` says why
Heroic Inspiration's "any die" is narrowed to that.

**A feature may ask more than one question.** `choice` became `choices` the way
`grants` did and for the same sentence: SRD Divine Order prints one heading over
two orders and gives one of them an extra cantrip, so which order and which
cantrip are two questions on one feature. The first carries no key and is
answered under the feature's own id, which is what every answer ever written is
keyed by and what a grant's `onlyIfChoice` reads; each one after it carries a
`key` and is answered under `<feature id>:<key>`, and may print an
`onlyIfChoice` of its own — a Protector is never asked which cantrip, so an
answer from one is refused rather than filed where nothing reads it. Every
reader goes through `featureChoicesOf`, because a feature that wrote only the
plural would otherwise vanish from validation and from creation without a word.
A grant written in terms of a keyed question names the whole key in
`choiceFrom`: the gate reads the primary answer of the feature that key names
and the grant's content reads the key itself, which is the one place the two
jobs of that field come apart.

Three words the species traits print and no class table could give. A pool
may be sized `perProficiencyBonus` — "a number of times equal to your
Proficiency Bonus" — at the *character's* level, grown by advancement like a
column; `poolSizeOf` in `creation.ts` is the one reader. An `activated` grant
runs to a turn anchor (`lasts`) **or** for a printed span (`lastsSeconds`),
exactly one: a span is scheduled on the clock in and out of a fight, is never
maintained (`extendFeature` refuses `not_extendable`), and may print a `size`
the holder is while it runs, which the fold's `settleSizes` derives onto the
map for as long as the creature holds such a feature. And an `action-rule`
allowance may carry a price — `spends`, a pool the feature declares beside it,
and `temporaryHitPoints`, a number or the Proficiency Bonus as it stands —
which the command taking the cheaper slot charges before anything is spent.
An `allows` rule may name `actions` rather than one `action` — one price
buying two (SRD Patient Defense: "both the Disengage and the Dodge actions as
a Bonus Action"): the first action taken charges the slot and the price and
hands the rest to the turn as narrowed `GrantedAction`s. Where a creature
holds two allowances for one pair, `allowsPrice` prefers the unpriced one, so
a Rogue with Cunning Action is never charged an Orc's Adrenaline Rush for a
Dash the book gives free; a caller wanting the priced one's benefit names it
(`usingFeature`). A size a feature prints is read by every rule that asks
through `effectiveSizeOf` — printed, then stated, then the map's — so a
Goliath in Large Form is Large to a Grapple and not only on the map.

A `spells` grant's `freeCasting` may name a sibling feature's pool (SRD Wild
Companion spends Wild Shape's), print the slot route beside the free one
(`withSlots`), fix a `choiceStated` value (`fixesChoice`) and put a Long Rest
lifetime on the summons it calls (`keptUntilSummonerLongRests`); `GrantedSpell`
carries all four onto the route, and `choosePayment` still asks which price.

**A use may also hang a grant that is stored rather than derived**, which is
the other half and the one a roll can spend. A derived grant is recomputed
from state, so nothing can consume it: `consumedRollModifiers` reads stored
state, and a `oneShot` written on a derived grant is never spent. So
`ActivatedFeature.hangs` is emitted where the price is paid — SRD Steady Aim's
Advantage on the next attack, and the Speed of 0 that comes with it — as the
`roll-modifier-granted` and `speed-modifier-granted` the engine already
writes, on the timer `commands/mastery.ts` files for Sap and Vex. Derived
grants say what a feature **permits**; hung grants are what a use **spends**.

Each clause of a hung grant carries **its own source**, and that is not
tidiness. `roll-modifier-consumed` folds to `releaseGrants`, which drops
everything one source granted, across every grant family at once — so under a
shared source the attack that spent Steady Aim's Advantage would have handed
back its Speed as well. One source and one timer per clause, and the validator
refuses two hung grants of one kind.

Multiclass rules read the definitions: caster level from each class's
`progression`, Pact slots from any class whose feature is `pact-magic`, hit
dice pooled by die type, a later class's proficiencies from its own
`multiclass` grant. The Multiclass Spellcaster slot table is the one printed
rule the engine transcribes itself (`MULTICLASS_SPELL_SLOTS`), and the SRD
content's tests hold every full caster's own table against it.

**A class may redefine its own strike.** A `strike-style` grant names a set of
weapons beside the holder's Unarmed Strike, a die read off the class table and
rolled in place of their normal damage, an ability offered in place of the
attack's own, and a Bonus Action strike. It is one grant because the SRD
prints one gate over three clauses. The die is a default and the ability is a
choice, and the asymmetry is the SRD's: the ability is read past the roll, so
there is a reason to elect the worse score; nothing reads which die was
thrown. What it is *not* is the extra attacks inside one Attack action, which
remains the gap filed above it. A class's **Monk weapons** and its **weapon
proficiencies** are two declarations because the book prints two sentences
that differ — a Monk is proficient with a Light Crossbow and it is not a Monk
weapon — so the set lives on the feature rather than on the proficiency list.

**A pool may carry a menu.** `heals` and `touchHeals` already say what one use
buys; `options` is the third answer and it is an effect list; `confersReaction`
is the fourth — a Reaction handed to somebody else, which is the Bard's die —
and `buysBudget` is the fifth, which is room in the turn's own budget: the
Fighter's second action and the Monk's two Unarmed Strikes. Each arrived the
same way and for the same reason. It is a list
rather than a grant of its own because the SRD prints one feature whose uses
buy different things, and a menu is one grant. Dice scale on
the class table through `diceCountByLevel`, because every `DiceScaling` field
reads a slot or a caster level and a pool use spends neither.

**A feature may turn its holder into another creature.** A `shape-shift` grant
is SRD Wild Shape: it declares its pool the way `activated` does, names the
creature type a form must print, carries the Beast Shapes table as rows read at
the class level (how many forms are known, the Challenge Rating ceiling, whether
a flier may be taken), and says how the hours and the Temporary Hit Points scale
with the level and which scores the holder keeps. The forms a character *knows*
are `CharacterChoices.knownForms`, checked at creation against that row. A use
(`assumeShape`) lays the block's `adaptMonster` sheet over the character's
through `assumeStatBlock` — the block's scores, Armour Class, Speeds and printed
lines; the holder's level, kept scores, proficiencies and every compiled
feature list; each save and printed skill the higher of the two — pins the
merged sheet whole on `shape-assumed`, and files a `feature` timer in hours.
`CreatureState.shape` holds what was replaced, and the fold's `settleShapes`
puts it back the moment the feature leaves `activeFeatures`, so the deadline, a
second use, Incapacitated, death and the Bonus Action that leaves early are one
mechanism. Gear merges and is silent (`itemStandingOf` reads `shape`), the
Armour Class is always the block's, and the scene's copy of the size follows
the form — the owner's rulings of 2026-09-20.

## Equipment

Items are content (`CatalogueItem`: id, kind, price in copper, weight, the
armour or weapon record, and — for the magic ones below — grants, an
attunement requirement, a charge pool and what it leaves to the table).
Inventory is owned, `equipped` is worn or held, and the sheet's armour is a
**view** of what is equipped, derived in the fold from the armour record the
equip event pinned. Purchases price the bundle the SRD prints; packs open
into their contents.

**Hands are a count, not a pair of slots.** `CharacterSheet.hands` is absent
for two, which is the only number the SRD ever assumes; `handsFor(item)` reads
the printed record rather than a list — Two-Handed is two, a Shield one, body
armour none, and Versatile one, because what Versatile changes is the damage.
`equipItem` refuses `no_free_hand` for the same reason it already refuses a
second shield.

**A conjured thing is an inventory line with a casting on it.** A definition's
`conjures` names an item, a count and the hands the handful takes; the
resolution refuses `no_free_hand` before any slot, action or die, and pins the
line into `items-gained`. **Its lifetime is derived rather than folded**: a
casting that runs out of time writes no event a removal could hang on, so
`carrying` filters a lapsed line exactly as a lapsed patch of Difficult
Terrain is filtered. Goodberry's ten berries and Flame Blade's blade are the
two the SRD prints, and `let_go_of_conjured` / `evoke_conjured` are the two
halves of Flame Blade's own sentence.

## Monsters

`adaptMonster(monster, id)` turns a parsed stat block into a fightable
creature: printed numbers are carried as *stated* rather than derived, the
creature type reaches state, unconditional defences and condition immunities
apply, and qualified ones ("except from its vampire master") are withheld and
reported. `addCreature(state, content, id, monsterId)` takes the stat block's
**id** and reads the block out of content, mirroring `equipItem`. A monster is
content like an item: `SRD_CONTENT` carries the printed bestiary and homebrew
enters through `loadContent`/`extendContent`. The id rather than the value
because an entry point that accepts a stat block is a door a model-authored
Armour Class walks through and nothing guards it — `boundary.test.ts` proves
the external-roll functions unreachable by name, and a value parameter is on
nobody's list. `unknown_monster` was withheld while there was nothing to look
one up in; it is a rule now. What the command reads is pinned whole into
`creature-added` — the sheet, the printed numbers, both halves of the defence
run and the size — so the fold still opens nothing.

**A printed saving throw is read as an effect list.** `parsePrintedSave`
(`packages/srd/src/parse/printed-save.ts`) reads a line's `_Failure:_` into a
small vocabulary — damage and a second `plus` component, a condition to a turn
anchor on the source or the target or for a span, a grapple with its escape DC,
a size gate, a push straight away, a Speed cut, a Hit Point maximum lowered by
the damage taken, a save repeated at the end of the target's turns with a
minute's cap — and carries every sentence it did not read verbatim in
`handedOver`. Only a line under Actions or Bonus Actions is read: a trait's
save is forced by a moment in somebody else's turn, not by a use, so the door
that spends a line cannot reach it. The failure clause must start with
something the engine spends or the whole line stays prose (a die thrown for
nothing is the defect this repository calls its worst), graded failures are
refused whole, and each sentence is read transactionally. `forcePrintedSave`
executes the vocabulary through the primitives the casting path already has
(`applyPrintedClauses` in `commands/printed-save-clauses.ts`): the grapple is
the grapple `escapeGrapple` answers, the push is `shoveAwayFrom`, the Speed cut
a `grants` timer, the lowered maximum a negative `hit-point-maximum-adjusted`
sourced per use so two bites stack. An immune target is named in the outcome
rather than skipped, a size gate that spared a creature says so, and the
carried sentences come back in `unverified` at the moment of use. The ledger
keeps a block whose save carries a sentence on its books
(`SAVE_HANDOVER_SHAPE`), because reading a sentence never retires the debt of
executing it.

## Magic items

Decided before any of them was built, and counted rather than guessed: every
item the SRD prints was read against the grant vocabulary one at a time. A
small minority were expressible as the vocabulary then stood, most needed one
of a few named additions, and a long tail are not grants at all. Those
proportions moved the same day the flat bonus landed — twice — which is why
counting them is the report's job and not this note's.

**A magic item is a `CatalogueItem` that has grown three things**, not a
fourth population beside spells and classes: grants written in the existing
`FeatureGrant` vocabulary, an optional attunement requirement, and an
optional charge pool declared through the existing `pool` shape. The SRD
argues the same way — a magic weapon is "a magical version of" the equipment
entry — and `Content.item(id)` has eleven readers outside tests, every one of
which a separate population would have to be threaded through before a +1
longsword could be swung.

**Attunement is a relation on the creature, not a ninth sourced grant.** The
ten families `grantsOf` enumerates are running effects *hung* on a creature:
stored, unconditional, ended by a source match. A worn item's benefit is the
other lifetime — the conditional kind `standing.ts` already insists must be
derived on every read, because "a stored copy would be an unconditional bonus
wearing a feature's name". So `attuned` is one sorted list beside `equipped`,
"while attuned" and "while worn" are two new `StandingRequirement` members
beside `unarmored` and `has-speed`, and the whole release path —
`releaseCasting`, `releaseGrants`, `holdsNothingOf`, `spellOn` — is untouched.

**Charges are the pool mechanism reused.** `resources.ts` already names "a
magic item with seven charges" as a designed use, `Recovery` already includes
`dawn`, and a class pool already recovers on it end to end. What is missing is
only that some items regain a *rolled* number rather than refilling, which is
a field beside `regainsOnShortRest` and a roll the engine makes.

**"The next dawn" is declared, never derived.** The clock has no calendar and
no time of day — those are fiction, and the DM owns them — and the SRD hands
the moment to the GM in as many words. Dawn is a command that emits the
restoration the rests already emit, with no span and no movement of the
clock.

An item copy **has** an identity now. An inventory line may carry an
`instance`, minted from a counter on the state and *verified* by the fold
rather than assigned there, the way a casting id already is; a line without
one is the counted stack it has always been, so arrows are untouched. Only a
copy whose catalogue record has state of its own is born labelled — today,
one with a charge pool, whose key is the copy rather than the item, declared
when the copy is gained rather than when it is equipped. So two wands no
longer share a pool, and one put down keeps what it had left.

A copy also **moves**. `transferItem` hands one creature's copy to another and
its pool travels whole, spent charges included, read off the giver's own keys
rather than out of a catalogue; `awardItems` is the door a DM hands a party
what it found, and where the book rolls a count it is rolled once at the
copy's birth and pinned. There is one gain semantics — `equipItem` declares no
pool of its own any more — and a sweep pins the doors a copy arrives through
so a fourth cannot be quiet about labelling.

One thing a brief still has to decide: what ends attunement besides a command
— death, losing the item, another creature attuning to it.
