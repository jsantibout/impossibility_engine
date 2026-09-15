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
  it. The catalogue holds what those shapes express.
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
- A charge buys nothing yet: an item's pool is spent and regained, but what
  a wand's charge *does* needs the grant that resolves a spell or an effect
  list from an item — the largest single gap in the catalogue. Bonuses to
  spell attack rolls, ability scores an item sets, senses, curses and Speed
  from an item are each named and refused rather than half-built.
- Two copies of one item cannot be told apart: an inventory line is an id
  and a count, so a charged item is refused in multiples and a wand given
  away would not carry its charges. Items need a record of their own before
  transfer does.
- No carried weight, no ammunition spent. Objects that are not creatures
  are not modelled.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

The magic-item tranche's own digest is the best-evidenced list here: each of
the first three was hit by someone transcribing the book, not guessed from a
ranking.

1. **What a charge buys.** The grant that resolves a spell or an effect list
   from an item, at a printed level and DC, spending charges. Around ninety
   items wait on it, and roughly thirty more are worth transcribing only
   once it exists.
2. **Extra damage narrowed to the weapon that dealt it.** The field the flat
   bonus just got, on the neighbouring member — it finishes ten items already
   in the catalogue rather than unlocking new ones. Most of them also want a
   test of what the target *is*, which is a second and larger shape.
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
6. **Three small ones left over**: `rollInitiativeFor` returns a roll rather
   than events, so every caller hand-writes the one `rolls-issued` nobody
   should; `combat-started` raises no start-of-turn boundary, so a payout or
   an area trigger is missed when a fight opens on one; and a grant that
   reads a sibling feature's choice through a content-declared table blocks
   four species on its own.
