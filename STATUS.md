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
- **A fight that ends.** `endCombat` closes one when no hostile combatant
  remains or the hostiles surrender; a flight is a prompt rather than an end,
  refused until the party elects to let them go. The event pins *why*, and the
  clock refuses a declared span inside a running fight — the two shipped
  together because either alone wedges a session that rolls Initiative once.
  `undeclared_side` asks rather than guessing, carrying one request per unsided
  creature.
- **A monster that swings with its own printed lines.** Multiattack as a named
  sequence — "two Bite attacks" — counted per name within the turn, so a Ghoul
  cannot make two Claws; and an opportunity attack that reaches for the
  highest-damage printed melee attack that does not recharge, instead of
  fabricating an Unarmed Strike. A caller may still name a different one.
- **A printed line the parser could not read is spendable.** An Actions line
  with no attack block — 212 of them across 138 blocks — is spent like a Bonus
  Action line: the Action goes, the printed sentence comes back, and the engine
  applies none of it. The 71 of those carrying a recharge are live as a result,
  expended by the spend and returned by the turn roll or a rest.
- **A recharge is kept.** A printed line the creature used is expended; at the
  start of its turn the engine throws one d6 per expended line and gives it
  back on the printed number or better, and a Short or Long Rest gives back
  every expended line whichever way it recharges. The book says both in one
  sentence. A line printed "Recharge after a Short or Long Rest" has no die and
  comes back only at the rest. Using an expended line is refused before
  anything is spent. The door that opens a fight reaches the same moment, so it
  throws dice now too.
- **A monster's Bonus Action is spendable.** The 75 printed lines are carried
  onto the sheet and one may be taken: the Bonus Action is spent, the printed
  sentence is handed back, and the engine executes nothing — most of the 75
  name a spell, a save or a shape-shift it cannot run, and a line it cannot run
  is handed over rather than silently succeeding. The once-per-turn ledger is
  the existing one under a reserved namespace, so there is no second counter.
  On the back of it the clay golem's gate is evaluable: three Slams after
  Hasten, two without, and two when nothing was spent.
- **A feature that holds an action rule.** A feature may say a price its holder
  pays for a named action, derived at every spend rather than stored, so a log
  frozen before the rule existed still folds to what it always folded to. SRD
  Cunning Action buys Dash, Disengage and Hide with a Bonus Action, and Hide is
  the engine's verb end to end: the watchers it must be out of sight of, the
  cover or obscurement it needs, a DC 15 Dexterity (Stealth) check, and the
  Invisible condition it buys. Where nobody has said what can see the hider,
  the engine asks rather than guessing.
- **A use that hangs something a roll can spend.** A derived grant says what a
  feature permits and can never be consumed; a *hung* grant is stored at the
  moment the price is paid and is spent once. SRD Steady Aim gives Advantage on
  the next attack and a Speed of 0 until the turn ends, each clause under its
  own source — because everything one source granted is released together, and
  sharing one would have handed the Speed back on the swing that spent the
  Advantage.
- **The defender answers first, on both paths.** A rider elected on a swing is
  pinned on the pending record and resolved after the damage lands, so a target
  Stunned by the same hit still answers the window it was offered — held swings
  included. A *Shield* that turns the hit into a miss drops the rider unspent,
  because "when you hit a creature" became false, and a hold that ends when a
  party leaves drops it the same way: resolving it would apply a condition from
  a blow the log says never landed.
- **A count the table keeps.** A Hydra's active heads are declared through the
  DM's surface and nowhere else, and the Attack action's Bites derive from what
  was declared — a printed sequence still wins, and a block with neither holds
  one swing and says so. It is the first DM door that takes a number, and the
  line it draws is that a number the engine produces is a fabrication while a
  number the table states is a fact.
- **A daily limit the book prints.** Sixty headings across fifty-four blocks
  carry an `N/Day`, and the twenty-two with a home on the sheet are enforced:
  refused before the economy is spent, and cleared by a declared dawn and by
  nothing else — a Long Rest does not give one back, because a per-day line is
  not a rested one. The count is a tally rather than a second ledger, which is
  what makes the GM's own dawn reach it.
- **A Hide that ends.** A hider who swings or casts stops being hidden, by that
  source alone, so a Greater Invisibility standing beside it survives. Whether a
  creature's *senses* end it is a ruling nobody has made, so the clause reads the
  declared sight line and the tests pin that absence.
- **The doors, and what they now reach.** A DM spends a stat block's printed
  Action and Bonus Action lines by their printed names, and `look` reports those
  names, the Multiattack as the sequence it is, and what the creature has already
  spent — so a name a caller can be refused for is a name it can read. A morning
  can be declared; a rider can mount and dismount; the free object interaction,
  the initiative swap and the trade a feature grants all have doors. A character
  can be levelled: `advance_character` takes the rung being arrived at, never XP,
  which is a thing tables keep on paper.
- **Casting** — slots and Pact slots as pools, castings with identities,
  Concentration, interruptible declared castings, long castings and rituals,
  reaction spells, ongoing records that later activations act through.
- **Spell execution** — the effect kinds and three rider kinds; the SRD
  spells the catalogue defines run end to end.
- **Text only the DM can decide.** A spell may hand printed sentences to
  whoever is running the table — Commune's question of a god, Dream's `Special`
  Range, Mirage Arcane's `Sight` — marked as a handover rather than filed as a
  debt somebody may one day pay. The casting still spends its slot and holds
  its Concentration; only the unstatable part is handed over.
- **Characters** — all twelve SRD classes with their SRD subclass, all nine
  species and all four backgrounds, creation and advancement validated
  against the book, multiclassing, feats recorded and a few executed,
  features executed where a reader exists and honestly marked `manual`
  where not.
  A character carries a **size**, pinned at creation from the species and taken
  as a choice where the species prints more than one.
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
- **A monster on the board, and a fight that is not symmetric.** A session
  names a stat block's id and nothing else about it; the tool composes the
  arrival with the gear the block prints, because a goblin that is not armed
  cannot make the attack its own block prints and `resolveAttack` refuses a
  weapon its wielder does not own. Turning `Javelins (6)` into six javelins is
  the surface's job, since the engine reads no name. What the catalogue cannot
  find is reported rather than refused. The fight driven end to end through
  the surface is a wizard against a goblin now, and the file's old line saying
  it was symmetric because it had to be is gone.
- **A feature's pool use is the third host of an effect list.** An effect list
  was reachable from a spell and from a bottle and from nothing a class
  prints. It confers without casting exactly as a potion does — no casting id,
  no ongoing record — and differs in one thing: an item prints its DC and a
  feature says "your spell save DC", so the ability is the granting class's
  and the DC is derived from the sheet at the moment of use. A pool may carry
  a **menu**, because the SRD prints one feature whose uses buy different
  things. Turn Undead and Divine Spark run.
- **A fight a model can actually run.** The surface answers every window it
  shows: a held hit for Shield, a damage roll not yet landed, a D20 Test
  pushed from the model's door and settled at the DM's. A casting is a process
  Counterspell can interrupt, and one nobody stops is finished rather than
  held open for the rest of the campaign. A Cleric can be told to turn undead.
  Time out of a fight is narration and therefore a door, which is what makes a
  rest mean anything. Potions, readied actions, awarded loot.
- **A die in somebody else's hand** — the Bard's pool is spent on the Bard and
  the ally holds a sourced grant with a deadline, consumed when the roll it
  was given for fails. It is a Reaction conferred rather than a resource
  handed over, which is the fourth answer to what a pool use buys.
- **Weapon mastery, seven of the eight** — the record of which weapons, and
  Graze, Cleave, Push, Slow, Topple, Sap and Vex. The last two needed no
  mechanism at all; what they were waiting on was the record.
- **A report that answers "can we play this level yet"** — features by the
  level they arrive and spells by the slot that casts them, per *path*, since
  a Cleric of the Life Domain has the Life Domain's features and not an
  average of the domains. In reach, tracked and executed are three counts that
  are never added, and a test fails when the committed report is stale.
- **A monster attacks with the line its own block prints.** 2024 stat blocks
  are written to a template rather than in English, so the attack line holds
  every number the engine needs: a Wolf bites at its own printed bonus with no
  weapon in its mouth, and a Ghoul's +4 stands where a derivation would have
  given +3. Pack Tactics is read off the *sentence* and never the trait's name,
  so the engine still branches on a mechanic. What the line says after the
  damage, and any condition on the roll, are kept verbatim and reported.
- **Features a level 5 character actually has.** Reckless Attack and Frenzy,
  because an attack roll may now be narrowed to the ability it was made with.
  Stunning Strike, because a hit may buy an effect list — a grant of its own,
  since the Monk spends another feature's pool and Open Hand spends nothing.
  Divine Order and Primal Order, because a bonus may be sized by the holder's
  own modifier. Disciple of Life, because a casting's healing has a reader.
  Wild Resurgence, because one resource may be traded for another — and never
  minted above a maximum. Find Steed and Hunter's Mark, cast out of the
  feature's own pool with no slot spent. **Metamagic**: Distant, Extended,
  Quickened and Twinned, priced in Sorcery Points.
- **Four spells that write a vocabulary nothing wrote.** Stinking Cloud, Fear,
  Wind Walk and Magic Jar. Fear is written as legality rather than compulsion —
  a Frightened creature's Dash is a narrowing, and nobody is made to run.
- **Doors for nearly all of it** — a mastery property asked for, a die handed
  to an ally, a rite kept at across a turn boundary, Retaliation, a dying
  creature stabilised, and the whole inventory: buy it, wear it, attune to it,
  hand it over. A settled rest is idempotent under its command id end to end.
- **Replay** — a scripted four-round fight and two frozen logs fold
  byte-identically.

## What does not

- No orchestration, persistence or web app. `@ie/tools` covers one fight and
  nothing stores a log. Both halves of the surface are built: the player's
  door and, under `dm/`, the DM's — a check against a DC the DM sets,
  improvised damage, the wider ruled conditions, what a stat block prints.
  They are partitioned by **authority**, not by species of caller: a DM's door
  takes a decision the rules leave open, and neither door takes a die face.
  The engine still has no idea a language model exists, which is the point.
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
- **A casting cannot summon.** The door and its sweep are built and shipped
  together — `summon_creature` and `dismiss_stranded_summons`, with the wedge
  they exist to prevent driven end to end in a test. What is missing is one
  level up: there is no summon *effect kind*, so a caller must cast, read the
  `castingId` back, and summon by hand. The engine never derives the creature
  from the spell.
- No carried weight, no ammunition spent. Objects that are not creatures
  are not modelled.
- Two copies of the Wind Fan in one pack share one count of uses, which is
  why it is transcribed as partial. Only an item carrying a charge pool is
  labelled with an instance when it is gained, and a fan has no charges; the
  key already goes through `instancedPoolKey`, so the day that predicate
  widens the count follows the copy with no further change.
- **One pool the engine holds with nothing behind it.** Action Surge is
  counted and recovered and what a use *buys* is unexecuted, so it was
  deliberately given no tool: a pool a caller can spend for no effect is worse
  than one it cannot spend. Channel Divinity and Bardic Inspiration have both
  come off this list — the Bard's die is conferred, and its Font of Inspiration
  is spent through the trade door. The Bard's die is **not** a resource handed to another
  creature, which is what its note used to say — nothing hands a resource
  over. The Bard's pool is spent on the Bard, and what the ally holds is a
  sourced grant with a deadline, consumed on use: a granted `intervene`
  reaction, which is a tenth grant family and the one genuinely new thing
  among the three.
- **A weapon mastery is a ceiling rather than a quota.** Naming none records
  none, because making the choice required broke 49 fixture files across
  worktrees nobody owned at once; `planCharacter` warns rather than refuses.
  Making it required is a corpus migration and is owed. It is now the only one:
  the size choice was ruled to default rather than refuse.
- **A character's size is a default when nobody chooses.** Creation pins one
  from the species and, where the species prints more than one, records
  `size_not_chosen` and takes the first printed rather than refusing. A stated
  size a species does not print is still refused. Promoting the warning to a
  refusal is the same corpus migration the weapon mastery is owed, and the
  owner has ruled the default is the design.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

**A level 5 party can be built, armed, placed against monsters that fight with
their own printed lines, their own Multiattacks and their own daily limits,
played through a fight, a rest and an ending — and then levelled.** The numbers
are in `COVERAGE.md` and no sentence here repeats one.

Three batches have now taught the same lesson twice over: **a brief that names a
number taken from a table nobody checked is wrong about half the time, and a
brief that names a *shape* is wrong about as often.** Six doors were one, three
spells were two, four features were one, 177 Multiattack blocks were 78, one
Augury was eight, a rule that held 55 times out of 55 was a fact about the
corpus rather than a law, and 10 `X/Day` lines were 60. Then two briefs were
written against anchors that did not exist — a union member with no host, and a
list a file derives rather than declares — and a third ordered a counter the
engine already had. Every one was caught before it shipped, by a builder that
verified its own headline first. `WORKFLOW.md` rule 1 says to check the number;
the corollary this batch adds is that **the shape a brief prescribes is a claim
about the code too**, and gets checked the same way.

**The staleness this file itself caused is the other lesson.** Six claims under
"What does not" described code that had been deleted or built, two "Next" items
were finished, and the queued item was resolved — several of them for a week.
Four briefs were written from them before six read-only probes measured every
claim against the tree. A commit that closes a gap corrects this file in the
same change, or the next batch pays for it.

1. **The 38 daily limits with nowhere to live.** 60 headings print an `N/Day`,
   and the 22 with a home on the sheet are enforced and cleared at a declared
   dawn. The rest wait on carriers that do not exist: 32 Legendary Resistances
   want a rule that reads a *failed saving throw* and lets a creature replace
   the result, which the engine has nothing like; the Troll's severed limbs and
   the five printed Reactions want `adaptMonster` to carry trait text and the
   Reactions section onto the sheet at all, plus a command to spend a printed
   Reaction line. The Reaction economy exists; the carrier and the spend do not.
   Separately, 45 lines print the notation *inside* a Spellcasting sentence
   rather than in a heading, which is a different job and not counted here.

2. **What the bestiary still does not read.** 75 printed bonus-action lines read
   as 0, which is also what leaves the clay golem's gated alternative prose. And
   `parseMultiattack` decides a hand-over from **wording** — it takes only the
   sentence, so it cannot see whether the named action is one the block prints
   an attack for. Zero SRD blocks are affected and forty such clauses are saves
   or prose, so nothing in the book is wrong; a homebrew "uses Bite" of an
   actual Bite loses the swing. The engine knows the answer where
   `printedMultiattack` binds every name and never asks.

   Three lines the shape row still counts unread: the clay golem (waits on the
   bonus actions above), the roper (a damage-less attack line, and
   `MonsterAttackSchema.damage` is `min(1)`), and the Hydra, whose line stays
   prose by design because the table declares its heads.

3. **A casting that summons.** The door and its sweep are built and shipped
   together; what is missing is one level up — there is no summon *effect
   kind*, so a caller casts, reads the `castingId` back and summons by hand.
   The catalogue reading was wrong in our favour: SRD 5.2.1 rewrote the Conjure
   family as *spirits*, a pack or an Emanation with no AC, HP or turn, so none
   of them wants a stat block. Within a level 5 party's reach: `find-familiar`
   (which has no `SpellDefinition` at all), `unseen-servant`, `find-steed`,
   `animate-dead` and `phantom-steed`. Only `animate-dead` names bestiary
   blocks the door can already reach; the others want a stat block whose AC and
   HP scale with the slot, which `Summons` deliberately has no field for.

4. **A casting that spends an attack.** 20 of the dragons' Multiattack lines
   name Spellcasting, and a dragon that casts through the engine loses its
   Rends, because a casting spends the action. The engine stricter than the
   book. The hand-over clause is at least reported at the first swing now, which
   is the honest DM route until this lands.

5. **Two features whose trades are built and whose clauses are not**: Sorcery
   Incarnate's two-Metamagic limit rewrite, and Holy Nimbus's aura with no-roll
   damage, a save-side mode and a printed span. Both are past level 5. Font of
   Inspiration has come off this list: a later feature may now move an earlier
   pool's recovery tag — the fifth restatement the engine allows — and the
   advancement path emits the change rather than only resizing the pool.

6. **A turn budget nothing can add to.** Action Surge grants no second action,
   Flurry of Blows buys no pair of strikes, and Haste's extra action is the
   third consumer of the same missing shape. It cannot be built from the grant
   vocabulary alone: the fold calls `spendAction` inside `must`, so an extra
   action a creature merely *holds* still throws on replay. It has to be
   visible in the `TurnBudget`, which only a combat event writes. A second,
   smaller shape sits beside it — a *price* on an allowance, which is what
   Patient Defense and Step of the Wind need and what `ActionRule` cannot say.

7. **A recorded breach, and a recorded seam.** Mirage Arcane's opening sentence
   is a handover with a debt inside it — "an area up to 1 mile square" is a size
   chosen at the casting that a `SpellArea` cannot record; it shipped before
   there was a rule for it to break and is recorded rather than exempted.
   `holdings.ts` lists a feature once under first-claim-wins, so a feature
   granting both a pool option and a hit rider would lose its menu —
   unreachable in the SRD, reachable by homebrew.

8. **A party that cannot be paid.** No engine command grants coin.
   `coins-changed` exists and the fold accepts a positive delta, but the only
   emitters are `purchaseItem`, which is negative, and creation — so
   `purchase_item` spends a purse nothing can fill. The door wants to be its
   own DM-only tool over a new command, and **not** a loosening of `dmGrants`:
   that schema is shared by `create_character` on both surfaces, so widening it
   would hand a model the authorship the field exists to refuse.

9. **Found in passing, each small, none invented.** A rider's once-per-turn
   mark can be laid twice when a second swing settles first — harmless in the
   fold, which is a set, but a real double-spend of a "once per turn" clause.
   `HIDE` wants to move beside `DODGE` in `actions.ts`, which dissolves the
   import cycle that ending a Hide created. `perDayTallyKey` shares the tally
   map with content-supplied keys and is reserved against nothing, as
   `spell-slot:` and `pact-slot:` also are; reserving the resource namespaces
   is one coherent brief. `TradeFeature` carries the trade's name and not the
   feature's, so Wild Resurgence reports as "Wild Resurgence (a slot for a
   use)". `advanceCharacter` hand-writes its `unknown_creature` refusal instead
   of using the helper, so it names no door. And a DM is told which printed
   lines a creature holds by `look` but not by `sheet`, which is the half-door
   rule inverted.

10. **The long tail**: the item range shape (two fields, not one), a casting
    ended by a trigger, the remaining Metamagic options,
    `an-effect-list-a-hit-buys` for the Rogue's Cunning Strike, a damage-less
    attack line, and the bestiary's ranked prose table.


### Decisions the owner has ruled (2026-09-20)

Each is a ruling, not a task; the brief that acts on it cites this section. Six
of the nine were built the same day by the batch they unblocked — the ending of
a fight, the size choice, the opportunity attack, the DM handover, Channel
Divinity's shared menu, and the ordinary half of the defender's window.
Multiattack is built for the one mechanism of five the ruling covers.

- **Hide is the engine's verb.** It has more inputs than most: the creature
  needs cover or obscurement and no line of sight to a watcher, and then a
  DC 15 Dexterity (Stealth) check. Who can see the hider is DM input, the
  check and the Invisible condition it buys are the engine's. Cunning
  Action's third verb waits on that spender, not on a ruling.
- **A character's size is a creation choice**, taken like any other where the
  species prints more than one and pinned into the creation event.
- **Multiattack needs composition.** A monster's stat block is not a
  character's sheet: "two Bite attacks" is a named sequence, and a count-only
  Multiattack that lets a Ghoul make two Claws is a fabrication, not a step.
- **A monster's opportunity attack is its best printed melee attack.**
  Not a refusal and not a fabricated Unarmed Strike: the highest-damage
  printed attack that does not recharge, chosen by the summed printed average
  of its damage, ties going to the first printed. A caller may still name a
  different one; this is what the engine reaches for when nobody does.
- **"Permanent" is a real duration**, and a grant with no ending must carry
  its source so the sheet can say it came from a Wish.
- **Some text is the DM's alone.** Commune, Dream's Range `Special`, Mirage
  Arcane's `Sight`: the casting hands the printed text to whoever is
  running the table, human or model, marked explicitly as a thing only the
  DM can decide. Not a format arm to invent, a handover to make visible.
- **Channel Divinity is a shell with one shared pool**, and each option is a
  form the shell takes. A level 3 Life Cleric has three forms (Divine Spark,
  Turn Undead, Preserve Life) drawing on one pool, two uses at level 6 spent in
  any combination. So Preserve Life is **a subclass adding an option to the
  base feature's pool**, which is the second of the two shapes named below;
  the pool-with-options shape the Cleric already declares is the right one,
  and what is missing is a subclass feature's door onto another feature's
  menu.
- **The defender answers first.** A rider that Stuns on the same swing must
  not close the `damage-rolled` window the target was just offered.
- **A use may name an attack** (owner, 2026-09-20). The architect's reading —
  "a *use of X*" names a save or prose action, 55 of 55 — is a fact about the
  SRD corpus and not a law, and `parseMultiattack` encodes it as one:
  `TRAILING_USE` and `NAMES_A_USE` decide by wording, and the function takes
  only the sentence, so it cannot see whether the named action is one the block
  prints an attack for. Measured against all 330 blocks: `uses X` names
  something with a parsed attack block **zero** times, and all 40 such clauses
  are saves or prose — so no SRD behaviour is wrong today. A homebrew block
  printing "makes one Claw attack and uses Bite", where Bite has an attack
  block, is handed to the DM instead of being a swing. The engine knows the
  answer at bind time: `printedMultiattack` binds every name already and never
  asks this one. **Queued**: decide the hand-over by what the named action *is*,
  not by how the sentence reads.

  (The vampire spawn is not an example. Its `Bite` is a Constitution saving
  throw, so handing it over is right; the earlier report that it was a printed
  attack line was mistaken.)
- **Recharge is enforced** (owner, 2026-09-20). "Recharge 5-6" means the
  ability is expended when used, and at the start of the creature's turn the
  engine rolls a d6; on a 5 or 6 it may be used again. The roll is the
  engine's, at a boundary that already raises payouts, against state that says
  what is expended.

  Measured the day it was ruled: **87 lines print a recharge** across 87 blocks
  — 73 actions, 13 bonus actions, 1 reaction — printing `5-6` sixty-seven
  times, `6` fourteen, `4-6` five, and "after a Short or Long Rest" once. The
  parsed field sits on `MonsterAttackSchema`, so only the **2** lines that
  print an attack roll can carry one and the other 85 have nowhere to put it;
  the schema's `rest` arm is written and nothing produces it.

  **And a recharge ability returns on a rest** (owner, same day), so a die line
  has two ways back — the turn-start roll, and a Short or Long Rest
  unconditionally. The cloaker's printed "Recharge after a Short or Long Rest"
  stays a distinct form because it is the *rest only* case: no die, no
  turn-start roll. The two arms differ as "die plus rest" against "rest alone",
  which is why the arm that produced nothing was still the right shape.
- **`alsoHolding` stays, though no content can reach it** (owner, 2026-09-20).
  `holdings.ts` used to list a feature once under first-claim-wins, so a feature
  holding both a pool's menu and a hit rider would have lost one. No catalogue
  this engine accepts can express that — `FeatureDefinition.grants` is
  singular, `checkContent` refuses two definitions sharing an id across all four
  sources `grantedFeatures` draws from, and a `pool-options` grant whose host is
  not a `pool` grant is refused outright — so the merge branch is latent code
  and was kept deliberately rather than reverted. The reason: the guard lives in
  a **reader** and the thing preventing the case lives in a **validator**, and a
  reader that silently drops data if a validator ever loosens is the coupling
  that bites. Loosening is what the content door exists for.
- **The Hydra's head count gets its own event** (owner, 2026-09-20), not a
  general "a number the table states about a creature". The doctrine's own
  paragraph says kinds with providers are a table and become a framework only
  when something arrives that does not fit; generalising before a second
  instance is that framework. `creature-heads-declared`, with its fold region,
  and a general shape the day a second creature needs one.
- **Shield drops a pinned rider unspent** (owner, 2026-09-20). A held rider
  survives a deflection today: the point is spent and the condition applied on
  a swing *Shield* turned into a miss. "When you hit a creature" became false,
  so the rider is dropped and nothing is paid. The second face of the bug the
  held-path pin closes.
- **The Hydra's heads are declared; its Bites are derived** (owner,
  2026-09-20, on the architect's refusal to derive the count). Reading "five
  heads" off a trait would print a number for a turn the book did not — heads
  die at 25 damage in a turn and regrow at the end of it, and none of that is
  state. So the table declares **how many heads are active** and the Attack
  action's Bite count follows from it. The engine still derives the number; it
  derives it from a declared fact instead of inventing one, which is the same
  move as a declared side or a declared creature type, and re-declarable for
  the same reason.

  Undeclared is not a refusal and not a request: one Bite per action, which is
  today's behaviour, reported through `unverified`. By the architect's own rule
  a fact a command can proceed past conservatively is an `unverified` clause
  rather than a new `ContextRequest` kind, so this costs no kind.

  **It is the first DM door that takes a number**, which is the line the ruling
  draws: a number the *engine* produces is a fabrication, a number the *table*
  states is a fact. The owner's note for whoever builds the surface: a tool may
  present it as a single affordance — "as many as the hydra still has" — rather
  than as arithmetic the DM does twice.
- **A fight ends** when no hostile combatant remains or the hostiles
  surrender. A flight is a prompt, not an end: the players are offered the
  choice to let the enemy go before combat closes, because many tables want to
  finish them. `endCombat` ships with the clock refusal held on
  `held/clock-in-combat`.

### Ruled after the batch of 2026-09-20

Four questions the batch's builders stopped on rather than guess at.

- **Truesight and Blindsight satisfy "if a creature can somehow see you";
  Darkvision does not.** Invisible's clause reads the declared sight line today
  and the tests pin that, so the brief widens it to those two senses and leaves
  Darkvision out — which is what keeps a hidden Rogue hidden from the dwarf five
  feet away. The set belongs beside `canSee`, not inside the attack route. Dodge
  keeps reading `canSee` whole, because "if you can see the attacker" is a
  sentence Darkvision genuinely satisfies.
- **The Initiative swap is the Alert feat's, and it has a window.** The holder
  of the feat chooses, **immediately after the Initiative roll and before the
  first turn is taken**, to swap with one *willing* ally. So the command needs
  three things it does not check: that the swapper holds the feature, that the
  moment is that window, and that the ally consents. Membership and Incapacitated
  it already checks. Which surface it sits on stops being the question once the
  gate exists: a player's choice, gated by the player's own feat.
- **Wild Shape, all four answered.** Gear **merges** by default. The Armour Class
  is **always the stat block's** — the form's AC is not a floor or a choice.
  A form larger than the space it stands in is **normal**: it fills the space
  available around it, and where that puts it in another creature's space, it is
  the forced-movement rule, which the engine already has. **Known forms are
  chosen at the start of a Long Rest**, the way a Cleric prepares spells — the
  same shape, not a creation-time list. And Wild Companion needs no new bond:
  when a Long Rest completes, any Wild Companion familiar that exists goes away.
  A rest already ends things; this is one more.
- **Nimbus Quill's table rolls its own dice.** The app is *not* the table's
  dice: players roll physical dice, the DM says the result aloud, and the client
  works out which state change that result makes. So the third door is the
  answer, and the engine was written for it — `RollSource` already has
  `physical-dice` beside `dm-override`, `recordExternalD20` validates the face
  whoever is holding the die, and `recordExternalDamage` bounds-checks a physical
  total against its notation, because nobody rolls 30 on a `1d4` and trusting a
  transcription error corrupts the log. What is missing is only the door, in its
  own deliberately swept directory, never stamped `engine`, and never on an AI
  DM's surface — which is the one true human/AI line in the whole tool layer.

### The `unknown_spellcasting` mis-tag, resolved by recording the gap

The refusal now carries **no** `ContextRequest` at all — no kind to be wrong
about — and says in its prose that a `declareSpellcasting` would settle it, that
no surface offers one, and that this is a fact the table states directly or not
at all. The three-way split is kept: a Barbarian gets `prerequisite_unmet`
because it casts nothing, and only a stat-block creature nobody has been asked
about reaches the `needs-context`.

The guard that came with it is the durable half. `doors.test.ts` grew
`UNDECLARABLE` — refusals that are homework with no door — whose tests assert
the named command is a real engine export **and still withheld**, so the entry
must be deleted deliberately the day a door opens. Beside it, a fifth guard
parses every `satisfyWith` in the engine sources and fails when a request's tag
is not the kind the named declaration settles, with the historical bug itself as
its fixture, in both shapes.

### Decisions genuinely open

Each of these is a rules or doctrine call a builder stopped rather than guess at.

- Where a reachability measurement lives, since `@ie/tools` depends on
  `@ie/content` and the report cannot import the surface without inverting the
  build.

### Interactions ruled on and half built

- **`rider_deals_damage` keys on the effect kind**, so a `turn-payout` carrying
  dice would slip past it. Harmless while nothing is rolled at the hit.

The rider that fired before the defender answered was the other entry here, and
both its faces are now built — the ordinary path and the held one, the second
being the same change that makes a *Shield* drop a pinned rider unspent.
Reproducing it turned up a crash nothing had reported: three legal commands — a
held swing with a rider pinned, a legal pool use in the window `mayAct`
deliberately leaves open for Divine Smite, then the settlement — emitted a
`resource-spent` the fold could not apply, and `must` threw `CorruptLogError`
rather than refusing. A rider whose price can no longer be paid is now dropped
unspent and reported, because the settlement is the only door out of
`pendingAttack` and a refusal there wedges the fight. Underneath it sat a second
defect: `applyHitRider` handed `runEffects` a state it had already folded its own
events onto, and `runEffects` folds them again — invisible on a pool of five, a
corrupt log on a pool of one.

### Guards, and what they now catch

An empty `each` table is refused suite-wide. The format sweep reads a union arm
by arm and all three hosts of an effect list. A test fails when `COVERAGE.md`
is stale. The spendable-kind sweep builds one character of **every class in the
book** rather than five hand-picked ones. `RiderDuration`'s readers are
exhaustive switches, so a new member is three type errors rather than a silent
caster-anchored deadline. `oneShot` is checked at the item door by the same
function the spell side uses. `doors.test.ts`'s probe can see inside a
discriminated union.

### Traps in the worktrees, not in the code

An empty `node_modules` makes `tsc -b` resolve `@ie/engine` through the main
checkout's `dist` — silent while the two agree. `npm install` links them
correctly; `ln -s` under Git Bash makes **copies**, which go stale and break
`npm run coverage`. Real junctions need `fs.symlinkSync(target, link,
'junction')`. Do not rewrite engine sources with a script that normalises line
endings: three source-parsing tests fail on CRLF and say nothing about why.

### How a batch is sized, corrected

`docs/dev/WORKFLOW.md` says a batch is "four to six hours of parallel work".
That is wrong and it mis-sized this one by a factor of eight: a track runs
about half an hour whatever is queued in it, because it is bounded by tool
budget rather than by brief count. **Batch size is a partition problem** — more
tracks, not longer queues — and the partition is file ownership. Give each
track a distinct anchor when several must add a member to one union, and check
the anchor is in the union you think it is.
