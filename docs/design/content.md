# Content: what a world holds, kept out of the engine

Read before changing `content.ts`, the definition vocabulary at the top of
`spell-definitions.ts` or `progression.ts`, either validator, or anything in
`packages/content`.

## The boundary

The engine owns **mechanics**: the closed vocabularies a spell effect, a
feature grant or an item can be written in, and the rules that execute them.
It owns **no catalogue**. Every spell, class, subclass, feature, species,
background, feat, item, language and alignment is content, supplied by the
caller as one immutable, validated `Content` value.

| | Where |
|---|---|
| The vocabulary (`SpellDefinition`, `SpellEffect`, `FeatureGrant`, `ClassDefinition`, `CatalogueItem`, …) | `@ie/engine` |
| The validators (`checkSpellDefinition`, `checkFeatureDefinition`, `checkContent`) | `@ie/engine` |
| The registry (`createContent`, `loadContent`, `extendContent`, `emptyContent`) | `@ie/engine/content.ts` |
| The SRD 5.2.1 catalogue (`SRD_CONTENT`) | `@ie/content` |
| A DM's homebrew | wherever it is authored; it arrives as JSON through `loadContent` |

Both catalogues go through the same call and the same checks. `@ie/content`
has no privileged path: `SRD_CONTENT` is `createContent(SRD_CONTENT_INPUT)`,
and `content.test.ts` proves the input round-trips through JSON and
`loadContent`.

## What a `Content` answers

`spell(id)` — the executable definition, or null. `spellEntry(id)` — the
spell's identity and class lists (the SRD index shape), whether or not it
executes. `classById`, `subclassById`, `speciesById`, `backgroundById`,
`featById`, `item`, `expandPack`, plus the arrays behind each.
`languageNamed` and `alignmentNamed` are the two looked up by the name on a
character sheet rather than by id, because the name is what a choice carries
and what a stored log already holds. A definition with no entry still exists
and can be cast; it is on nobody's class list until an entry says whose.

## How it reaches the engine

- Rolling commands take a `Supply` — `{ issuer, rng, content, modes?, bonuses? }`.
- Read-only commands take `content` explicitly after the state.
- Creation takes it first; advancement takes it after the state.
- The fold takes none. A command pins what it read into its events (a
  casting's area and numbers, an equip event's armour record), so a stored
  log folds the same under any catalogue. The two frozen fixtures predate
  pinning and are folded with `fold(seed, events, SRD_CONTENT)`; a log this
  engine writes never needs the third argument.

## What `checkContent` refuses

Every problem, with a path: a malformed spell or feature (the two
validators), a duplicate id anywhere, a subclass naming an absent class, a
class table that is not twenty rows, a Spellcasting class that does not say
whether it is a full or half caster (`spellcasting.progression`), a Pact Magic
class that does, a fixed spell grant or granted feat naming nothing, an
`executedBy` naming a sibling that declares nothing, a pack containing an
absent item, two languages or two alignments sharing a name (`duplicate_name`,
the coherence a name-keyed lookup needs). It does **not** ask whether content
is official; that is the SRD oracle's question and it lives with the SRD
content.

Two later shapes are refused by the same rule — a reference must reach
something, and a table must answer for every option it claims to. A feature
whose choice carries a meaning per option is refused a table on a feature that
asks nothing, a table that misses one of its options or holds a key that is not
one of them, and a meaning of a shape the vocabulary does not know; a grant
reading a **sibling's** choice is refused a feature that does not exist on this
source, one that is itself, one that asks no choice, one that arrives at a
later level than the grant that reads it, and a table supplying nothing the
reading grant came for. An item that confers an effect without casting one is
refused an effect kind a conferral cannot resolve, one that scales by a slot or
a caster level an item does not have, a lifetime that ends nothing, a grant
hung with no lifetime at all, a save DC on a conferral where nothing rolls
against it and a conferral that rolls without one, a rider on a conferred
effect — all three riders are welded to a casting — and, until it is built, a
charge count. A conferral may now print a DC and be rolled against; what a
save may still not do is impose a condition, and that is the fold's weld
between a condition and a casting rather than anything about the DC.

## Adding content

A spell that fits an existing effect kind, or a class whose features use
existing grant kinds, is data: write it, run it through `loadContent` (or add
it to `packages/content` if it is SRD), and the engine executes it. A spell
or feature that needs a mechanic the engine lacks is engine work first: add
the kind, its resolver or reader, and its validator rule, with tests; then
the content.

Content-specific assumptions the engine may **not** grow back: class names
as strings, feature ids as strings, spell ids compared to literals. The
sweep in `spell-schema.test.ts` holds the spell and class half of that and
fails on any of them. The species and feature half is held by review and by
nothing else — a gap noticed while the sibling-choice grant was built, and
worth closing with a test rather than a habit.
