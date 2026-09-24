# Content: what a world holds, kept out of the engine

Read before changing `content.ts`, the definition vocabulary at the top of
`spell-definitions.ts` or `progression.ts`, either validator, or anything in
`packages/content`.

## The boundary

The engine owns **mechanics**: the closed vocabularies a spell effect, a
feature grant or an item can be written in, and the rules that execute them.
It owns **no catalogue**. Every spell, class, subclass, feature, species,
background, feat, item, monster, language and alignment is content, supplied
by the caller as one immutable, validated `Content` value.

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
effect — all three riders are welded to a casting; and, on a conferred
condition, a lifetime that outlives a casting there is none of, a check, a
second duration, or an end trigger that is malformed, names an unknown cause,
or ends no condition. A conferral may print a DC and be rolled against, may
impose a condition that its own timer ends — on its deadline, or early on a
cause the item's line prints — and may be paid for out of the item's own
charges, at a fixed price or within a range above it. **The `save` kind
carries its repeat**, because a repeat save names whatever put the condition
there rather than a casting id; what such a repeat may not say is
`end-casting`, which is refused at every door that could write one rather
than quietly read as something else.

## Text the DM decides, and how to tell it from a debt

Some printed text is not a mechanic the engine has yet — it is a fact only a
person at the table can supply. A definition declares those sentences in
`dmDecides`, and a Range the format cannot state declares `{ kind: 'dm' }`
(Dream's `Special`, Mirage Arcane's `Sight`). The casting still spends its
slot, holds its Concentration and pins what it reads; only the unstatable part
is handed over, reported under a mark nothing else writes. A definition that
declares a `dm` Range without printing what the book actually said is refused
(`silent_dm_range`), and one that spells the mark itself in either list is
refused too (`forged_dm_mark`).

**A handover is not `unmodelled`, and the difference is the point.** An
`unmodelled` line is a **debt**: the blocker map ranks it, and one day somebody
pays it by building the shape. A handover will never be paid. Filing a handover
as a debt puts work on a list nobody should do and inflates the map with
entries that are blocked on nothing.

The test, which a reviewer named after eight spells had been sorted by it:

> **A table fact that a rule then reads is a debt; a table fact nothing reads
> afterwards is a handover.**

So Augury's omen is a handover — the GM chooses it and no rule consults the
choice. Awaken's statistics are a debt, because a stat block is read by
everything afterwards. Teleportation Circle's sigil sequence is "determined by
the GM" and still a debt, because the same line carries 365 days of daily
casting that nothing counts. A line can be both a mechanism the engine lacks
and a decision only the DM can make; say so rather than forcing it into one.

Two guards keep the reading checkable rather than a matter of taste: a
handed-over sentence must trip none of the mechanical markers, and must not be
a sentence the tracked map already anchors a **debt** to — a `'table'` entry is
not one, because that entry *is* the record of this reading. The marker rule
has one way past it and it is a reading rather than an exemption: a marked
sentence may be handed over where the tracked map anchors a `'table'` entry to
it, so the argument lives in the map with a note somebody can re-run. Four SRD
sentences take that door — Meld into Stone's three, and See Invisibility's
sight of the Invisible condition — where the marker fires on a real word and
what makes the sentence the table's is the fact underneath it.

A handover reaches the
log for a long casting, which pins it on `spell-declared`; for an **atomic**
casting it reaches the caller and not the log, which is a known limit recorded
in the `dmDecides` doc comment.

**A tracked definition is finished when its whole text is here.** A spell the
engine resolves nothing of is honest while it says what it leaves the table,
and *which list it says it in* is the claim: `unmodelled` puts the spell on the
road to zero and `dmDecides` takes it off. So a spell read to the end carries
its printed text here and prints no `unmodelled` line at all, and `LEDGER.md`
counts it apart from the population it ranks. What that reading may not do is
stop at the paragraph: Gentle Repose looks like fiction about a corpse and one
of its sentences widens the window `revive` measures, so it stays a debt.

## Adding content

A spell that fits an existing effect kind, or a class whose features use
existing grant kinds, is data: write it, run it through `loadContent` (or add
it to `packages/content` if it is SRD), and the engine executes it. A spell
or feature that needs a mechanic the engine lacks is engine work first: add
the kind, its resolver or reader, and its validator rule, with tests; then
the content.

A feature may also reach into a casting's own arithmetic. `casting-damage` is
a `StandingGrant` whose `when` says which castings it reaches — a spell, a
school, the class the route went through, a damage type, a band of slot levels
— and whose `alters` says what it does to what they deal: an ability modifier
added to one damage roll, a die substituted, a floor under a miss or a made
save, or every die at its maximum. Only the first has two SRD writers; the
other three are each one feature's own sentence and say so. What such a
feature alters is **pinned as altered** — the die a rider carries is the die
the log says — so the rule the fold depends on is unchanged. An optional one
is named on the casting through `usingFeatures`, which carries no number: the
caller states that the caster is using a feature they hold, and the engine
does the arithmetic.

Content-specific assumptions the engine may **not** grow back: class names
as strings, feature ids as strings, spell ids compared to literals. The
sweep in `spell-schema.test.ts` holds the spell and class half of that and
fails on any of them; `origin-and-feature-sweep.test.ts` holds the species,
background, feat and feature half the same way, and records the two breaches
it found the day it was written rather than exempting them. Subclass ids, and
language and alignment names, are still held by review and by nothing else.
