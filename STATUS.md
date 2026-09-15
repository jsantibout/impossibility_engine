# Status

What runs, what does not, and what comes next. Counts are in `COVERAGE.md`
(`npm run coverage`), never here.

## What runs

A pure, deterministic, event-sourced rules engine for D&D 2024 (SRD 5.2.1),
with the SRD catalogue as a separate content package and the same door open
to homebrew.

- **Dice and rolls** — seeded, replayable, every roll with provenance; the
  D20 pipeline with named modifiers and attributed advantage; typed damage
  against per-type defences; criticals; reaction windows held open.
- **Creatures** — derived character sheets, stated monster sheets, all
  fifteen conditions with sources, hit points, temporary hit points, death
  saves, exhaustion.
- **Space** — a cube lattice, distance between volumes, declared sight and
  cover, six area shapes, persistent and carried areas, teleportation,
  mounting.
- **Combat and time** — Initiative, the action budget, joining a running
  fight, the clock, spans and turn-anchored deadlines, repeat saves and
  delayed damage raised by the boundary, payouts a casting makes at one,
  Short and Long Rests.
- **Casting** — slots and Pact slots as pools, castings with identities,
  Concentration, interruptible declared castings, long castings and rituals,
  reaction spells, ongoing records that later activations act through.
- **Spell execution** — the effect kinds and three rider kinds; the SRD
  spells the catalogue defines run end to end.
- **Characters** — all twelve SRD classes with their SRD subclass, all nine
  species and all four backgrounds, creation and advancement validated
  against the book, multiclassing, feats recorded and a few executed,
  features executed where a reader exists and honestly marked `manual`
  where not.
- **Content** — `createContent` / `loadContent` validate a catalogue from
  typed input or JSON; `SRD_CONTENT` is built through it; a homebrew spell or
  class using existing mechanics needs no engine change (`content.test.ts`).
  Languages and alignments are content too, so a world may declare its own
  tongues, its own alignment axis, or none.
- **Magic items** — an item carries grants that are live while it is worn
  and, when it says so, while it is attuned; attunement is capped, asks for
  its prerequisites and costs a rest; charges are pools that refill at a
  declared dawn, some by a roll the engine makes; a flat bonus is narrowed
  to the item that gave it, so a +1 sword does not improve the bow beside
  it; and a charge buys a casting — a wand's spell has an id, Concentration
  when the definition asks for it, and an ongoing record Dispel Magic can
  find. The catalogue holds what those shapes express.
- **Replay** — a scripted four-round fight and two frozen logs fold
  byte-identically.

## What does not

- No tool surface, orchestration, persistence or web app. The engine has no
  idea a language model exists, which is the point; the layer above it is
  the next milestone.
- Spells whose text needs a mechanic the engine lacks are *tracked* (cast,
  costed, timed, and the effect left to the table) rather than executed;
  `COVERAGE.md` lists which and names the missing shape.
- Most class features past the common shapes are `manual` with a note.
- Species and background traits past the shapes that already exist are
  `manual` with a note — Darkvision, breath weapons, ancestry tables,
  lineage spells.
- Feats: the origin and fighting-style feats, recorded, two executed — and
  uncounted, because a `FeatDefinition` declares no automation and the report
  refuses to guess at one.
- **Every spell attack roll is wrong.** `attackModifier` treats a spell
  attack as an unarmed one: it adds the caster's Strength modifier and a
  second Proficiency Bonus on top of the spell attack bonus the caster
  already built. A level-5 wizard's Fire Bolt is +9 where the book says +7,
  and a strong cleric's is further out. Long-standing, and the suite did not
  catch it because the spell-attack tests assert the engine's arithmetic
  rather than the book's.
- An item that confers an effect *without* casting — every potion, and the
  items that simply deal damage or grant a save — needs a second grant kind
  and a source that is not a casting. The largest gap left in the catalogue.
  Bonuses to spell attack rolls, ability scores an item sets, senses, curses
  and Speed from an item are each named and refused rather than half-built.
- Two copies of one item cannot be told apart: an inventory line is an id
  and a count, so a charged item is refused in multiples and a wand given
  away would not carry its charges. Items need a record of their own before
  transfer does.
- No carried weight, no ammunition spent. Objects that are not creatures
  are not modelled.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

1. **Fix the spell attack roll.** It is the only outright wrongness in the
   engine's arithmetic rather than a gap in it, it predates this milestone,
   and every spell attack and every item casting rides on it. The tests that
   should have caught it assert the engine's sum rather than the book's, so
   the fix is a reading of the SRD sentence first and a code change second.
2. **An item that confers an effect without casting one.** Every potion, and
   the items that simply deal damage or grant a save: a second grant kind,
   and a source that is not a casting but which the release path can still
   address. The largest gap left in the catalogue.
3. **An item's own record.** An inventory line is an id and a count, so two
   wands share a pool, a charged item is refused in multiples, and nothing
   can be given away with its charges. It also blocks a rolled charge
   maximum and every item whose benefit the GM picks when it is found.
4. **The tool surface** (`@ie/tools`): the Zod-validated commands a DM or a
   model calls. Its session boundary is decided —
   `docs/design/claude-integration.md` — and `tools/llm-probe` already drives
   a live model through a smaller version of it, so this is promotion more
   than authorship.
5. **Content as files**: a loader in the app layer that reads homebrew JSON
   (and, later, a database) into `loadContent`.
6. **Three small ones left over**: a fight that opens on a per-turn payout
   still does not pay it, and a passing test at the foot of
   `opening-boundary.test.ts` names the three ways to close it; nothing
   mechanically stops a module outside `fold/` importing `fold/*`, which is
   a rule `events.ts` states and a reviewer had to catch by reading; and a
   grant that reads a sibling feature's choice through a content-declared
   table blocks four species on its own.
