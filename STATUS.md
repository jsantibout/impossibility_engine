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
  delayed damage raised by the boundary, Short and Long Rests.
- **Casting** — slots and Pact slots as pools, castings with identities,
  Concentration, interruptible declared castings, long castings and rituals,
  reaction spells, ongoing records that later activations act through.
- **Spell execution** — the effect kinds and three rider kinds; the SRD
  spells the catalogue defines run end to end.
- **Characters** — all twelve SRD classes with their SRD subclass, creation
  and advancement validated against the book, multiclassing, feats recorded
  and a few executed, class features executed where a reader exists and
  honestly marked `manual` where not.
- **Content** — `createContent` / `loadContent` validate a catalogue from
  typed input or JSON; `SRD_CONTENT` is built through it; a homebrew spell or
  class using existing mechanics needs no engine change (`content.test.ts`).
  Languages and alignments are content too, so a world may declare its own
  tongues, its own alignment axis, or none.
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
- Species and backgrounds: one of each (Human, Sage). Feats: the origin and
  fighting-style feats, recorded, two executed.
- Equipment stops at mundane items: no weight, attunement, magic items or
  ammunition spent. Objects that are not creatures are not modelled.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

1. **The tool surface** (`@ie/tools`): the Zod-validated commands a DM or a
   model calls, holding one `Content` and one log per campaign.
2. **Content as files**: a loader in the app layer that reads homebrew JSON
   (and, later, a database) into `loadContent`.
3. **More species and backgrounds** in `@ie/content` — transcription onto the
   existing shapes.
4. **The next mechanical shapes** the coverage report ranks highest, each
   added to the engine with its resolver, validator rule and tests, then
   the spells that use it added as content.
