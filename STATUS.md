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
- A set ability score reaches the attack roll, its damage, the ability check,
  the saving throw, Initiative and a Reaction's addend, and **seven readers
  still take the built sheet**: a spell's save DC and spell attack bonus, an
  item's casting, two spell-effect modules, the Concentration save — which an
  Amulet of Health directly prints — the check and save a turn boundary
  repeats, and `selfHealAddend`. The substitution happens in the commands,
  where the state is; `attack.ts` and `checks.ts` take a sheet and hold no
  state, and a roller that went looking for a worn item would be the second
  derivation `sheetAsItStands` exists to prevent. The remaining seven are
  named one by one in that function's docstring. Three catalogue entries —
  Amulet of Health, Gauntlets of Ogre Power, Headband of Intellect — still
  carry an `unmodelled` note saying the rolls read the built score, which is
  now false and is pinned by a passing assertion, so the note and the pin move
  together.
- Seven emitters of `roll-recorded` pass no modes, so the field's absence
  means both "nobody ruled" and "this emitter never says". An attack roll and
  an Initiative roll can each carry Advantage and neither records it.
- Nothing above the engine can summon, so no session can reach the stranded
  debt. The day a summoning tool lands, the sweep must land beside it or a
  model-driven fight can wedge.
- No carried weight, no ammunition spent. Objects that are not creatures
  are not modelled.
- An item cannot fail at being used. Wind Fan's cumulative 20% wants a use
  that records a roll, destroys the fan and produces **no casting** — which is
  not an `err`, because a refusal carries no events, and not a
  `SpellResolution`, because that type requires a `castingId` a casting that
  never happened does not have. It also wants a count of uses since dawn, and
  the only per-copy state the engine holds is a charge pool whose size the
  transcription guard reads off the entry's printed text. Wind Fan prints no
  count, so a pool of six is `100/20` derived.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Next

Ranked by what each shape **finishes**, which is the column beside the one
that mis-sized four briefs. Entries quoting a builder are quoted rather than
re-derived.

1. **A weapon mastery property.** Six manual features, all six finished by
   this one shape and by nothing else — the top of the feature blocker map by
   the column that does not lie. It is two halves and they are one brief: the
   record of which weapons a character has mastery with, and the eight
   properties' own rules (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex)
   inside the attack layer. Five classes print the feature and a sixth swaps
   one property for another. It owns `attack.ts` and the attack commands for
   its batch, so nothing else that touches a roll runs beside it.
2. **A feature that changes a casting's damage.** Five features, five
   finished. The notation, the die and the type are the definition's and are
   pinned when the casting is written, so a modifier on one Evocation's
   damage, a d6 that becomes a d10, and a maximised backlash each want the
   same reader that does not exist.
3. **The seven readers that still take the built sheet.** Named one by one in
   the `sheetAsItStands` docstring by the builder that closed the first six:
   `spell-resolution.ts`, `item-casting.ts`, `spell-effect-rolls.ts`,
   `spell-effect-magic.ts`, `casting.ts` (the Concentration save, which an
   Amulet of Health directly prints), `turns.ts` and `features.ts`. Each is
   the same one-line substitution. It also rewords the three catalogue notes
   that now say something false, and moves the assertion pinning them.
   `rollSpellDice` is **not** among them and needs no change.
4. **A tool that can carry a route.** `packages/tools/src/definitions.ts:833`
   declares `establishes: ['route']` on the `move` tool and its input schema
   has no `route` field; nothing in `packages/tools` mentions `route` or
   `via`. So the engine now asks a question precisely and the door advertised
   for the answer cannot receive it — a model-driven caller still wedges,
   which was most of the point of telling the two refusals apart.
5. **A casting ended by a trigger, re-cut.** The mechanic exists; what is
   left is the cause vocabulary, and one brief must own `timers.ts`,
   `spells.ts`, `fold/endings.ts`, `fold/release.ts`, `spell-definitions.ts`
   and `spell-schema.ts` together, because `EFFECT_END_CAUSES ⊆
   END_TRIGGER_CAUSES` is pinned by a test. `target-takes-damage` finishes
   Modify Memory; a source-item cause plus a route field on `OngoingSpell`
   finishes Hat of Disguise. No new event and no fixture moves: `damage-taken`
   carries `by`, `creature-died` covers True Polymorph, `item-unequipped`
   covers the hat. Everything else in that shape finishes nothing alone.
6. **A condition an item imposes** — 28 blocked, 5 finished, the heaviest item
   shape now that identity and the score verbs have been spent.
7. **Calm Emotions and Hallow.** Both were blocked only by the marker-less
   entry form, which now exists; neither has been written. Hallow prints a
   24-hour casting and eight blockers, so it is the harder of the two by a
   distance.
8. **Feather Fall, for one small mechanic.** `SpellReactionWindow` admits
   exactly three triggers and a fall is not one; `falling` is that spell's
   only recorded blocker and its paragraph is one of three clean ones left.

**A decision before anything above touches it:** what a use of an item that
the item fails to make *is*. Wind Fan needs a fourth outcome beside ok, err
and needs-context, or an optional `failed` arm on `SpellResolution` with
`castingId` made optional — and it needs to be settled whether a count of
uses with no printed size may be a charge pool. Both questions are the
owner's; a builder found them rather than inventing an answer.

**One known flake**, observed independently on an untouched base commit by two
agents: `fold-import-boundary.test.ts` constructs an `ESLint` and lints text
in process, and its first case can exceed the 5s default timeout under
full-suite load. It passes alone. A timeout on that describe block belongs in
whichever brief next opens the file.

Separately, and absorbed by none of the above: Augury, Divination, Commune
and Secret Chest need a count of castings back to a Long Rest that nothing
keeps.
