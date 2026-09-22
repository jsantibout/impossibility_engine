# Status

What runs, what does not, and the rulings that stand. Counts live in
`COVERAGE.md` and `LEDGER.md` (`npm run coverage`, `npm run ledger`), never
here. **What happens next is `docs/ROADMAP.md`** — the phases, the gates and
the tracks to playable levels 1–5 through Infinite Realms. This file no longer
holds a "Next".

Capped at two thousand words by `docs/ROADMAP.md` §1.5. The long version —
every capability with its reasoning, every ruling with the argument behind it,
and the batch notes — is frozen at `docs/archive/status-2026-09-21.md`.

## What runs

A pure, deterministic, event-sourced rules engine for D&D 2024 (SRD 5.2.1),
with the SRD catalogue as a separate content package and the same door open to
homebrew.

- **Dice and rolls** — seeded and replayable, every roll with provenance; the
  D20 pipeline with named modifiers and attributed advantage; typed damage
  against per-type defences; criticals; reaction windows held open; every
  individual face a blow was made of, in the log.
- **Creatures** — derived character sheets, stated monster sheets, all fifteen
  conditions with their sources, hit points, temporary hit points with a
  lifetime, death saves, exhaustion. Every ability a roll reads comes off
  `sheetAsItStands`, so a substitution reaches all of them.
- **Space** — a cube lattice, distance between volumes, declared sight and
  cover, six area shapes, persistent and carried areas, teleportation,
  mounting, the glossary's four senses. A spell can push a creature, and a
  fall the table declares has a landing: 1d6 per ten feet to 20d6, and Prone.
- **Combat and time** — Initiative and Alert's swap within its window, the
  action budget, joining a running fight, the clock, spans and turn-anchored
  deadlines, repeat saves and delayed damage raised at the boundary, Short and
  Long Rests. A fight **ends**: `endCombat` closes one when no hostile remains
  or the hostiles surrender, and the event pins why.
- **Monsters that fight from their own printed lines** — Multiattack as a named
  sequence, an opportunity attack reaching for the best printed melee attack,
  recharge enforced and returned on a rest, spendable Bonus Actions, daily
  limits cleared at a declared dawn, a printed line the parser could not read
  spendable through the DM's door, and a count the table keeps for the Hydra.
- **Features that do something** — a feature that holds an action rule, a use
  that hangs something a later roll spends, a pool use that buys room in the
  turn budget, the Unarmed Strike's three options, fighting styles, weapon
  masteries, and the defender answering first on both the ordinary and the held
  path.
- **Casting and spells** — slots and Pact slots as pools, castings with
  identities, Concentration, ongoing spells, the effect kinds and three rider
  kinds, dice that behave the way their spell says, and printed sentences
  handed to the DM marked as theirs alone.
- **Characters** — all twelve SRD classes with their SRD subclass, all nine
  species, backgrounds, feats, multiclassing, creation and advancement.
- **Items** — grants live while worn or wielded, attunement, charges, a copy
  told apart from its twin, an item that moves between people, a purse in the
  denomination the DM names. **Hands are a count**, so a Two-Handed weapon and
  a shield refuse each other, and a conjured thing occupies one for as long as
  its casting runs.
- **Content** — `createContent` / `loadContent` validate a catalogue from JSON
  text; homebrew goes through the same door the SRD does, and adding content
  that uses mechanics the engine already has touches no engine file.
- **Two doors above the engine** (`@ie/tools`) — the player's and, under `dm/`,
  the DM's, partitioned by **authority** rather than by species of caller: a
  DM's door takes a decision the rules leave open, and neither door takes a die
  face. A `Campaign` holds the seed, the content and the log; state is a cache.
- **Measurement, as tests rather than claims** — `COVERAGE.md` and `LEDGER.md`
  are generated and go stale loudly; `reachability.test.ts` builds a level 5
  character of every path and fails on an engine feature no door reaches; and
  `level-five-session.test.ts` plays a party through a fight, two rests and a
  level-up, printing what the engine handed to the DM.

## What does not

- **No orchestration, persistence or web app.** Nothing stores a log. The
  engine still has no idea a language model exists, which is the point.
- **Spells whose text needs a mechanic the engine lacks are *tracked*** — cast,
  costed, timed, effect left to the table — rather than executed. `LEDGER.md`
  names each and the shape it waits on.
- **Most class, species and background features past the common shapes are
  `manual`** with a note saying what is missing.
- **Four pools count and refill truthfully and buy nothing**: Wild Shape,
  Paladin's Channel Divinity, Font of Magic, Arcane Recovery. Each is recorded
  in `reachability.test.ts`'s `NOTHING_TO_BUY`, checked in both directions, so
  one that opens deletes its line in the same commit.
- **A casting cannot summon.** The door is built and the effect kind is not, so
  a caller must cast, read the `castingId` back and summon by hand.
- **Nothing reduces damage an effect has rolled**, which is why Feather Fall
  and a Monk's Slow Fall do not work and why `FeatureReactionWindow` still
  excludes `creature-falling`.
- **Movement has one speed and no modes.** Fly, Climb, Swim and Burrow are
  ruled to be built and are not; the readers they need span three files.
- **A printed stat-block rider executes only where it imposes a condition** —
  gated on the target's size, or on the attacker's next turn. A printed saving
  throw, a grapple with its escape DC, and a span anchored on the *target*
  each wait on one field apiece.
- **A stat block's attack refuses `hold`**, so a party fighting monsters is
  never offered the window SRD *Shield* answers.
- No carried weight, no ammunition spent, no objects that are not creatures.
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

**Owner, 2026-09-20.** Hide is the engine's verb (cover or obscurement, no line
of sight, then DC 15 Stealth) · a character's size is a creation choice ·
Multiattack needs composition, because a count-only version lets a Ghoul make
two Claws · a monster's opportunity attack is its best printed melee attack
that does not recharge · "permanent" is a real duration and carries its source ·
some printed text is the DM's alone and is handed over marked as such · Channel
Divinity is a shell with one shared pool and each option is a form it takes ·
the defender answers first · a use may name an attack, so the hand-over should
be decided by what the named action *is* rather than by how the sentence reads
(**queued**) · recharge is enforced, and a recharge ability also returns on a
rest · `alsoHolding` stays although no catalogue can reach it, because a reader
that drops data when a validator loosens is the coupling that bites · the
Hydra's head count gets its own event rather than a general shape · *Shield*
drops a pinned rider unspent · the Hydra's heads are declared and its Bites
derived from them — the first DM door that takes a number, on the line that a
number the *engine* produces is a fabrication and a number the *table* states
is a fact · a fight ends when no hostile remains or they surrender, and a
flight is a prompt rather than an end.

**Ruled after that batch.** Truesight and Blindsight satisfy "if a creature can
somehow see you"; Darkvision does not · the Initiative swap is Alert's, gated
on the feat, the window and the ally's consent · Wild Shape: gear merges, the
AC is always the stat block's, a form larger than its space is the
forced-movement rule, known forms are chosen at the start of a Long Rest, and a
Wild Companion familiar goes away when one completes · Nimbus Quill's table
rolls physical dice, so the third door is the answer — its own swept directory,
never stamped `engine`, never on an AI DM's surface.

**Taken by a builder and recorded here rather than drifted into.** A creature
at 0 hit points, or dead, keeps its hit points when a maximum rises: raising
them would lift the Unconscious that having none caused, and the SRD lifts that
"until you regain any Hit Points", which a maximum does not do. It is a reading
rather than a printed sentence, argued in `vitals.ts` and pinned by two
fixtures, so changing it is a decision rather than a drift.

**Owner, 2026-09-21.** Infinite Realms is the AI-DM product and Nimbus Quill the
human DM's companion · **"playable to level 5" means everything a level 1–5
character can reach is executed**, not the common turn executed and the rest
narrated · persistence is Supabase, with the event log as the only truth · one
player per campaign is acceptable for the first release · Infinite Realms calls
OpenAI and lets it use the engine's tools, so the wire format is OpenAI
function calling and `docs/design/claude-integration.md` describes a provider
that is not the product's · movement modes are ordinary spatial dynamics and
are to be built, reversing an archived refusal · Find Familiar names a bestiary
id at the casting, and Find Steed's and Phantom Steed's stat blocks become
catalogue entries · the sight model (light and obscurement) is to be built,
accepted as complicated · the feature blocker map was widened to pool-only
features (done).

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

A worktree is not a clone. An empty `node_modules` makes `tsc -b` resolve
`@ie/engine` through the main checkout's `dist`, silently, while the two agree;
`npm install` links them correctly, and `ln -s` under Git Bash makes *copies*
that go stale. The generated SRD data is gitignored and must be copied in, and
`npm run srd:index` must never be run in a worktree against it. Do not
normalise line endings with a script: several source-parsing tests fail on CRLF
and say nothing about why.
