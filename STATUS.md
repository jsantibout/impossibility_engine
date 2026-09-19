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
- **A copy of an item, told apart from its twin** — an inventory line may
  carry an engine-issued `instance`, minted from a counter the fold verifies
  rather than assigns; a line without one is the counted stack it always was.
  A charge pool is keyed to the copy and declared when the copy is gained, so
  two wands no longer share one and a wand put down keeps what it had left.
- **Senses** — the glossary's four, granted by a trait or a worn item and
  consulted by the sight question: a declaration wins, Total Cover silences
  the sense, then a sight-sense in range answers. Six species carry
  Darkvision as a grant rather than a note.
- **A lifetime for Temporary Hit Points** — a deadline may be hung on the
  pool, and with none stated they last until spent or until the holder
  finishes a Long Rest.
- **A door above the engine** (`@ie/tools`) — a `Campaign` holding the seed,
  the content and the log with state as a cache; Zod-validated tools enough
  to run one fight from Initiative to the last turn, with a tool for every
  debt the engine can raise; refusals and requests for a missing fact as
  values. The model never produces a number and the surface cannot reach the
  functions that would let it, which is asserted rather than promised.
- **Replay** — a scripted four-round fight and two frozen logs fold
  byte-identically.

## What does not

- No orchestration, persistence or web app. `@ie/tools` covers one fight;
  the DM-facing half of the surface — a check against a DC the DM sets,
  improvised damage, the wider ruled conditions — is not built, and nothing
  stores a log. The engine still has no idea a language model exists, which
  is the point.
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
- Nothing can be given away. A copy has a record now, but no command hands
  one creature's item to another, and none hands a party what it found — so
  `equipItem` still declares a catalogue-keyed pool for an *unlabelled* copy,
  and the commit that adds an award command must delete that branch in the
  same breath. A test pins the two doors a copy arrives through so a third
  cannot be quiet about it.
- Nothing in play consults a sense yet: every caller of `sightBetween` is a
  command, and the senses landed beside them rather than in them. The same is
  true of the hour on Potion of Heroism's Temporary Hit Points — the engine
  can hang the deadline and no item files one.
- No carried weight, no ammunition spent. Objects that are not creatures
  are not modelled.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

Ranked by what each unblocks, which is `COVERAGE.md`'s blocker tables rather
than the order these were noticed in.

1. **The three one-file follow-ups this batch split off.** Nothing consults a
   sense (`sightBetween`'s callers are all commands); no item files a
   Temporary Hit Point deadline, so Potion of Heroism's hour is still a note;
   and `potion-of-heroism`'s `unmodelled` line is now false. Each is small and
   each is the difference between a capability and a rule in play.
2. **Three engine defects the catalogue found, driven by tests that pass
   today because they assert the defect.** `sightBetween(x, x)` answers null
   and `declareSight` refuses to record the answer, so **Cure Wounds, Healing
   Word, Mass Cure Wounds and Mass Healing Word cannot be cast on their own
   caster** — the worst of the three by far. `RIDER_FIELDS` refuses a
   conferred effect carrying `conditions`, which is `condition-immunity`'s own
   required list, so Potion of Gaseous Form is refused the Immunity its spell
   executes. `regainsAtDawn` takes dice and Rod of Resurrection prints a flat
   1, which `parseNotation` refuses.
3. **Transfer and an award command** — steps two and three of the item
   record. They release the copies-are-distinguishable work into the
   catalogue, and step three must delete `equipItem`'s unlabelled pool
   declaration in the same commit.
4. **The `alert` breach** in `creation.ts`: the engine reads one feat by name
   and pays the Initiative bonus itself. It needs a way for a feat to confer a
   bonus through the grant vocabulary, and it is the last entry on the sweep's
   breach record.
5. **The DM-facing half of the tool surface** — a check against a DC the DM
   sets, improvised damage, the wider ruled conditions — kept apart from the
   model's, which the doctrine's North Star asks for. Then an engine command
   that lifts a DM-applied condition, which the surface found missing.
6. **Split `senses-beyond-declared-sight`**, which is three shapes wearing one
   name: a sense an item or trait grants (built — retire it), an effect
   excused by the attacker's sense (Blur, Mirror Image, Faerie Fire), and one
   creature borrowing another's (Find Familiar, Mislead, Project Image). A
   fourth is Goggles of Night's second clause: a sense that *widens* one the
   holder already has.
7. **Dice that scale with what was spent.** Every scaling field reads a slot
   or a caster level, so Staff of Striking's extra die per charge has nowhere
   to go, and a conferral priced in charges still buys no SRD entry.
8. **The populations the sweeps do not cover**: subclass ids, and language and
   alignment names — the last needing a construct allowance, since
   `CREATURE_TYPES` names `'Giant'` as a mechanic.
