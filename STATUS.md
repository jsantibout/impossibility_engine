# Status

What runs, what does not, and the rulings that stand. Counts live in
`COVERAGE.md` and `LEDGER.md`, never here. **What happens next is
`docs/ROADMAP.md`**; this file holds no "Next".

Capped at two thousand words (`docs/ROADMAP.md` §1.5); the long version is
frozen at `docs/archive/status-2026-09-21.md`.

## What runs

A pure, deterministic, event-sourced rules engine for D&D 2024 (SRD 5.2.1),
with the SRD catalogue as a separate content package and the same door open to
homebrew.

- **Dice and rolls** — seeded and replayable, every roll with provenance; the
  D20 pipeline with named modifiers and attributed advantage; typed damage
  against per-type defences; criticals; reaction windows held open.
- **Creatures** — derived character sheets, stated monster sheets, all
  fifteen conditions with their sources, hit points, temporary hit points
  with a lifetime, death saves, exhaustion; every ability a roll reads comes
  off `sheetAsItStands`, lowered scores included.
- **Space and sight** — a cube lattice, distance between volumes, declared
  sight and cover, seven area shapes, persistent and carried areas imposing a Speed, bonus, condition, defence or silence on whoever stands inside, bar passage,
  ward other magic or deflect arrows, teleportation, the glossary's senses, mounting. **Light and obscurement are patches on the lattice**, declared or laid by a casting; magical darkness beats Darkvision, Devil's Sight beats that. A spell can push or lift a creature; a fall has a landing (1d6 per ten
  feet to 20d6, and Prone); going up needs a way up. A creature may be **elsewhere**, ethereal, extradimensional or swallowed, with its way back pinned: Blink, Rope Trick, the familiar's pocket, the Swallows and the Ethereal lines run on it.
- **Combat and time** — Initiative and Alert's swap, the action budget, an
  extra action a running effect grants, a slot of somebody else's turn spent
  by a spell, joining a running fight, the clock, turn-anchored deadlines,
  repeat saves and delayed damage at the boundary, Short and Long Rests. A creature stands up for half its Speed unless a spell forbids it; the Bearded Devil's wound bleeds and closes on a minute, a Medicine check or a heal; forced movement stops at a barrier; a reversed Magic Circle binds the creature it holds. A
  fight **ends** when no hostile remains or they surrender.
- **Monsters that fight from their own printed lines** — Multiattack as a
  named sequence, an opportunity attack reaching for the best printed melee
  attack, recharge and daily limits enforced, sunlight sensitivity, and the
  Hydra's declared head count. **A printed saving throw is an effect list**: the DM's door rolls it and the
  engine applies what the failure prints — damage, a condition, a grapple, a
  push, a mode, a penalty, a worn-down object, a revealed fact — handing over
  what it could not read; a legendary block's uses are a pool spent one per
  turn boundary; a printed teleport is spent at its distance, a
  printed Reaction adds to an ally's roll, and a block's aura, absorption and frenzy are read off its traits; a hit may set a creature **burning** (put out by its own action), wear its armour down, or hand a graded failure to
  the printed-save reader; a save may spin a web; a Parry raises Armour Class in the hit window; a printed Reaction may spend another line; a cast line is spent at its heading's price; a creature carries its Challenge Rating, may take its block's printed form, and a Roper reels what it holds. A block's move executes: Deadly Leap and Trampling Charge with a save per space entered, the Leaps, the Dashes, Tree Stride, the Charges; dragging and crawling cost extra feet.
- **Features that do something** — an action rule a feature holds, a use that
  hangs something a later roll spends, a pool use that buys room in the turn
  budget, the Unarmed Strike's three options, fighting styles, weapon
  masteries, and the defender answering first on both paths. A feature may
  carry several grants, each gated on one option of its choice; a species may
  grant a spell; a feature may raise the hit point maximum; a reroll may be **elected**
  on the roll command — if it misses, fails, or shows a named face or lower (Heroic Inspiration). **The glossary's
  Help, Influence, Search, Study and Utilize are actions a command spends**,
  the Light property's extra attack carries Nick and Two-Weapon
  Fighting, and the small named features, Savage Attacker to Primal Order, execute; a feature may ask two questions, grant a language, or know a quarry's defences through `look`; Eldritch Invocations executes whole, both Pacts included. **Wild Shape executes**: a Druid wears a learned Beast's stat block, keeps the SRD's retained half, and comes back by every ending the book names.
- **Casting and spells** — slots and Pact slots as pools, castings with identities, Concentration, ongoing spells, the effect and rider kinds, dice that behave as their spell says, printed sentences handed to the DM marked as theirs, and **passive defences** the attack path consults while the defender elects nothing. A casting may revive the dead, break an
  attunement, mask a type for magic alone, heat an object out of a hand, cap
  its own running copies, ward a fall, or lift a creature a save did not spare;
  a spell may print branches and run the one named, hang a rider on a made
  save, make a creature subtract from its own damage rolls, or pick out D20
  Tests by ability; Shield answers both its triggers; a spell may re-aim what it granted on a later turn, a slot may drop its Concentration, a save may be nothing but its verdict or be cast on a hit and fought off by
  a neighbour's check, a spell's attack may leap to creatures the caster names,
  a spell may print its own stat block, a casting may leave something behind
  when it ends or be dismissed by its target, a slot may change what kind of ending a casting
  has, a Speed may be replaced, and a repeat save may be raised by a blow; a casting may choose a branch per creature, suppress a held condition, move a body a size step, re-choose its branch, pin an Emanation in place, and erupt on a DM's decision. A summons may be **controlled** (Animate Dead's, a day's bond that lapses while the creature stays) or **commanded** for a Bonus Action; Find Steed's slam carries the paladin's numbers. Spike Growth cuts by the route, Gust of Wind charges by the step, a lifted creature climbs a stated surface, Warding Bond runs whole, Nondetection wards a school, Sending throws its die, and a repose's days stay spent; a tracked spell read to
  the end carries its text in `dmDecides` and the ledger counts it apart.
- **Characters** — twelve SRD classes with their subclass, nine species,
  backgrounds, feats, multiclassing, creation and advancement.
- **Items and objects** — grants live while worn or wielded, attunement,
  charges, a copy told apart from its twin, an item that moves between
  people, a purse. **An item nobody holds lies on the floor**
  with an instance id, and a creature can be too laden to lift it. **An object is declared into the scene and broken**: a door stated by
  material and size, swung at and destroyed, with a threshold. **Hands are a count**: a Two-Handed weapon and a shield refuse each other, and a conjured thing occupies one while its casting runs.
- **Content** — `createContent` / `loadContent` validate a catalogue from
  JSON text; homebrew uses the same door.
- **Two doors above the engine** (`@ie/tools`) — the player's and, under
  `dm/`, the DM's, partitioned by **authority**: a DM's door takes a decision
  the rules leave open, and neither takes a die face.
- **Measurement, as tests rather than claims** — `COVERAGE.md` and `LEDGER.md` are generated and go stale loudly; `reachability.test.ts` fails on a feature no door reaches; `level-five-session.test.ts` plays a party through a fight, rests and a level-up.

## What does not

- **No orchestration, persistence or web app.** Nothing stores a log. The
  engine has no idea a language model exists.
- **Spells needing a mechanic the engine lacks are *tracked*** — cast, costed,
  timed, effect left to the table. `LEDGER.md` names each and its shape.
- **No feature in a level 5 character's reach is `manual`**; the Champion's
  second Fighting Style at level 7 still is. Every pool buys something.
- **A Druid's known forms are the ones it was made with**; no rest replaces one, and the block's senses are not carried.

- **Jumping is half**; Slow Fall is elected on the landing.
- **A printed hit is read clause by clause**, what nothing read handed back. A repeat save may deepen its condition
  and stop asking; Resistance's d4 comes off the total before defences.
- **Nothing brings a jumper down** from a High Jump.
- No ammunition spent. **An object cannot make an ability check**, and may be put in the turn order.
- A conferral refuses by name what it cannot do: attack bonuses, set ability scores, curses, item Speed.
- **Two corpus migrations are owed**: a weapon mastery is a ceiling, not a
  quota; an unchosen size defaults rather than refusing.
- Homebrew adds beside printed content, never overriding an id.

## Rulings that stand

Each is a decision, not a task; the argument behind each is in
`docs/archive/status-2026-09-21.md`.

**Owner, 2026-09-20, and the four ruled just after that batch** — Hide as the
engine's verb, size as a creation choice, Multiattack needing composition, a
monster's opportunity attack, "permanent" as a duration, DM-only text, Channel
Divinity's shared pool, the defender answering first, recharge, `alsoHolding`,
the Hydra's declared heads and derived Bites, a fight that ends; then Truesight
and Blindsight satisfying "can somehow see" where Darkvision does not, Alert's
swap and its window, Wild Shape's four answers, and Nimbus Quill's table
rolling its own dice. **Each is quoted in full in `docs/archive/status-2026-09-21.md`.**

**A builder's ruling, recorded rather than drifted into.** A creature at 0
hit points, or dead, keeps its hit points when a maximum rises: raising them
would lift the Unconscious that having none caused, which SRD lifts only on
regaining hit points. Argued in `vitals.ts`, pinned by two fixtures.

**Owner, 2026-09-21.** Infinite Realms is the AI-DM product, Nimbus Quill the
human DM's companion · **"playable to level 5" means everything a level 1–5
character can reach is executed** · persistence is Supabase with the event log as the only truth · one
player per campaign for the first release · Infinite Realms calls OpenAI, so the wire format is OpenAI function
calling · movement modes are ordinary spatial dynamics and are built · Find Familiar names a bestiary id at the
casting, and Find Steed's and Phantom Steed's stat blocks are catalogue entries · the
sight model is built.

## Decisions genuinely open

- **The provenance chain.** Which nested rolls a physical-dice table also
  throws (the Concentration save inside the damage command, turn-boundary
  saves, Initiative, death saves); whether the third door offers `dm-override`
  as well as `physical-dice`; and where that door lives.
- **An ally's side on Alert's swap** — nothing checks the two are on the same
  side, and a null side means nobody has said, so it wants its own request.
- The rest are tracked in `docs/ROADMAP.md` §10, which is where a foreman
  appends a new one.

## Traps in a worktree, not in the code

A worktree is not a clone: an empty `node_modules` makes `tsc -b` resolve
`@ie/engine` through the main checkout's `dist`, silently, while the two
agree. `npm install` links them; `ln -s` under Git Bash makes *copies* that go
stale. The generated SRD data is gitignored and must be copied in, and
`npm run srd:index` must never run in a worktree against it — re-ingest first
or leave it alone. And **editing source with Python on Windows rewrites it
CRLF**, which breaks the guards that parse source line by line and presents as
a content defect: pass `newline='
'`.
