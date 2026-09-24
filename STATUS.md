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
  against per-type defences; criticals; reaction windows held open; every face
  a blow was made of, in the log.
- **Creatures** — derived character sheets, stated monster sheets, all fifteen
  conditions with their sources, hit points, temporary hit points with a
  lifetime, death saves, exhaustion. Every ability a roll reads comes off
  `sheetAsItStands`.
- **Space and sight** — a cube lattice, distance between volumes, declared
  sight and cover, six area shapes, persistent and carried areas,
  teleportation, the glossary's four senses, mounting. **Light and obscurement
  are patches on the lattice**, declared by the table or laid by a casting;
  magical darkness beats Darkvision and nonmagical light, Devil's Sight beats
  that, and an undeclared scene answers as it always did. A spell can push a creature; a fall has
  a landing (1d6 per ten feet to 20d6, and Prone); and **going up needs a way
  up** — a move that ends higher is refused unless it flew, climbed, burrowed
  or jumped.
- **Combat and time** — Initiative and Alert's swap, the action budget, an
  extra action a running effect grants each turn, a slot of somebody else's
  turn spent by a spell, joining a running fight, the clock, turn-anchored
  deadlines, repeat saves and delayed damage at the boundary, Short and Long
  Rests. A fight **ends** when no hostile remains or they surrender.
- **Monsters that fight from their own printed lines** — Multiattack as a named
  sequence, an opportunity attack reaching for the best printed melee attack,
  recharge enforced and returned on a rest, spendable Bonus Actions, daily
  limits cleared at a declared dawn, sunlight sensitivity on five blocks, and
  the Hydra's declared head count. **A printed saving throw is an effect
  list**: the DM's door rolls it, the engine applies the failure's damage,
  condition, grapple, push, Speed cut or lowered maximum, and hands over each
  sentence it could not read; a printed teleport is spent at its distance, and
  a printed Reaction adds to an ally's roll.
- **Features that do something** — an action rule a feature holds, a use that
  hangs something a later roll spends, a pool use that buys room in the turn
  budget, the Unarmed Strike's three options, fighting styles, weapon
  masteries, and the defender answering first on both paths. A feature may
  carry several grants, each gated on one option of its choice; a species may
  grant a spell; a feature may raise the hit point maximum. **The glossary's
  Help, Influence, Search, Study and Utilize are actions a command spends**,
  the Light property's extra attack carries Nick and Two-Weapon
  Fighting, and Savage Attacker, Luck, Relentless Endurance, Powerful
  Build, Tactical Shift, Fast Hands, Naturally Stealthy, Jack of All Trades,
  Slow Fall, Second-Story Work, Adrenaline Rush, Stonecunning, Large Form,
  Draconic Flight, Wild Companion, Ritual Adept, Paladin's Smite,
  Innate Sorcery, Divine Order and Primal Order
  execute; a feature may ask two questions, grant a language, or know a
  marked quarry's defences through `look`. **Wild Shape executes**: a
  Druid wears a learned Beast's stat block for the hours the table prints,
  with the SRD's retained half kept, and comes back by every ending the book
  names.
- **Casting and spells** — slots and Pact slots as pools, castings with
  identities, Concentration, ongoing spells, the effect and rider kinds, dice
  that behave the way their spell says, printed sentences handed to the DM
  marked as theirs, and **passive defences** the attack path consults while
  the defender elects nothing. A casting may revive the dead, break an
  attunement, mask a type for magic alone, heat an object out of a hand, cap
  its own running copies, ward a fall, or lift a creature a save did not spare.
- **Characters** — twelve SRD classes with their subclass, nine species,
  backgrounds, feats, multiclassing, creation and advancement.
- **Items and objects** — grants live while worn or wielded, attunement,
  charges, a copy told apart from its twin, an item that moves between people,
  a purse in the DM's denomination. **An item nobody holds lies on the floor**
  with an instance id, and a creature can be too laden to lift it. **An object
  is declared into the scene and broken**: a door stated by material and size,
  swung at and destroyed through the paths a creature already takes, with a
  damage threshold that turns a superficial blow aside. **Hands are a count**, so a Two-Handed weapon and a
  shield refuse each other and a conjured thing occupies one while its casting
  runs.
- **Content** — `createContent` / `loadContent` validate a catalogue from JSON
  text; homebrew goes through the same door the SRD does, and content using
  mechanics the engine has touches no engine file.
- **Two doors above the engine** (`@ie/tools`) — the player's and, under `dm/`,
  the DM's, partitioned by **authority** rather than by species of caller: a
  DM's door takes a decision the rules leave open, and neither takes a die face.
- **Measurement, as tests rather than claims** — `COVERAGE.md` and `LEDGER.md`
  are generated and go stale loudly; `reachability.test.ts` fails on an engine
  feature no door reaches, for a level 5 character of every path; and
  `level-five-session.test.ts` plays a party through a fight, two rests and a
  level-up, counting what the engine handed to the DM.

## What does not

- **No orchestration, persistence or web app.** Nothing stores a log. The
  engine still has no idea a language model exists, which is the point.
- **Spells needing a mechanic the engine lacks are *tracked*** — cast, costed,
  timed, effect left to the table. `LEDGER.md` names each and its shape.
- **Two features in a level 5 character's reach are still `manual`** —
  Eldritch Invocations' second half and Resourceful's reroll window — and the
  Champion's second Fighting Style at level 7. Every pool buys something;
  `reachability.test.ts`'s `NOTHING_TO_BUY` is checked in both directions.
- **A Druid's known forms are the ones it was made with.** SRD lets one be
  replaced when a Long Rest ends and no rest offers that yet; the form's limbs
  decide nothing about what can be held; the block's senses are not carried;
  and the monster side of the same swap (Doppelganger, Imp, Werewolf) is not
  built.
- **A summons still carries one debt.** A casting raises a creature out of the
  bestiary, keeps it for its caster where the spell says so, states its form
  and type, and seats it after its rider; what no field can hold is a printed
  line whose numbers are the summoner's — the Otherworldly Steed's attack and
  Bonus Actions — and a creature stowed somewhere that is not the scene.
- **Jumping is half.** A Thief's running jump lengthens by the Dexterity
  modifier; Slow Fall is elected on the landing rather than in a window.
- **A printed hit is read clause by clause**: the charge, a push or pull, a
  Speed cut, a lowered maximum, a one-roll mode, a grapple that implies
  Restrained and extra damage execute; what nothing read is handed back and
  the ledger keeps the block. A repeat save may deepen its condition and stop
  asking, and Resistance's d4 comes off the total before defences.
- **Nothing brings a jumper down.** A High Jump leaves the creature at the
  elevation it reached and no rule ends that; a lifted one is set down when
  its casting ends.
- No ammunition spent. **An object cannot make an ability check** — a door
  asked for one rolls at −5 and can succeed, where it should refuse; and
  nothing stops a caller putting an object in the turn order, which would
  leave a fight unable to close.
- A conferral refuses by name what it cannot do: bonuses to spell attack rolls,
  ability scores an item sets, curses, Speed from an item.
- **Two corpus migrations are owed**: a weapon mastery is a ceiling rather than
  a quota, and a size nobody chooses defaults rather than refusing. Making
  either required is a fixture migration.
- Overriding printed content with homebrew of the same id is refused; only
  adding beside it is supported.

## Rulings that stand

Each is a decision, not a task; the brief that acts on one cites it here. The
argument behind each is in `docs/archive/status-2026-09-21.md`.

**Owner, 2026-09-20, and the four ruled just after that batch** — Hide as the
engine's verb, size as a creation choice, Multiattack needing composition, a
monster's opportunity attack, "permanent" as a duration, DM-only text, Channel
Divinity's shared pool, the defender answering first, recharge, `alsoHolding`,
the Hydra's declared heads and derived Bites, a fight that ends; then Truesight
and Blindsight satisfying "can somehow see" where Darkvision does not, Alert's
swap and its window, Wild Shape's four answers, and Nimbus Quill's table
rolling its own dice. **Each is quoted in full, with its argument, in
`docs/archive/status-2026-09-21.md`** — they are settled, and repeating them
here costs the words this file is capped at.

**Taken by a builder and recorded here rather than drifted into.** A creature
at 0 hit points, or dead, keeps its hit points when a maximum rises: raising
them would lift the Unconscious that having none caused, and the SRD lifts that
"until you regain any Hit Points", which a maximum does not do. It is a reading
rather than a printed sentence, argued in `vitals.ts` and pinned by two
fixtures, so changing it is a decision rather than a drift.

**Owner, 2026-09-21.** Infinite Realms is the AI-DM product, Nimbus Quill the
human DM's companion · **"playable to level 5" means everything a level 1–5
character can reach is executed**, not the common turn executed and the rest
narrated · persistence is Supabase with the event log as the only truth · one
player per campaign for the first release · Infinite Realms calls OpenAI, so
the wire format is OpenAI function calling and
`docs/design/claude-integration.md` describes a provider that is not the
product's · movement modes are ordinary spatial dynamics and are built,
reversing an archived refusal · Find Familiar names a bestiary id at the
casting, and Find Steed's and Phantom Steed's stat blocks are catalogue
entries · the sight model is built · the feature blocker map was widened to
pool-only features.

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
