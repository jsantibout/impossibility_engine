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
- **A caster's feature that reaches into a casting's arithmetic** — one
  `StandingGrant` arm rather than five, because all five SRD sentences ask one
  question at one moment about a notation already in hand: which castings do I
  reach, and what do I do to the damage they were going to deal. An ability
  modifier on one damage roll, a die substituted, a floor under a miss or a
  made save, every die at its maximum. What it alters is pinned as altered, so
  a replay throws the Ranger's d10 with no idea Foe Slayer exists, and a
  maximised casting throws nothing at all.
- **A guard that derives its own list** — every tool that says it establishes
  a fact has the field that carries it, every kind the engine raises has a
  door, every fact the engine can be told has a tool that tells it, and every
  refusal naming a missing field is answerable through it. All four sets are
  read out of the engine's source rather than typed into a list, so a new one
  fails here until somebody opens the door or writes down why it stays shut.
  Four declarations are recorded as deliberately withheld, with reasons.
- **A monster is content** — the bestiary is carried by `SRD_CONTENT` and a
  homebrew stat block enters through the same door, so `addCreature` takes an
  **id** and reads the block out of content the way `equipItem` does. The id
  rather than the value because an entry point that accepts a stat block is
  the door a model-authored Armour Class walks through, and nothing guarded
  it. `creature-added` pins the size too, so a caller stops supplying a fact
  the book prints.
- **A class that redefines its own strike** — one grant carrying the weapons
  it covers, a die read off the class table, an ability offered in place of
  the attack's own, and a Bonus Action strike, because the SRD prints one gate
  over three clauses. The Monk has Martial Arts. A class's own weapon list and
  its weapon proficiencies are two declarations, because the book prints two
  sentences that differ.
- **A character that can be asked what it holds** — a third read beside `look`
  and `options`: slots by level with Pact Magic kept separate, pools and what
  refills them, what it can cast and by which route, its features, and for
  each the name of the tool that spends it. It states no verdict about what
  may be used right now, because that is the command's answer and asking twice
  is how two answers drift.
- **Features a session can spend** — Rage entered, extended and ended, Second
  Wind, Lay on Hands, a pool refilled, and a casting that elects a feature of
  the caster. Every one a door over a command that was already tested and
  reachable by nothing.
- **A guard that the engine buys no catalogue on import** — it parses every
  non-test engine file and asserts no declaration naming `@ie/srd` survives
  type-stripping, which is the only reading that catches `import { type X }`:
  under `verbatimModuleSyntax` that emits a side-effect import which loads the
  whole book and binds nothing, and reads like a type import to a person and
  to a regex.
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
- **No monster can be put on the board from the model's surface**, though the
  engine now takes one by id from content. The tool is a door away and until
  it lands the fight driven end to end through the surface is still a wizard
  against a copy of itself. That tool must also arm what it places: many stat
  blocks print gear, `resolveAttack` refuses a weapon its wielder does not
  own, and name-to-id resolution belongs above the engine.
- **Three pools the engine holds with nothing behind them.** Channel Divinity,
  Bardic Inspiration and Action Surge are counted and recovered, and what a
  use *buys* is unexecuted — no command spends a bare pool for an effect. They
  were deliberately given no tool: a pool a caller can spend for no effect is
  worse than one it cannot spend, because the use is gone either way and one
  of them lies about it. A Cleric cannot turn undead and a Bard cannot
  inspire.
- **A Rage's ten minutes are nobody's to keep.** `capSeconds` is pinned at
  creation and read by no command; `extendFeature` replaces the timer and
  checks nothing else. The surface reports the number and says the bound is
  the table's.
- **No reaction spell and no held casting.** `cast_spell` has no trigger
  field and `takeDamageReaction` / `takeTestReaction` are unimported, so Shield
  sits in the test wizard's spellbook uncast. Counterspell needs more than a
  field: `hold` and `answers` are unoffered and a held casting also wants a
  `resolve_declared_cast` door.
- **No rest, no item used, nothing readied, nothing summoned** from above the
  engine. Each is a command the engine has and the surface does not call.
- **A feature cannot be elected on a casting.** `usingFeatures` reaches no
  tool, so no session can spend Overchannel or add Elemental Affinity's
  Charisma. Unlike the other shut doors this one needs a companion: a model
  cannot elect a feature it has not been told it holds.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

**The doors are most of the way open, and what is left behind them is real
work.** A session can now see what a character holds and spend it, the Monk
can fight, and a monster is content the engine takes by id. Three things still
stand between this and a party playing at level 5, and only the first is a
door.

Ranked by what each finishes.

1. **A monster tool, and the fight that stops being symmetric.** The engine
   half landed; this is the door, plus arming what it places — compose
   `addCreature` with `awardItems` for the gear a block prints, resolving
   names above the engine — plus pointing `place_creature` at the pinned size
   instead of asking the caller for a fact the book prints, plus the
   asymmetric `fight.test.ts` this repository has never had. `doors.test.ts`
   will demand `unknown_monster` be answerable through a field, which is the
   sweep working.
2. **What a use of Channel Divinity, Bardic Inspiration or Action Surge
   buys.** Three pools counted and recovered with nothing behind them, which
   is why they were given no tool. This is engine work — an effect a pool
   spends — and it is what makes a Cleric and a Bard playable rather than
   merely buildable. Read the three content notes first: they say in so many
   words what is not executed.
3. **A reaction spell, and a held casting.** A trigger field on `cast_spell`
   and doors onto `takeDamageReaction` / `takeTestReaction` get Shield and
   Absorb Elements. Counterspell needs `hold`, `answers` and a
   `resolve_declared_cast` door, and is the larger half.
4. **A rest, an item used, an action readied.** The last commands the engine
   has and the surface does not call. A Short Rest is what makes a Warlock and
   a Fighter work across two fights rather than one.
5. **A report that answers "what can be played at level N".** `COVERAGE.md`
   counts the whole book, which is the right number for how much of the SRD is
   built and the wrong one for whether a level 5 party can play. Features by
   the level they arrive, spells by the slot that casts them, and which of
   either a session can reach through a tool. It has been answered by hand
   twice; a hand answer in a document is what rule 8 forbids.
6. **A condition an item imposes** — 28 blocked, 5 finished, the heaviest item
   shape left.
7. **Weapon mastery's buildable half** — the record, Graze, Cleave, Push, Slow
   and Topple, all routed through events that exist and written out in the
   shape's description. Nick waits on the Light property's extra attack; the
   re-choice waits on `an-option-re-chosen-on-a-rest`.
8. **Falling damage**, which `monk:slow-fall` and Reverse Gravity's producer
   both wait on.
9. **An instance for an item with no charges**, which makes the Wind Fan
   complete rather than partial.

### Small and owed

- **`finesseAbility` understates what it answers.** It now carries the choice
  a strike style offers as well as a Finesse weapon's, which is the same
  question and correctly one field — but the name says otherwise. Renaming
  touches `state.ts` and the tool surface.
- **`electableCastingDamage` is not on the engine's barrel**, so the surface
  filters the sheet's own standing effects instead. An item-granted election
  would go unlisted and one with unmet requirements would be listed and then
  refused. Neither is reachable in the SRD catalogue; both are reachable by
  content alone, which is what makes exporting it a fix rather than a tidy-up.
- **`capSeconds` is enforced by nothing** (see above). Enforcing it is a
  change in `timers.ts`.
- `riderDuration`'s tail is a ternary, so a **new** `RiderDuration` member
  would compile and silently become a caster start-of-turn deadline.
- `content.ts` validates a feature's `roll-mode` grant through the selector
  alone, so `oneShot` is unchecked there.
- A `SOLE`-style `it.each([])` registers zero tests and passes for ever.
- `casting-damage` is legal on an item and no SRD item prints the sentence, so
  that path is untested beyond the validator.
- `fold-import-boundary.test.ts` lints text in process and its first case can
  exceed the 5s default timeout under load. Seen by five agents now.

### A trap in the worktrees, not in the code

A builder worktree starts with an empty `node_modules`, so `tsc -b` for
`packages/content` and `tools/` resolves `@ie/engine` through the **main
checkout's** symlinks and typechecks the worktree's content against the main
checkout's `dist`. It is silent while the two agree, which means a builder's
own engine change can be hidden from its own typecheck. Junction all six
(`engine, content, shared, srd, tools, llm-probe`) when the worktree is made,
beside copying `packages/srd/src/generated/`.

### A discipline the coordinator broke, written down

Each builder commits its own regenerated `COVERAGE.md` and the coordinator
drops those and regenerates once over the merged set. That is right, and it
means `main` fails `git diff --exit-code COVERAGE.md` between the first merge
and that regeneration. It stayed red for eleven commits this session and a
builder found it, not me. Regenerate after the last merge of a batch and
before anything else, or drop nothing until the end.

### Decisions waiting on the owner

None.
