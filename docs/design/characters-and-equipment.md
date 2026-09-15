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

Items are content (`CatalogueItem`: id, kind, price in copper, weight, and
the armour or weapon record). Inventory is owned, `equipped` is worn or
held, and the sheet's armour is a **view** of what is equipped, derived in
the fold from the armour record the equip event pinned. Purchases price the
bundle the SRD prints; packs open into their contents.

## Monsters

`adaptMonster(monster, id)` turns a parsed stat block into a fightable
creature: printed numbers are carried as *stated* rather than derived, the
creature type reaches state, unconditional defences and condition immunities
apply, and qualified ones ("except from its vampire master") are withheld and
reported. `addCreature(state, id, monster)` takes the stat block itself,
because there is no monster registry to look one up in — a stat block is
data handed to the engine, like everything else.
