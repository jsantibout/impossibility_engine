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
- **The defender answers first.** A rider elected on a swing is pinned on the
  pending damage and resolved after it lands, so a target Stunned by the same
  hit still answers the window it was offered.
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
- **Two pools the engine holds with nothing behind them.** Bardic Inspiration
  and Action Surge are counted and recovered and what a use *buys* is
  unexecuted, so both were deliberately given no tool: a pool a caller can
  spend for no effect is worse than one it cannot spend. Channel Divinity has
  come off this list. The Bard's die is **not** a resource handed to another
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
- **A Rage's ten minutes are nobody's to keep.** `capSeconds` is pinned at
  creation and read by no command; `extendFeature` replaces the timer and
  checks nothing else. The surface reports the number and says the bound is
  the table's.
- **No reaction spell and no held casting.** `cast_spell` has no trigger
  field and `takeDamageReaction` / `takeTestReaction` are unimported, so Shield
  sits in the test wizard's spellbook uncast. Counterspell needs more than a
  field: `hold` and `answers` are unoffered and a held casting also wants a
  `resolve_declared_cast` door.
- **Nothing summoned** from above the engine — the one command on this list the
  surface still does not call. Rest, item use, ready/release, weapon mastery and
  a conferred Reaction all have doors; this sentence claimed otherwise for four
  of them until a track was briefed from it and found them already open.
- **A feature cannot be elected on a casting.** `usingFeatures` reaches no
  tool, so no session can spend Overchannel or add Elemental Affinity's
  Charisma. Unlike the other shut doors this one needs a companion: a model
  cannot elect a feature it has not been told it holds.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

**A level 5 party can be built, armed, placed against monsters that fight with
their own printed lines, and played through a fight, a rest, and now an ending.**
The numbers are in `COVERAGE.md` and no sentence here repeats one.

The batch of six tracks that closed on 2026-09-20 taught the same lesson four
times, and it is a lesson about briefs rather than about building: **four of
six briefs named a number taken from a table nobody had checked.** Six doors
were one, three spells were two, four features were one, and Multiattack's 177
blocks were 78. In each case the builder checked, found the truth, and shrank
or re-aimed its own brief. `WORKFLOW.md` rule 1 already says to check the claim
against the code and the book before briefing it; it was applied to one track
of six.

1. **A feature that holds an action rule.** `ActionRule` is reachable from a
   casting and from nothing else. The architect's decision is in hand: a
   derived `StandingGrant` member plus `actionRulesOn(state, id)` merged with
   the stored rules at every `Spend`, **not** a grant stored at creation. 18
   reads across 9 command files. **Honest cost: the door alone finishes none of
   the ten features** — but Hide is now ruled to be the engine's verb, so the
   pair (the door, and the Hide spender) finishes Cunning Action, which the
   door alone never could. Brief them together or neither.
2. **Steady Aim, which is its own shape** — an activated feature that hangs a
   *stored* one-shot at the moment it pays for it, generalising what
   `commands/mastery.ts` does bespoke for Sap and Vex.
3. **The rest of Multiattack, now ruled and briefable.** 78 of the 177 printed
   lines are built. The architect re-derived the other 99 on 2026-09-20 and
   found the five mechanisms are **two**: the book says "a *X attack*" when it
   means a printed attack line (8 of 8 replace-clauses, 2 of 2 alternations)
   and "a *use of X*" when it means a save or prose action (37 of 37, 18 of
   18). So everything composing printed attacks is one structure in three
   wordings, and everything else is a hand-over. Ranked by lines cleared:

   - **R1, the hand-over field — 37 lines.** Parse the first sentence as the
     sequence, carry the second whole as stated text, report it through
     `unverified` at the first swing, the channel a hit's rider already uses.
     Nothing to enforce: making fewer swings than the sequence is already
     legal. 20 of the 37 name Spellcasting, and a dragon cast through the
     engine loses its Rends because a casting spends the action — fixing that
     is a casting that spends an attack, its own brief.
   - **R2, the menu — 41 lines.** One entry, several printed names, one shared
     count: `{ count: 2, attacks: ['Scimitar', 'Pistol'] }`. The caller elects
     swing by swing through `AttackCommand.action`, which already exists. The
     engine never picks.
   - **R4, alternation — 10 lines.** `alternatives: [entries, entries]`, and
     the check becomes "the multiset so far fits *some* alternative". Nothing
     chooses: the branch is fixed by the swings already made. Both branches
     total the same in all ten, so `attacksPerAction` stays one number.
   - **R3, sequence plus a use — 18 lines.** R1's field, landing with it.

   All four ride the shipped per-name multiset and the `feature-used` ledger:
   **no new event, no `TurnBudget` field, no fold change.** The shape change
   must be additive so a Ghoul pinned today still reads.

   Three lines the first categorisation missed: the **pit-fiend** is a pure
   named sequence the parser drops because it splits on ` and ` and an Oxford
   comma leaves a clause it refuses — a parser gap in `@ie/srd`, zero engine
   change, and the chimera shares it; the **clay golem**'s third Slam is gated
   on a Bonus Action the engine does not read, so withhold and report rather
   than build a field for one monster; the **planetar** is R4 with a hand-over
   branch.
4. **The held path of "the defender answers first".** The ordinary path is
   fixed. The *held* path (`hold: true`, SRD Divine Smite's window) still fires
   the rider at the hit, before the target answers `hit-by-attack` — so a
   Stunning Strike can still close a *Shield*. Pre-existing, and now the only
   half of the ruling outstanding.
5. **Doors the engine has and the surface still does not call**: the `action`
   field for a monster's printed attack, `among` on `use_pool_option` (recorded
   in `doors.test.ts` as a refusal the surface cannot answer), and summoning —
   which must land with its sweep beside it or a model-driven fight can wedge.
6. **An atomic casting's handover is not pinned to its log.** The three DM-text
   spells are long castings, so their text rides `PendingCasting.unverified` on
   `spell-declared` and rule 5 holds. An atomic casting's handover reaches its
   caller and nothing else. Closing it is a field on `spell-cast`.
7. **Augury's class of line.** "The omen is the GM's" is still filed
   `unmodelled`, which is a debt the blocker table ranks and somebody may one
   day pay. Under the ruling it is a handover, which nobody will ever pay.
   Re-filing that class across the catalogue turns fake debt into honest
   handovers and costs no engine change.
8. **An unlimited trade is built; three features still are not.** Font of
   Inspiration, Sorcery Incarnate and Holy Nimbus each spend through the new
   arm and each keeps a clause blocked on a shape the engine lacks — a
   Short-Rest recovery rewrite, the two-Metamagic limit rewrite, an aura with
   no-roll damage and a save-side mode. Flipping them to `engine` would delete
   four real gaps from the blocked-on map.
9. **The long tail**: the item range shape (two fields, not one), a casting
   ended by a trigger, the remaining Metamagic options,
   `an-effect-list-a-hit-buys` for the Rogue's Cunning Strike, `holdings.ts`
   listing a feature once under first-claim-wins (unreachable until a homebrew
   feature grants both a pool option and a hit rider), and the bestiary's
   ranked prose table.


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
- **The Hydra's count is nobody's to derive** (architect, 2026-09-20). Reading
  "five heads" off a trait would print a number for a turn the book did not:
  heads die at 25 damage in a turn and regrow at the end of it, none of which
  is state. It bites once per action. **Open, and the owner's:** may a DM
  *state* the count turn by turn — a fact only the table tracks, for an attack
  the block names — or does it wait for a second creature that needs one? An
  engine-derived count was refused as fabrication; a DM-declared count is a
  fact handed over, and no tool sets even `free: true` today.
- **A fight ends** when no hostile combatant remains or the hostiles
  surrender. A flight is a prompt, not an end: the players are offered the
  choice to let the enemy go before combat closes, because many tables want to
  finish them. `endCombat` ships with the clock refusal held on
  `held/clock-in-combat`.

### Queued by the owner for the next batch

- **The `unknown_spellcasting` mis-tag.** `commands/inventory.ts:592-604` raises it
  as `kind: 'creature'` with `satisfyWith: declareSpellcasting`, so
  `doorsFor('creature')` answers `create_character` / `add_creature` — an
  orchestrator told to create a creature that already exists. Found by the
  architect on 2026-09-20 while ruling on the `side` kind, and queued by the
  owner the same day.

  It is not a retag. A `spellcasting` kind would have **no door**, because
  `declareSpellcasting` is withheld on both surfaces (`doors.test.ts:426`), and
  the architect's own rule says a fact no command can declare is a gap in the
  doors rather than a kind — while the same rule says a command-level
  `needs-context` always carries a request. The brief has to resolve that
  tension: open the door, or record the gap and say what the refusal carries
  meanwhile.

### Decisions genuinely open

Where a reachability measurement lives, since `@ie/tools` depends on
`@ie/content` and the report cannot import the surface without inverting the
build.

### Interactions ruled on and half built

- **A rider fires after `landDamage`** — fixed on the ordinary path:
  `PendingDamage.rider` pins the election and `settleDamage` resolves it after
  the damage lands, so the defender answers first. The **held** path does not:
  with `hold: true` the rider still fires at the hit, before the target answers
  `hit-by-attack`, so a Stunning Strike can still close a *Shield*. That half
  is item 4 above.
- **`rider_deals_damage` keys on the effect kind**, so a `turn-payout` carrying
  dice would slip past it. Harmless while nothing is rolled at the hit.

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
