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
`FeatureDefinition` carries at most one `FeatureGrant` from a closed set —
`activated`, `standing`, `reaction`, `pool`, `recovery`, `expertise`,
`spells`, `unarmored-defense`, `extra-attack`, and the rest — plus what the
player chooses when they gain it. Creation compiles grants onto the sheet
(`standing`, `activated`, `recoveries`, `selfHeals`, `reactions`,
`unarmoredDefense`); readers evaluate them **from state on every read**, so
an aura stops the moment its holder is stunned without anything having to
remember to.

Multiclass rules read the definitions: caster level from each class's
`progression`, Pact slots from any class whose feature is `pact-magic`, hit
dice pooled by die type, a later class's proficiencies from its own
`multiclass` grant. The Multiclass Spellcaster slot table is the one printed
rule the engine transcribes itself (`MULTICLASS_SPELL_SLOTS`), and the SRD
content's tests hold every full caster's own table against it.

## Equipment

Items are content (`CatalogueItem`: id, kind, price in copper, weight, the
armour or weapon record, and — for the magic ones below — grants, an
attunement requirement, a charge pool and what it leaves to the table).
Inventory is owned, `equipped` is worn or held, and the sheet's armour is a
**view** of what is equipped, derived in the fold from the armour record the
equip event pinned. Purchases price the bundle the SRD prints; packs open
into their contents.

## Monsters

`adaptMonster(monster, id)` turns a parsed stat block into a fightable
creature: printed numbers are carried as *stated* rather than derived, the
creature type reaches state, unconditional defences and condition immunities
apply, and qualified ones ("except from its vampire master") are withheld and
reported. `addCreature(state, id, monster)` takes the stat block itself,
because there is no monster registry to look one up in — a stat block is
data handed to the engine, like everything else.

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
eight families `grantsOf` enumerates are running effects *hung* on a creature:
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

Two things a brief still has to decide: **transfer** — `equipItem` still
declares a catalogue-keyed pool for an *unlabelled* copy, because no command
exists for a DM to hand a party what it found, and the commit that adds one
must delete that branch in the same breath or the engine has two gain
semantics (a test pins the two doors so a third cannot arrive quietly) — and
what ends attunement besides a command — death, losing the item, another
creature attuning to it.
