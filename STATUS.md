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
- **An item that moves** — a copy may be given away and arrives as spent as it
  left, its pool travelling whole; a DM may award what a party found, and a
  count the book rolls is rolled once at the copy's birth and pinned. There is
  one gain semantics and a sweep that fails if a fourth door forgets it.
- **A surface a human DM calls** (`@ie/tools/dm`) — a check against a DC the
  table set, damage it adjudicated, a ruling that ends. Separated from the
  model's by a directory rather than a flag: the model's factory takes no tool
  list and its module closure contains no DM file, which is asserted in every
  import form.
- **A ranked account of what is not built.** Three blocker maps now — spells,
  items and features — each naming what a missing shape blocks and what it
  would finish, all rendered into `COVERAGE.md` and held against the documents
  they quote. The feature map's two heaviest entries are an Ability Score
  Improvement and an Epic Boon, neither of which is a rule of combat.
- **A creature a casting puts there** — a summons arrives with its whole sheet
  pinned into the event, on the summoner's side, able to act when its
  Initiative comes, and the fold raises it from the log with no catalogue
  open. What a spell forbids is built too: a restriction is a sourced grant
  with a deadline, refused at the six places the economy is spent, and a
  compulsion is a fact about legality rather than an instruction — the engine
  never takes the Dash.
- **A DM who rolls** — dice notation the engine throws down the ordinary
  damage path, a saving throw against a DC the table set, and Advantage from
  a ruling recorded as its source.
- **Ground that costs more to cross** — the table declares a patch difficult,
  how difficult, and which casting made it so; the engine works out which
  spaces it covers, what a crossing costs, what two overlapping patches cost,
  and whether the patch is still there. A rate rather than a flag, because
  Plant Growth prints four feet per foot where the glossary prints two.
- **A score a feat raises and an item sets** — the Ability Score Improvement
  feat and the seven Epic Boons are published, a feat may be asked which
  scores and gated on a level, and a worn item may set a score outright
  without ever lowering one. A level 19 character is built and folded in a
  test, which had never been done.
- **Every Improvement and Epic Boon the tables print** — all twelve classes
  offer the Ability Score Improvement at the levels their own paragraph names,
  which is 4/8/12/16 for ten of them, 4/6/8/12/14/16 for the Fighter and
  4/8/10/12/16 for the Rogue, and the level 19 Boon beside it. Sixty-three
  class features moved from `manual` to executed on no engine change at all,
  which is what the content door was built to make possible.
- **A draught whose hours are rolled** — a conferral's lifetime may be a die
  rather than a printed number. It is thrown once, at the first deadline the
  use files, down the same non-d20 path a charge pool's maximum takes; what
  reaches the log is the resolved deadline, so a replay never re-rolls it.
- **A route a tool can carry** — the model's surface has the field the engine
  asks for, and a session can answer `route_required` without a human reaching
  past it: a declared patch, a walk refused, the same call with the spaces
  named, and a cost neither endpoint implies. Two doors arrived with it
  because the loop could not be driven without them — an activation acting
  through a running casting, and a third declared fact beside cover and sight
  saying where the ground is rough, which charges the glossary's rate because
  no caller may name one.
- **Two refusals a caller can tell apart** — the ground that disagrees with
  itself asks for a route and is answered by one command carrying it; a
  carried area asks for single steps and is answered by several, and no route
  will ever answer it, because a creature the area Restrains stops walking
  where it stood. A readied move can state its route now, which it could not.
- **A blocker recorded in words no marker knows** — the spell map may hold an
  entry whose sentence trips none of the guard's mechanical markers, so
  writing a definition no longer silently deletes the gaps beside it. Two
  rules keep it from being an escape hatch: the sentence must genuinely trip
  nothing, and the entry must name a real missing shape rather than the table.
  Three definitions that had been written and thrown away over this are in.
- **A count with no ceiling** — a tally beside the charge pools: a count of
  uses carrying what empties it, springing into existence at the first use
  because nothing declares one. A pool refuses when it runs out; a tally
  cannot refuse, which is the whole reason it is not a pool. Wind Fan's
  cumulative fifth of a chance rides on it, and Augury, Commune and Divination
  fit the same shape when somebody writes them.
- **A use the item fails to make** — an ordinary `ok` whose resolution says no
  casting came of it, the way a missed attack is an ordinary `ok` that dealt
  nothing. The fan rolls, tears, is unequipped as well as lost — tatters left
  equipped are a route a casting would still find — and spends the action it
  cost.
- **A grant spent by the roll it reaches** — `oneShot` on a roll modifier and
  `roll-modifier-consumed` to end it, whose fold body is the same call a
  deadline makes. Both endings stand and the first wins. The rule is the roll
  it **reached**, not the roll it changed: a one-shot Disadvantage cancelled to
  normal by an Advantage is still spent, because the sentence counts rolls
  rather than outcomes. A selector may also pin the other participant, so Vex
  narrows to one creature and an attacker holds one per creature rather than
  one in total. Guiding Bolt and Vicious Mockery run on it.
- **A fall somebody declared** — the sixth reaction window and the first
  opened by a declaration rather than by something the engine is in the middle
  of doing. The fact is `lastDamage`'s twin with the dealer dropped, carrying
  no height, no rate and no landing, and it closes on the same two facts every
  other window does. Feather Fall is cast against it.
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
- Every ability a roll reads now asks `sheetAsItStands` — the attack roll and its damage, the ability check, the
  saving throw, Initiative, a Reaction's addend, a spell's save DC and attack
  bonus, an item's casting, both spell-effect modules for caster and victim,
  the Concentration save, the check and save a turn boundary repeats, and
  `selfHealAddend` and the Constitution a Hit Die adds on a Short Rest. No
  non-test engine file reads an ability off `creature.sheet`. What a
  substitution cannot reach is the one number that is genuinely *folded*
  rather than derived — a hit point maximum, paid a level at a time — which is
  all the Amulet of Health's one remaining note records. Three catalogue notes
  came off entirely rather than being reworded, because a note kept alive past
  the gap it described is what that field exists to prevent.
- Seven emitters of `roll-recorded` pass no modes, so the field's absence
  means both "nobody ruled" and "this emitter never says". An attack roll and
  an Initiative roll can each carry Advantage and neither records it.
- Nothing above the engine can summon, so no session can reach the stranded
  debt. The day a summoning tool lands, the sweep must land beside it or a
  model-driven fight can wedge.
- No carried weight, no ammunition spent. Objects that are not creatures
  are not modelled.
- Two copies of the Wind Fan in one pack share one count of uses, which is
  why it is transcribed as partial. Only an item carrying a charge pool is
  labelled with an instance when it is gained, and a fan has no charges; the
  key already goes through `instancedPoolKey`, so the day that predicate
  widens the count follows the copy with no further change.
- **Nothing above the engine can declare a fall**, so Feather Fall is
  uncastable from the tool surface although the engine casts it. That is the
  fourth time a door has been found shut behind a room that was finished, after
  the route field, the damage type and the Improvement's abilities — which is
  a pattern rather than three accidents.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

Ranked by what each shape **finishes**. That column mis-sized briefs in three
consecutive batches, and once was wrong in the table itself — read the shape's
own description, then check it against the book and the code, before briefing
anything here.

1. **A door for every fact the engine can be told.** Four times now a room has
   been finished and the door left shut: the `move` tool declared
   `establishes: ['route']` with no `route` field behind it, `cast_spell` had
   nowhere to name a damage type five spells print, `featChoice` had no
   `abilities` so the Improvement this repository published could not be
   taken, and `declareFalling` is reachable from no tool at all, so Feather
   Fall is uncastable from the surface that exists to cast it. Three were
   found by builders doing something else. **The brief is the sweep, not the
   fourth patch**: a test that every `establishes` has a field, every engine
   `needs-context` kind has a door, and every declared fact has a tool — then
   whatever it finds.
2. **A feature that changes a casting's damage.** Five features, five
   finished; the leader of the feature map, read off the data.
3. **Weapon mastery's buildable half.** The record of which weapons, plus
   Graze, Cleave, Push, Slow and Topple, each routed through events that
   already exist and written out in the shape's description. Sap and Vex are
   no longer blocked — `oneShot` and `counterpart` landed this batch — so what
   remains outside it is Nick (the Light property's extra attack) and the Long
   Rest re-choice. Two wrinkles it must settle: nothing derives a bearing from
   two positions, and creature size lives only on the map, where an undeclared
   size silently becomes Medium with no counterpart to `isHeightDeclared`.
4. **A condition an item imposes** — 28 blocked, 5 finished, the heaviest item
   shape left.
5. **Falling damage**, which `monk:slow-fall` waits on and Reverse Gravity's
   producer needs: a damage tagged as a fall, with a height the table
   declares. `falling` keeps two claimants until both are written.
6. **An instance for an item with no charges.** Widening
   `issueItemCopies`'s predicate in `commands/inventory.ts` (and the
   `itemChargePool(item, instance)!` beneath it, which would otherwise push a
   null) makes the Wind Fan complete rather than partial, and is the last of
   the copy-identity work.
7. **The Light property's extra attack.** The action economy counts one Attack
   action, not the attacks in it. Nick is nothing without it.

### Guards that would have caught something this session

- `riderDuration`'s tail is a ternary, so a **new** `RiderDuration` member
  would compile and silently become a caster start-of-turn deadline. It
  predates this batch and no member added since can fall through both
  pre-flight loops, but it is exactly what a sweep should hold.
- `content.ts` validates a feature's `roll-mode` grant through the selector
  alone, so `oneShot` is unchecked there. Meaningless on a derived standing
  grant today; one line when the feature door is built.
- A `SOLE`-style `it.each([])` registers zero tests and passes for ever. One
  list held exactly one row this batch and a builder noticed while emptying
  it; nothing would have said so.
- `fold-import-boundary.test.ts` constructs an `ESLint` and lints text in
  process; its first case can exceed the 5s default timeout under full-suite
  load and passes warm. Observed independently by three agents on untouched
  commits. A timeout on that describe block, in whichever brief next opens it.

### Decisions waiting on the owner

None. The three from last session — the failed item-use, the grant ended by
name, the fall as a declared fact — were answered, and all three answers
changed the design the question assumed.

Separately, and absorbed by none of the above: Augury, Divination, Commune and
Secret Chest print a cumulative chance the tally now holds; what they still
need is the consequence a failed one has.
