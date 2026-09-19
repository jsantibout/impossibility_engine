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
  records pass it by without being told to. **The weld between a condition and
  a casting is gone**: a repeat save names whatever put the condition there
  rather than a casting id, so a conferred `save` imposes its condition against
  the DC the item prints and the boundary raises its repeat like any other,
  and a success under a source that is not a casting ends the condition and the
  deadline that was holding it. An item may also cast a spell the book prices
  at nothing, and narrow the spell it casts to its own holder. The catalogue
  holds what those shapes express.
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
- A conferral carries the shapes a potion needs and refuses the rest by name.
  Bonuses to spell attack rolls, ability scores an item sets, senses, curses
  and Speed from an item are each named and refused rather than half-built.
  A conferral may be paid for with the item's own charges, at a fixed price or
  within a range — but no SRD entry comes off that alone: Staff of Striking's
  extra die per charge needs dice that scale with the *charge count*, and every
  scaling field the vocabulary has reads a slot or a caster level. That
  scaling, and a charge spent on something no grant kind executes, are what is
  still ahead for an item that confers.
- Temporary Hit Points have no lifetime of their own — the event carries no
  source and no effect target names them — so the hour Potion of Heroism's ten
  last is a note rather than a deadline. **What they should do is no longer an
  open question**: unless the granting effect prints a duration, they last
  until they run out or until the creature holding them finishes a Long Rest.
  Only the mechanism is missing. The ten themselves are in its grant:
  an amount may now be a printed number with no dice in it, which the two
  scaling fields that add dice to a notation refuse and the one that adds a
  flat number does not.
- Two copies of one item cannot be told apart: an inventory line is an id
  and a count, so a charged item is refused in multiples and a wand given
  away would not carry its charges. Items need a record of their own before
  transfer does.
- No carried weight, no ammunition spent. Objects that are not creatures
  are not modelled.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

1. **An item's own record, step one.** An inventory line is an id and a count,
   so two wands share a pool and nothing can be given away with its charges.
   The shape is decided: the line gains an optional engine-issued `instance`,
   minted from a counter the fold *verifies* rather than assigns — the
   discipline `castingsBegun` already uses — and a charge pool moves to the
   copy and to the moment the copy is gained. Only items with per-copy state
   are born instanced, so mundane stacks do not move, and neither frozen log
   does either. Transfer and an award command that can roll a charge maximum
   are steps two and three.
2. **The tool surface** (`@ie/tools`): the Zod-validated commands a DM or a
   model calls. Its session boundary is decided —
   `docs/design/claude-integration.md` — and `tools/llm-probe` already drives
   a live model through a smaller version of it, so this is promotion more
   than authorship.
3. **Content as files**: a loader in the app layer that reads homebrew JSON
   (and, later, a database) into `loadContent`.
4. **A lifetime for Temporary Hit Points.** The rule is settled — unstated
   ones last until spent or until the end of a Long Rest — and what it needs
   is a way to hang a deadline on them: either an effect target that names a
   creature's temporary Hit Points or an event that carries their source.
5. **Two breaches a sweep found and left standing.** `creation.ts` reads one
   feat by name and pays out the Initiative bonus itself, which is Rule 4
   mechanically and needs a way for a feat to confer that bonus through the
   grant vocabulary; and `feature-schema.ts` teaches its id format with a live
   SRD feature as the example, which is one word. Both are on the record in
   `origin-and-feature-sweep.test.ts`, which fails if either changes.
6. **Dice that scale with what was spent.** Every scaling field reads a slot
   or a caster level, so Staff of Striking's extra die per charge has nowhere
   to go, and a conferral priced in charges buys no SRD entry until it does.
7. **The populations the sweep does not cover.** Subclass ids, and language
   and alignment names — the last of which needs a construct allowance, since
   `CREATURE_TYPES` names `'Giant'` as a mechanic.
8. **SRD Fly is transcribed without `self: true`**, the same defect Jump had:
   "You touch a willing creature" includes you, and the caster is not
   currently a legal target of it.
