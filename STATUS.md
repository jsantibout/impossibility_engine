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
  delayed damage raised by the boundary, payouts a casting makes at one —
  the boundary a fight opens on included — Short and Long Rests.
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
  find. An item may also confer an effect **without** casting one: a potion's
  effects run through the same resolvers under a source that is a bare
  `item:` string rather than a casting id, so the ordinary timer expires it
  and the ordinary command ends it early, while Dispel Magic and the ongoing
  records pass it by without being told to. The catalogue holds what those
  shapes express.
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
  `manual` with a note — Darkvision, breath weapons, lineage spells. An
  ancestry table is no longer among them: a trait may read the choice its
  sibling made and look it up in a table content declares, which is what
  Dragonborn's Damage Resistance is written in terms of.
- Feats: the origin and fighting-style feats, recorded, two executed — and
  uncounted, because a `FeatDefinition` declares no automation and the report
  refuses to guess at one.
- A conferral carries the shapes a potion needs and refuses the rest by name:
  an item that grants a save, one paid for with charges, and one that inflicts
  a condition are each still ahead. The last is the deepest — the fold welds a
  condition to a casting, and reads one without a casting id as a corrupt log.
  Bonuses to spell attack rolls, ability scores an item sets, senses, curses
  and Speed from an item are each named and refused rather than half-built.
- A flat amount cannot be written where dice are expected: `DiceScaling` makes
  its notation required, so Potion of Heroism's ten Temporary Hit Points are
  in its `unmodelled` note rather than in its grant. Temporary Hit Points also
  have no lifetime of their own — the event carries no source and no effect
  target names them — so the hour they last is a note as well.
- Two copies of one item cannot be told apart: an inventory line is an id
  and a count, so a charged item is refused in multiples and a wand given
  away would not carry its charges. Items need a record of their own before
  transfer does.
- No carried weight, no ammunition spent. Objects that are not creatures
  are not modelled.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

1. **An item's own record.** An inventory line is an id and a count, so two
   wands share a pool, a charged item is refused in multiples, and nothing
   can be given away with its charges. It also blocks a rolled charge
   maximum and every item whose benefit the GM picks when it is found.
2. **The tool surface** (`@ie/tools`): the Zod-validated commands a DM or a
   model calls. Its session boundary is decided —
   `docs/design/claude-integration.md` — and `tools/llm-probe` already drives
   a live model through a smaller version of it, so this is promotion more
   than authorship.
3. **Content as files**: a loader in the app layer that reads homebrew JSON
   (and, later, a database) into `loadContent`.
4. **The rest of what an item confers.** A conferral that costs charges, one
   that grants a save, and one that inflicts a condition. The third needs the
   fold's weld between a condition and a casting broken first, and is the
   larger piece of work.
5. **Two the potion asked and could not answer.** Whether `DiceScaling` should
   admit an amount with no dice in it — a flat ten is a shape the book writes
   often — and whether Temporary Hit Points should carry a lifetime, which
   needs either a new effect target or a new event. Both are decisions before
   they are work.
6. **Rule 4's other half has no test.** The sweep in `spell-schema.test.ts`
   fails on a class name or a spell id in engine code; a species id or a
   feature id is caught by a reader and by nothing else. A sweep, on the
   pattern of the one beside it.
