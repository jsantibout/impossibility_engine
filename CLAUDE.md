# InfiniteRealms — CLAUDE.md

## Project Identity

An AI Dungeon Master for D&D 2024, built on SRD 5.2.1. TypeScript monorepo:
pure rules engine → tool surface → Claude orchestration → Fastify + React.

Target user: a player who wants a real D&D campaign — solo or with friends —
run by a DM with actual personality and rules you can trust.

## The Inviolable Rule

**The model never produces a number.**

It cannot roll a die, write an HP total, or decide whether a save succeeded. It
states intent by calling a tool; the engine rolls, validates legality, and
returns the outcome; the model narrates what the event log says happened.

Everything else in this document is downstream of that. When a change would let
the model assert a mechanical fact directly, the change is wrong — even when it
would be simpler, and even when the model would probably get it right.

### Where the rule actually lives: provenance, not purity

The engine enforces that damage comes from a roll it **issued** — never from a
bare number. It does *not* enforce that every roll came from its own generator,
because the same engine has to serve two different tables:

| | AI DM (Maestro) | Human DM (e.g. NimbusQuill) |
|---|---|---|
| Engine-generated rolls | yes | yes |
| `recordExternalD20` / `recordExternalDamage` | **never exposed** | exposed |

A human DM legitimately fudges rolls — softening a TPK, letting a good idea
land. That is a core skill of running a table, not an abuse of it. A model
doing the same thing is a bug. So the *capability* lives in `rolls.ts` and the
*policy* lives in each tool surface: Maestro's simply never exposes the
external functions, so every roll it can reach is `engine`-sourced.

Every roll therefore carries a `RollSource` of `engine`, `physical-dice`, or
`dm-override`, and the log stays honest about which numbers were rolled and
which were decided. Only the engine's own roll functions may stamp `engine` —
`recordExternal*` refuses that source, so the layer above cannot forge the
audit trail.

Roll ids are sequential from a caller-supplied prefix, never random: replaying
a log has to reproduce the same ids, or every RollId reference in the event log
breaks on restart.

## Commands

```bash
pnpm install
pnpm test                 # Vitest, all packages
pnpm test:watch
pnpm test:coverage
pnpm run typecheck        # tsc -b (build) + tsconfig.tests.json (tests)
pnpm run lint             # ESLint 9 flat config
```

Postgres is not required until M3.

## Architecture

Five layers, strictly one-directional. Nothing below the tool boundary knows an
LLM exists — the engine has no idea it is being driven by a language model, and
that is the point.

```
React (Vite) ──SSE──► Fastify ──► DM orchestrator (Claude Opus 5, tool runner)
                                        │  tools only — never direct state writes
                                        ▼
                                  @ie/tools   Zod-validated tool surface
                                        ▼
                                  @ie/engine     pure, deterministic, seeded
                                        ▼
                                  @ie/srd        typed SRD 5.2.1 data

                    Postgres: event log (authoritative) + pgvector (narrative memory)
```

| Package | Responsibility |
|---|---|
| `@ie/shared` | Branded ids, D&D vocabulary, the `Result` type |
| `@ie/srd` | SRD 5.2.1 ingested into typed, schema-validated data |
| `@ie/engine` | The rules. Pure functions plus a reducer over `GameEvent` |
| `@ie/tools` | Engine operations exposed to Claude as tools *(M2)* |
| `@maestro/dm` | Prompt assembly, persona, working context, the loop *(M2)* |

## Inviolable Rules

- **The model never produces a number** — see above.
- **Tests come first** — write the failing test, watch it fail for the right
  reason, then implement. `packages/engine` is pure, so there is no excuse.
- **`packages/engine` stays pure** — no `Math.random`, no `Date.now`, no
  `crypto.randomUUID`, no I/O. ESLint enforces this (`no-restricted-properties`,
  scoped to the engine in `eslint.config.js`); the probe is not decoration.
- **State mutates only through `GameEvent`** — the event log is authoritative,
  `GameState` is a fold over it. No direct mutation, anywhere.
- **Rules-legal refusals are values, not exceptions** — return `err(code, reason)`
  so the DM can narrate around it ("you're out of third-level slots").
  Exceptions are reserved for programmer error.
- **SRD attribution ships with every build** — see `ATTRIBUTION.md`. Product
  Identity excluded from the SRD must never enter `packages/srd/raw/`.

## The Event Log

`GameState` is a fold over a list of `GameEvent`s; nothing mutates state by any
other route. `events.ts` owns the union and the reducer.

**Events carry resolved outcomes, not intents.** A die is rolled once, when it
is rolled, and the result is recorded forever. Replaying applies those recorded
numbers; it does not roll again. Replaying *intents* through the rules would
mean every future rules fix silently rewrote history, and a campaign played
last week would resolve differently today. So randomness enters the log exactly
once, at the point of the roll, and the fold is a pure function of what is
written down. The seed and generator state are recorded only so a **live**
session resumes its sequence — a replay never needs them, and there is a test
asserting two different seeds fold the same log identically.

**A corrupt log is loud.** Rules-legal refusals never become events: the command
layer asks the engine first and emits nothing if the answer is no. So a reducer
failure means the log and the code disagree, and it throws rather than
degrading. Two actions in one turn is not a rules dispute at that layer — it
means something emitted an event it should never have emitted.

**`roll-recorded` changes no state.** It exists so the log can answer "why did
the goblin die": a roll that Bless lifted and Cutting Words then cut shows all
three contributions with their sources and signs, rather than one unexplained
total. Its consequences arrive as their own events.

Condition sets are sorted on the way in, so a replay compares byte for byte
regardless of the order effects were applied.

## Validate Before Rolling

Nothing may advance the generator or consume a roll id until the whole
operation is known to be valid. Rolling first and validating afterwards let a
malformed bonus return an error *after* it had moved authoritative state — so a
rejected operation still changed the world, and a replay would diverge from the
live session that produced it.

`validateBonusDice` parses every notation in play before the first die is
thrown. The other half of the rule matters too: a legitimately **resolved**
failure still costs its roll. Only *invalid* operations are free, and there are
tests for both directions.

Numeric entry points validate their inputs. A non-finite amount silently turned
hit points into `NaN`, which then compares false against every threshold — a
creature neither alive nor dead.

**Trust boundary.** These are internal calculation functions; they trust their
callers' arguments but not their arithmetic. A caller-supplied provenance label
is *not* proof a roll was issued — only `rolls.ts` stamps `engine`, and
`recordExternal*` refuses that source. When the Maestro-facing tool surface
lands (M2) it validates at its own boundary as well, because that boundary is
the one a model can reach.

## Determinism

Same seed plus the same event log must fold to a byte-identical `GameState`.
This is what makes a campaign replayable, auditable ("show me exactly why the
goblin died"), and testable at all.

`dice.ts` uses sfc32 seeded through xmur3. Its whole state is four integers, so
`snapshot()` / `restoreRng()` can persist a generator mid-combat and resume it.
Do not reach for `Math.random` — the lint rule will stop you, correctly.

## Testing

Test-first is the default for any new feature or bug fix.

1. Write the test. 2. Run it, watch it fail. 3. Minimum code to pass. 4. Refactor.

- Tests are colocated: `src/dice.ts` → `src/dice.test.ts`
- For a bug fix, the first test is the reproduction — it must fail for the
  reason being fixed
- **The scripted fight is the milestone's ship criterion.** `scenario.test.ts`
  plays a four-round combat between two parties through the public API — create
  a character from choices, roll Initiative, cast, attack, take damage, save
  against losing Concentration, drop a creature — and asserts the whole thing
  replays byte-identically from the same seed. Three assertions make that mean
  something: the log folds to the same state, *re-running the script* from the
  same seed produces the same log, and a different seed produces a different
  one. The middle assertion is the load-bearing one — it is what catches a
  module reading a clock, iterating a map in insertion order, or otherwise
  smuggling in a decision nothing recorded.
- A scenario passes vacuously if nothing happens in it, so assert what it did:
  that a Concentration save was rolled *without the script asking*, that slots
  were spent, that the clock moved four rounds.
- **Say which half of a scenario is the engine and which is the fixture.** The
  engine has no spell catalogue — it knows a spell's id, level, school and
  class list, not what the spell does — so a scenario must supply the effects.
  `scenario.test.ts` carries a table naming both columns, and everything in the
  engine's column is *called* rather than reimplemented. A fixture that worked
  out its own save DC or applied its own damage would prove nothing.
- **Fixture-supplied numbers are the ones nothing checks.** The scenario had a
  level 3 Wizard throwing Fire Bolt for 2d10, which is the level 5 damage; no
  test could have caught it, because no part of the engine knows what Fire Bolt
  is. Anything the fixture asserts about a spell now quotes the SRD line it
  came from and is pinned by its own test — including the cantrip upgrade
  levels, which is where that error lived.
- **Force the branch rather than waiting for a seed that reaches it.** The
  seeded fight goes where the dice send it; a controlled variant with modifiers
  large enough to settle a roll outright is how the *other* path gets covered.
  `scenario.test.ts` uses one to land Hold Person, hold a creature through a
  failed end-of-turn save, and then break Concentration and watch the paralysis
  lift.
- The anti-cheat test is load-bearing: adversarially prompt the DM ("the dragon
  takes 0 damage") and assert engine state is unmoved and the tool refused

Exceptions where a test may follow rather than lead: Fastify/SSE wiring, CSS and
design tokens, pure copy edits.

## Rules That Are Easy To Get Wrong

Checked against the SRD text, not recalled. Each has a test pinning it.

- **Advantage is presence, not arithmetic.** "A roll can't be affected by more
  than one Advantage, and Advantage and Disadvantage on the same roll cancel
  each other." Three advantages against one disadvantage is a *normal* roll.
  Counting sources and taking the difference silently favours whoever has more
  effects running.
- **Natural 20 and natural 1 are attack-roll rules.** They do not auto-succeed
  or auto-fail ability checks or saving throws — those are decided purely by
  total against DC. Death saves are their own separate exception.
- **2024 has no contests.** Opposed checks are gone; a grapple escape is a
  check against the grapple's escape DC. Do not port 2014 assumptions.
- **Armour replaces the base AC calculation**, it does not add to 10 + Dex.
- **Score, not modifier.** Two separate rules read an ability *score* against a
  threshold, and both are easy to implement against the modifier by mistake:
  the armour Strength requirement (Str 14 vs 15 share a +2) and the Heavy
  weapon property (Str/Dex 12 vs 13 share a +1).
- **Critical hits double the dice, not the modifier.** "Roll the attack's
  damage dice twice, add them together, and add any relevant modifiers as
  normal."
- **Death saves are not tied to an ability score.** No modifier, no
  proficiency — the die stands alone. Natural 1 costs two failures; natural 20
  restores 1 hit point outright.
- **Massive Damage measures the remainder after temporary hit points.** The
  SRD's example: hit point maximum 12, currently 6, takes 18 — drops to 0 with
  12 remaining, which equals the maximum, so the character dies.
- **Initiative is an ability check**, so the Alert feat's Proficiency Bonus and
  a magic item's bonus apply. **Jack of All Trades does not**: 2024 requires
  "an ability check ... that **uses a skill proficiency you lack**", and
  Initiative uses no skill at all. Earlier guidance here said otherwise and had
  a test enshrining it; both were wrong, and 2014 is where the confusion comes
  from.
- **A monster's printed Initiative is authoritative** and often differs from
  its Dexterity — an Adult Red Dragon prints +12 against a +0 modifier. It
  lives in `stated.initiative`, so no caller constructs a compensating bonus.
- **Death saves are unmodifiable by ability, not unmodifiable full stop.**
  Beacon of Hope grants advantage on them explicitly, so `rollDeathSave` takes
  the same modes and bonuses as any other D20 Test and simply starts from zero.
  The natural 1 and 20 results read the *die*; an ordinary success reads the
  *total*.
- **Surprise is Disadvantage on the Initiative roll**, not a condition. The
  Surprised condition is 2014.
- **A Reaction refreshes at the start of your next turn**, not at the end of
  the round — a creature that spent one on an Opportunity Attack has none until
  its own turn comes round.
- **Prone is asymmetric.** "An attack roll against you has Advantage if the
  attacker is within 5 feet of you. **Otherwise, that attack roll has
  Disadvantage.**" A prone target is *harder* to hit at range — the second half
  is the half that gets dropped.
- **Automatic criticals are Paralyzed and Unconscious only.** Petrified and
  Stunned grant Advantage but not crits, which is an easy over-generalisation
  from "helpless target".
- **Exhaustion is a flat -2 per level, not Disadvantage** — so it stacks with
  advantage instead of being cancelled by it.
- **Boots of Elvenkind grant flat Advantage on Dexterity (Stealth) checks** in
  2024 — no condition about sound or movement. That qualifier is 2014.
- **Great Weapon Fighting substitutes, it does not reroll.** 2024: "treat any
  1 or 2 on a damage die as a 3." The reroll version is 2014. No extra dice are
  rolled, and the generator is not advanced.
- **One spell slot per turn, whatever the casting time.** 2024: "On a turn,
  you can expend only one spell slot to cast a spell." This replaced the 2014
  rule about Bonus Action spells limiting you to cantrips, and the two are not
  the same restriction — porting the old one forbids legal turns and permits
  illegal ones. Note *a* turn, not *your* turn: a Reaction spell cast on
  someone else's turn is a different turn from the one you cast Fireball on.
- **Concentration breaks the moment you start casting the next one.** "You
  lose Concentration on an effect the moment you start casting a spell that
  requires Concentration." The old spell is gone even if the new casting goes
  on to accomplish nothing — every target saves, the spell is Counterspelled.
  Ending the old one only on success would hand back a spell the rules already
  took away.
- **The Concentration save reads damage taken, not hit points lost.**
  Temporary Hit Points absorb damage; they do not stop it being taken. A
  Warlock behind *Armor of Agathys* who soaks 30 still rolls against DC 15.
  And each instance of damage is its own save. Two hits of 10 are two DC 10
  saves — and so is a single hit of 20, because the floor of 10 swallows both.
  The difference shows higher up: two hits of 30 are two DC 15 saves, where one
  hit of 60 would be a single DC 30. Summing a round's damage and saving once
  is a harder save, not an equivalent one.
- **Temporary Hit Points do not survive a Long Rest.** "Temporary Hit Points
  last until they're depleted or you finish a Long Rest." They are not hit
  points, so healing to full does not touch them and the rest has to clear
  them itself — which is exactly the sort of thing that gets forgotten,
  because every other line of the rest is about giving things back.
- **An interrupted Long Rest pays out on the time rested *before* the
  interruption**, not on the time elapsed when somebody gets round to ending
  it. "If you rested at least 1 hour before the interruption..." Ten minutes
  of sleep and an hour of standing about is ten minutes of rest.
- **A Long Rest restores *all* spent Hit Point Dice.** 2014 gave back half,
  minimum one, and that is the version most tables still have in their heads.
  2024: "You regain all lost Hit Points and all spent Hit Point Dice."
- **An interrupted Short Rest is worth nothing; an interrupted Long Rest often
  is not.** "An interrupted Short Rest confers no benefits", but for a Long
  Rest, "If you rested at least 1 hour before the interruption, you gain the
  benefits of a Short Rest." Treating both interruptions the same way robs the
  party of a rest they earned.
- **Damage order of application is adjustments, then Resistance, then
  Vulnerability** — and the order changes the answer. The SRD's worked example
  (28 fire, -5 aura, resistant and vulnerable) gives 22; doubling before
  halving gives 23. Resistance and Vulnerability are booleans, not counts,
  because multiple instances of either count as one.

## Dice Are Individually Addressable

Many rules act on a single die rather than a total, so `DieRoll` records what a
die showed (`rolled`), what it counts as (`value`), where it came from
(`origin`), what became of it (`disposition`), and which effect touched it.
Nothing collapses to a bare number before the rules have had their say.

The SRD has three distinct shapes here, and they are modelled separately
because they compose differently:

| Shape | Rule | Built-in |
|---|---|---|
| Substitute a value | Great Weapon Fighting: 1 or 2 counts as 3 | `treatLowRollsAs` |
| Add a die on a trigger | Sorcerous Burst: an 8 adds a d8, capped at the spellcasting modifier | `explodeOnMax` |
| Reroll chosen dice | Empowered Spell: reroll up to Cha modifier dice | `rerollDice` |

Rerolls are applied afterwards and take explicit indices, because the rules
that use them let the *player* choose which dice — not a predicate the engine
matches. Rerolled dice stay in the record marked `rerolled`, so the log shows
what was given up.

Two behaviours worth not breaking: a bonus die can itself trigger another (the
cap is what terminates it), and triggers read `rolled`, never the substituted
`value` — otherwise substituting a 1 up to a maximum would fire an explosion
that never happened.

## Modifiers Are Named, On Every D20 Test

`Bonus` (in `bonuses.ts`, shared because `attack.ts` imports `checks.ts`)
carries a `source`, so a log can say *why* a number was what it was rather than
presenting an unexplained total. Flat bonuses fold into the d20's own modifier;
dice bonuses are rolled separately and added, which keeps the natural-20 and
natural-1 rules reading the die rather than a total Bless has inflated.

Advantage is attributed the same way, via `ModeSource`. Because advantage
cancels rather than stacks, `modeSources` records **every** source including
ones that cancelled — so a normal-looking roll can still explain itself
("Boots of Elvenkind vs Plate Armor").

**There is a real window after a roll lands and before its outcome settles**,
and three distinct effects fill it. All are Reactions, usually taken by someone
*other* than the roller, which is why every one carries a source.

| Effect | Shape | API |
|---|---|---|
| Bardic Inspiration | **Add** a rolled die, after a failure | `interveneAfterRoll` |
| Cutting Words | **Subtract** one, after a success — and it applies to **damage rolls** too | `interveneAfterRoll` / `reduceDamage` |
| Indomitable | **Reroll** the save entirely, "you must use the new roll" | `rerollTest` |

The first two are one mechanism with a sign, so they share a function — Bend
Luck pushes either way, which settles the argument for a `direction` parameter
over two functions.

`rerollTest` is **not** take-the-better-of-two: a reroll that comes up worse
stands, because that is what "you must use the new roll" means. The superseded
roll is kept on the result so the log still shows what was given up.

`reduceDamage` takes its amount off the **total**, never off a component: a
reduction is not damage of any type, and subtracting it from the slashing half
of a flaming sword would give a fire-immune target the wrong answer.

None of these check whether the test succeeded or failed. Bardic Inspiration
requires a failure and Cutting Words a success, but those conditions belong to
those features, not to the mechanism.

The engine never infers which bonuses apply. Whether Archery or Boots of
Elvenkind is in play is a question about feats and inventory, which the engine
does not model; the layer that knows passes them in, and the engine applies
them correctly.

## Damage Is Typed Components, Not A Number

An attack produces a list of `DamageComponent`s, each with its own type and a
named source. Flame Tongue deals "an extra 2d6 Fire damage" on top of a sword's
slashing, and Resistance applies *per type* — collapsing that to one number
gives a fire-immune target completely the wrong answer, and mixed-type damage
is common play, not an edge case.

`applyDamage` sums each type before applying defences, never per component:
halving 5 and 5 separately gives 4, but halving their sum gives 5. Rounding
down repeatedly silently undercounts.

Modifiers are `Bonus` values carrying a `source`, so the log can say why a
number was what it was rather than presenting an unexplained total:

| Kind | Example |
|---|---|
| Attack only | Archery (+2 to attack rolls with Ranged weapons) |
| Damage only | Bracers of Archery, Dueling |
| Both | a +1/+2/+3 magic weapon |
| Dice, not flat | Bless (+1d4 to the attack roll) |
| Different damage type | Flame Tongue (+2d6 Fire) |

On a critical hit **every damage die doubles — including extra damage dice**
("If the attack involves other damage dice, such as from the Rogue's Sneak
Attack feature, you also roll those dice twice") — but **flat bonuses never
do**. A +1 weapon adds 1 on a crit, not 2.

## Positioning: Coordinates, Authored But Never Defaulted

Positions are real coordinates, so distance is subtraction and area of effect
is an exact point-in-shape test.

**"Refuse, don't guess" does not apply here.** That rule governs things with a
right answer — dice, damage, save DCs — where a guess is simply wrong. Where
the ogre is standing has no right answer until someone decides. A DM asked how
far away it is says "about thirty feet" instantly; inventing a reasonable
position *is the job*, not a failure of rigour.

The competitor bug behind this design — a monster described as appearing in a
tavern, then reported 1000 feet away — was **not** caused by inventing a
position. It was caused by a position appearing that **nobody chose** and that
**contradicted the narration**. The failure is incoherence, not invention.

So the guards are about coherence, not permission:

- **No silent defaults.** `position` is `Point | null`; null is a normal state.
  There is no origin and no fallback coordinate. A position exists only because
  something deliberately placed it, and that act is recorded.
- **Placement is always relative to something established** ("beside the
  fighter", "20 feet from the bar"). The model never types raw coordinates, so
  a placement cannot drift away from what was just narrated.
- **Once placed, binding.** A creature does not relocate between turns without
  movement being spent; a contradiction is caught rather than absorbed.
- **Scenes declare their extent.** A 60x40 tavern cannot contain a 1000-foot
  gap.

**An unplaced creature is an engine-to-model signal, never player-facing.** The
engine tells Maestro the ogre has no position; Maestro places it and continues.
The player sees "the ogre lurches out from behind the bar" and never learns a
round trip happened. Nothing here should ever surface as "sorry, that creature
has no position".

**Areas of effect are exact.** All six SRD shapes are geometric tests, and two
details are easy to lose: a **Sphere and Cylinder include their point of
origin** while a **Cone, Cube, Line and Emanation do not** (unless the caster
says otherwise), and a **Cone's width at any distance equals that distance** —
so its radius there is half of it, not the full width.

**Sharing a space has three separate rules with three different exception
lists**, and conflating them is the easy mistake:

| Rule | Exceptions |
|---|---|
| May pass through | ally, Incapacitated, Tiny (either party), two sizes apart |
| Costs Difficult Terrain | *not* ally, *not* Tiny — an Incapacitated ogre is passable but still costly |
| Prone on ending there | Tiny, or larger than the occupant |

Ending a move in an occupied space is forbidden only when *willing*, so forced
movement passes `forced: true` and the result reports who is being shared with
and whether the mover is Prone. Applying the condition is the caller's job.

Passing *through* is exposed as a predicate rather than derived, because there
are no waypoints to trace — same reasoning as cover.

**Everything is on a lattice of 5-foot cubes, and distance is Chebyshev.**
SRD: "Each square represents 5 feet", and entering a *diagonally* adjacent
square costs the same one square as an orthogonal one. So a diagonal neighbour
is 5 feet away, not 7.07, every distance is an integer multiple of 5, and
nobody ever hears "seven and a half feet". The lattice is an internal
representation — nothing is rendered, and Maestro still speaks in feet from
landmarks.

**Placement uses the same metric as measurement.** Projecting a bearing
trigonometrically and then measuring the result with Chebyshev made the two
disagree: a creature asked for at 30 feet on a diagonal landed 20 feet away by
the engine's own ruler. `project` normalises the direction by its Chebyshev
norm, so the dominant axis carries the full distance and a diagonal at 30 feet
offsets (30, 30).

**Occupancy is tested by volume, not by anchor.** Comparing anchor cubes let a
Medium creature be placed *inside* a Large one simply by having a different
anchor, while ranges were already measured between volumes. Both now ask the
same question.

**Placing is not relocating.** `placeCreature` refuses a creature that already
has a position — that is what `moveCreature` is for, and movement is spent.
Otherwise a stray placement teleports something mid-combat.

**One metric, used everywhere — so a radius is a square.** That is not a
simplification, it is what Chebyshev means: every cube within 20 feet of a
point forms a 40-foot square. Measuring areas geometrically while measuring
distance by the grid would let a creature be 20 feet from a blast by one rule
and outside its 20-foot radius by another. Two metrics is how a system ends up
contradicting itself. Cone, Line and Cube are directional, have no Chebyshev
shorthand, and are the one approximation here: they resolve against cube
centres.

**An Emanation radiates from the creature, not from a point inside it.** SRD:
it "extends in straight lines from a creature or an object in all directions",
so it starts at the boundary — a 10-foot Emanation around a Gargantuan creature
covers vastly more ground than one around a Medium, and is not skewed toward
the corner cube the creature is anchored at. A Sphere is the opposite: centred
on a *point*, so a large caster standing at that point does not widen it.

**Creatures occupy volume, not a point.** A footprint from the SRD's Creature
Size and Space table, rising from the feet to a height. Treating them as points
made a tall creature mechanically flat — a blast at head height missed it
entirely — and put a Huge creature's only point seven feet inside its own body,
out of a fighter's reach. Creatures are anchored at a cube and extend from it — centring a Large creature
would put its edges on half cubes, which the game has no notion of.

**Nothing is ever measured centre to centre.** SRD: "count squares from a
square adjacent to one of them and stop counting in the space of the other
one." There is exactly one distance function and it counts cubes between
volumes.

**Height is declared, never inferred.** The SRD gives every creature a space
but never a height, and size category is a poor proxy — a giraffe and a
hippopotamus are both Large. Height is fiction, so Maestro says. The footprint
fallback exists so the geometry keeps working when nobody has said; it is not a
claim the engine knows how tall anything is, and `isHeightDeclared`
distinguishes the two so a tool surface can ask when it would change the answer.

Sphere, Emanation and Cylinder test the box exactly. Cone, Line and Cube are
directional with no closed form, so they sample the box's corners and centre —
documented as an approximation rather than dressed up as exact.

**Riding is a relationship, not an offset.** SRD Mounted Combat covers a
*willing* creature at least one size larger, within 5 feet, at half the rider's
Speed. It says nothing about leaping onto a hostile dragon, which is among the
most-attempted moves at any table — so that is permitted and recorded as
`willing: false` rather than refused. Whether the character got up there is a
check the DM calls for; the engine only tracks that they did.

The rider sits **one foot** above the mount, not at a size-derived height.
Realism would put a rogue 15 feet up a Huge dragon and thereby stop them
meleeing the dragon they are clinging to, which destroys the entire point. How
high it looks is narration. What the small offset buys: not sharing a space (so
nothing knocks them Prone), staying in reach of the mount, and travelling with
it when it moves or flies.

**Cover and line of sight stay declared, not ray-cast.** Computing them from
geometry means modelling walls, pillars and doorways as obstacles, and that is
where a rules engine becomes a VTT. The model says "behind the bar,
three-quarters cover"; the engine applies exactly +5 AC and +5 to Dexterity
saves. Exactness where it is cheap, judgement where geometry is expensive.

## Spell Slots Are Pools; A Casting Is A Thing With An Identity

Two ideas carry the whole spell system, and neither is about spells.

**A spell slot is not special.** `resources.ts` holds named pools — a key, a
maximum, a count spent, and what refills them — and slots are just pools named
`spell-slot:1` through `spell-slot:9`. Channel Divinity, Ki, a wand's charges
and a dragon's breath recharge are the same mechanism. Pools are **declared,
never derived**: the engine does not know that a level 3 Wizard has four level
1 slots, because that is a class table and class progression is not modelled.
Keeping the two apart is what lets the pool system land before the class system
does, rather than waiting on it.

**A casting has an identity.** "Hold Person" is not the thing that is running;
*this* casting of Hold Person, by this caster, at this level, is. Two Clerics
can hold the same goblin, and one of them losing Concentration must end exactly
one of the two paralyses. So every casting gets a sequential id — `cast:1`,
`cast:2`, never random, because replay has to reproduce them — and every effect
it creates carries that id inside its source: `Hold Person#cast:3`.

That encoding is deliberate on both sides. `castingIdOf` makes cleanup an exact
match rather than a search for a spell name, which would catch the other
Cleric's spell too. `spellOfSource` gives the narration layer the readable half
back. The engine never has to choose between being precise and being legible.

**Losing Concentration is derived, not commanded.** SRD: "Your Concentration
ends if you have the Incapacitated condition or you die." Nobody decides that,
so the reducer applies it after every event — which means it catches the break
however it arrived: damage to 0 hit points, a Stunning Strike, Exhaustion
reaching 6. No log, however assembled, can produce a state where a dead
wizard's Hold Person is still running. Ending it *by choice* or *by a failed
save* is a decision, so those are events with a reason attached.

The same split explains where the effects go. `concentration-ended` does not
enumerate the conditions it lifts; the reducer finds them by casting id. A
command that listed them would be building a batch against a snapshot, and a
retry a moment later would find that list stale.

**Damage settles its own Concentration save.** `resolveDamage` applies the
damage, works out whether a save is owed, rolls it when given a generator, and
ends the spell in the same batch when it fails. The pieces — `damageCreature`
and `concentrationSaveAfterDamage` — still exist, but composing them meant the
caller had to *remember* the second call, and a caller who forgot left a spell
running that the rules had ended. Remembering is not a thing to design around.

The save is skipped outright when the damage *already* ended the
Concentration — a caster dropped to 0 is Unconscious, therefore Incapacitated,
therefore no longer concentrating, so rolling would waste a die and imply the
spell might have survived. That case reports `already-lost` rather than `none`,
because "nothing to roll" and "it is already gone" are different answers.

**The generator is required, and that is a correction.** An earlier version
made it optional and returned the unrolled save as a `pending` obligation. It
was wrong three ways over, and the third is the one that matters:

1. Nothing in the log or the state held the obligation, so it did not survive a
   reload.
2. Nothing consumed it either, so "resolve exactly once" had no handle —
   `concentrationSaveAfterDamage` is a query and answers the same way however
   often it is asked.
3. **The damage event had already spent the command id.** Retrying the same
   command to make good on the save came back a duplicate no-op reporting
   `none`. The spell stayed up, the save was never made, and the engine said
   everything was fine.

An obligation the engine cannot keep is worse than one it never offered. Every
`ConcentrationConsequence` is now settled, and requiring the generator costs a
caller nothing: they resume it from the state they are already holding. A
caller who wants to look before rolling asks the query, which promises nothing.
If a genuinely deferred save is ever needed — holding the roll open so a player
can spend something first — it needs to be an event and a piece of state, not a
return value.

**The casting id is knowable before the cast.** `nextCastingId(state)` reads
the counter, so a caller can build the source string for the conditions a spell
imposes without digging the id back out of the emitted events. `castSpell` run
twice against the same state produces byte-identical batches — that is what
retry-safety means here — and appending one of them twice is caught as a
corrupt log, because the second copy's id is no longer the next one in
sequence.

### Casting spends the action it costs

`castSpell` validates the spell and expends the slot. It does not touch the
action economy, because it predates having one to touch — and that gap let a
caster throw two Fire Bolts in a turn, since neither expends a slot and the
one-slot-per-turn rule therefore never fired. SRD is plain: "Most spells
require the Magic action to cast", and two Magic actions on one turn is not a
turn.

`resolveCast` is the whole operation and the one a tool surface exposes: it
validates the spell, spends the action, Bonus Action or Reaction the casting
time names, expends the slot, and moves Concentration — or refuses and changes
nothing at all. The spell is validated first and the economy second, so a
refusal on either side leaves slots, Concentration and the budget as they were.
A retried command id is a no-op on both halves.

`castSpell` stays for callers reconstructing a log or scripting a fixture,
where the economy is already accounted for. Same split as `damageCreature`
beneath `resolveDamage`, and the same policy: the low-level half exists, and
Maestro's tool surface does not expose it.

Outside combat there is no economy to spend, so `resolveCast` simply casts.

### What the engine refuses, and what it declines to judge

A refusal costs nothing: no slot, no generator advance, no state change. That
is the existing "validate before rolling" discipline, and casting is the easiest
place to break it, because the natural order — spend the slot, then check —
reads fine and is wrong.

It refuses a slot smaller than the spell, a slot level with none left, a
cantrip that asks for a slot, a level 1+ spell that names neither a slot nor a
reason to skip one, a caster who is Incapacitated or dead, a caster in armour
they lack training in, and a spell name carrying the `#` that would forge a
casting link.

It **declines to judge** whether the caster knows or has prepared the spell, or
has the components. Spell lists, preparation and inventory are not modelled, and
refusing on a rule the engine cannot evaluate is worse than leaving it to the
layer that knows.

### Limitations, stated rather than papered over

- **Casting times of 1 minute or more are refused**, and the clock did not
  change that — see "Durations Are Two Different Things". The slot is expended
  on completion, and completion depends on the caster taking the Magic action
  every turn of the casting, which is a state machine rather than a deadline.
  Rituals cast the long way are covered by the same refusal.
- **Reaction *triggers* are not enforced, though the Reaction itself is now
  spent.** `resolveCast` takes the Reaction off the budget and refuses a second
  one before the caster's next turn, which is the half the engine can see. What
  it cannot see is the trigger: it does not check that a valid one occurred,
  and it has no interrupt mechanism, so it cannot order the casting against the
  event that triggered it. Counterspell reacting to a spell it must resolve
  *before* still needs machinery that does not exist. The engine will let a
  Reaction spell be cast at a moment the rules would not allow, and say nothing.
- **Only conditions are linked effects.** Ownership is designed for conditions,
  bonuses, areas and summons alike — the source string is the link, and nothing
  about it is condition-specific — but conditions are the only effect type the
  engine currently applies, so they are the only one implemented.
- **Non-Concentration ongoing spells now run and expire.** Give `castSpell` a
  `duration` and the casting ends on time, taking its effects with it, whether
  or not anyone was concentrating. What is still missing is dismissing one
  early — see the durations section.
- **The two-call path has an ordering requirement; `resolveDamage` does not.**
  `concentrationSaveAfterDamage` must be asked of the state *after* the damage
  landed, or it reports a save for a spell the damage already ended. That is a
  thing to know, which is why the one-call operation exists and is what a tool
  surface should reach for.
- **The log records the casting that ended, not each effect that ended with
  it.** Cleanup is derived from the link, so a target's own history shows the
  condition arriving but not leaving. Making it explicit would mean building a
  list that a retry could find stale; the trade was taken deliberately.

## Rests And The Clock

There is one clock, counting seconds up from the start of the campaign. No
calendar, no time of day — those are fiction and the DM owns them. What the
rules need is "how long since", and that is subtraction: the sixteen hours
between Long Rests, the hour that turns a broken Long Rest into a Short one.

Seconds because the game's units nest exactly — SRD, "A round represents about
6 seconds", ten rounds to the minute — so every duration the rules name is a
whole number of them and nothing lands between two rounds.

**In combat the clock is derived.** A round ends when the Initiative order
wraps, and six seconds have passed; nobody decides that. Out of combat, how
long the party spent searching the vault is narration, so it arrives as a
`time-advanced` event. Same split as everywhere else: rules are derived,
judgements are events.

**A rest is a span, not a button.** It begins, time passes, it ends. That is
what lets the engine tell a completed rest from an abandoned one, and apply the
rule that turns a Long Rest broken after an hour into a Short Rest rather than
into nothing.

**The engine notices its own interruptions.** The SRD lists four, and three of
them the engine can see: rolling Initiative, casting a spell other than a
cantrip, and taking any damage. Those mark the rest *as they happen*, so ending
it reads what occurred instead of asking the caller to report it — a caller who
had to report them would eventually miss one, and the party would collect a
rest the rules had already broken. The fourth, "1 hour of walking or other
physical exertion", is fiction the engine cannot see, so that one is passed in.
The first cause is the one that broke it; later ones change nothing.

**Hit Dice are a resource pool**, tagged `long-rest`, with the die size in the
key because nothing else knows it: a sheet has a level but no class, and the
class table saying a Wizard takes d6s is not modelled. Declared, never derived
— the same rule as every other pool, and the reason pools landed before classes
did.

Spending them validates every die before rolling any, so asking for more than
are left costs neither a die nor a turn of the generator.

### Limitations, again stated rather than papered over

- **A rest cannot be resumed.** SRD lets you pick a Long Rest back up for one
  extra hour per interruption. Durations did not deliver this: it needs a rest
  that survives its own interruption and accumulates required time, which is a
  change to how a rest ends rather than a deadline on an effect. Beginning a
  fresh rest works.
- **Sleep is not Unconscious.** SRD: "During a Long Rest, you sleep for at
  least 6 hours... During sleep, you have the Unconscious condition." Applying
  that needs the rest to be a state a creature *sits in* mechanically, not just
  a span the engine measures, and it would interact with the Concentration
  break in ways worth testing properly rather than bolting on.
- **Reduced ability scores and a reduced hit point maximum are not restored**,
  because neither is modelled in the first place.

## Durations Are Two Different Things

The SRD writes how long an effect lasts in two ways, and they are **not**
interchangeable:

| | |
|---|---|
| A span of time | "1 minute", "8 hours", "10 days", "Concentration, up to 1 hour" |
| A moment in the turn order | "until the start of your next turn", "until the end of your next turn" |

A round is six seconds, so folding the second into the first looks free. It is
not. Where "the start of your next turn" falls depends on where the anchor sits
in the Initiative order *and* on whose turn the effect began — anything from
the very next moment to a full round away. Outside combat it has no meaning at
all, because there are no turns.

So `duration.ts` has two types. `Duration` is what a caller asks for: relative,
and sometimes unanswerable. `Deadline` is what the log records: absolute, and
always answerable. `resolveDuration` is the single conversion between them and
it **can refuse** — a turn-anchored duration outside combat, or anchored to a
creature who is not in the fight, is an error rather than an approximation.
That refusal is the whole point of the split.

**Start and end of turn are a full round apart**, so combatants count turns
begun and turns ended separately. Nothing derives one from the other. The
asymmetry that catches people out lives in the constructors: said on the
anchor's *own* turn, "the end of your next turn" is two turn-endings away,
because the turn in progress has not ended yet, while "the start of your next
turn" is one turn-beginning away, because the turn in progress has already
begun. Callers say `startOfNextTurn(who)` and `endOfNextTurn(who)`; nobody
writes counts by hand.

**Turn-anchored timing is combat-scoped, and that is a policy, not a rule.**
When the fight ends, or the anchor leaves the Initiative order, the moment the
effect was waiting for will never arrive. The SRD does not say what happens
then — it does not contemplate the question, because at a table the DM simply
answers it. Three things the engine could do, and only one of them is safe:

| | |
|---|---|
| Leave it running | A permanently Restrained goblin, with no moment left that could ever free it |
| Convert it to elapsed time | Inventing a number the rules never gave — exactly what this engine exists not to do |
| End it with the fight | Chosen |

So it ends, and the consequences are worth stating rather than discovering:

- **It is gone, not paused.** A second fight does not resume it; nothing was
  kept to resume.
- **It ends early when combat ends early.** Dodge's benefit vanishes the
  instant the last enemy drops, which is usually what a table would say — but
  it is the engine saying it, not the rules.
- **An anchor who flees, dies or is removed takes their effects with them**,
  even where a DM might have ruled that the creature still has turns somewhere
  off-screen.
- **Nothing in the log says why.** Expiry is derived, so the effect is simply
  absent on the next fold — the same audit trade Concentration already makes.

A caller who wants an effect to outlive the fight says so in elapsed time,
which is combat-independent and means exactly what it says. The engine will not
translate between the two on anyone's behalf.

**Expiry is derived, like Concentration breaking.** A duration running out is
not a decision anybody makes, so the reducer ends expired effects after every
event, and no log — however assembled — can show an effect still running past
its own end. Timer keys are visited in sorted order, so a fold is byte-identical
however the effects were scheduled.

**A timer names what it ends**, and there are exactly two things it can be: one
condition instance on one creature, or a whole casting. The first expires that
instance and nothing else — two Clerics' Hold Persons on one goblin with
different durations end one at a time. The second ends the casting and
everything it created, which is the same cleanup a broken Concentration
performs, so "Concentration, up to 1 minute" is both at once: losing
Concentration ends it early, reaching the cap ends it regardless.

Timers are keyed by their target rather than numbered, so re-applying the same
effect from the same source *replaces* its deadline instead of leaving a stale
one behind to end it early.

### What expiry did not buy

Two things expiry is adjacent to and does **not** implement. Both were refused
before on the grounds that time was not modelled; time is modelled now, and
they are still not done, for different reasons:

- **Casting times of 1 minute or more are still refused.** The blocker was
  never the clock. SRD requires the caster to take the Magic action on *each*
  turn of the casting and maintain Concentration throughout, and the slot is
  expended only on completion — "If your Concentration is broken, the spell
  fails, but you don't expend a spell slot." That is a casting-in-progress
  state machine with a per-turn obligation, not a deadline. A timer can say
  when something stops; it cannot say whether the caster kept working at it.
- **A rest still cannot be resumed.** SRD lets you pick a Long Rest back up for
  one extra hour per interruption. That needs a rest that survives its own
  interruption and accumulates required time, which is a change to how a rest
  ends, not a deadline on an effect. Beginning a fresh rest works.

Two smaller gaps in the same area, stated so nobody assumes otherwise:

- **A non-Concentration ongoing spell cannot be dismissed early.** SRD: "you
  can dismiss it (no action required) if you don't have the Incapacitated
  condition." Such a spell now runs and expires correctly when given a
  duration; ending it ahead of time has no command, because `endConcentration`
  is about Concentration. Adding one is small and deliberately not in this
  milestone.
- **The log records the effect being scheduled, not expiring.** Expiry is
  derived, so a target's history shows the condition arriving and its deadline
  being set, but not the moment it lapsed — the same audit trade already made
  for Concentration, for the same reason.

## Progression, Creation And Execution Are Three Jobs

They arrive together in a rulebook and are kept apart here, because conflating
them is how a character sheet ends up claiming abilities nothing honours.

| | |
|---|---|
| **Progression** (`progression.ts`) | What a level grants. Pure data and lookups; knows nothing about any character |
| **Creation** (`creation.ts`) | Turning choices into a character, validated |
| **Execution** (everywhere else) | Actually doing what a feature does |

**Every feature says which of the last two owns it.** `automation: 'engine'`
means the engine applies the mechanical effect; `'manual'` means the feature is
recorded and a DM applies it, and a required `note` says exactly what is
missing. There is no third state where the engine half-does something, and an
unexplained "not automated" is not a useful thing to read at three in the
morning. A level 3 Evoker carries five manual features, and the sheet says so
rather than implying Potent Cantrip is being applied to damage rolls.

**The choices are the character.** `CharacterChoices` is stored on the creature
and everything else is derived from it, so the sheet can be rebuilt byte for
byte after a reload — and so gaining a level is a matter of adding to a record
rather than re-creating a creature. That second point is load-bearing:
re-creating would silently heal every wound, lift every condition and refund
every spent slot, which is the kind of bug nobody notices until a boss fight.
`advanceCharacter` emits only the differences: the hit points gained, the pools
that grew, the sheet the new level derives.

**Pools grow rather than being re-declared**, for the same reason.
`resource-pool-resized` changes a maximum and leaves what has been spent spent.

**Validation reports every problem, not the first.** `checkCharacter` returns a
list with a `field` on each, because a caller filling in a character does not
want to be told about one mistake at a time; `planCharacter` returns the first
as an ordinary `Result` error for a caller that just wants a character or a
refusal.

### Rules the validator actually enforces

Transcribed, not recalled, and each with a test: the standard array is exactly
15/14/13/12/10/8; point buy is 27 points with no score outside 8–15 before
origin increases; a background raises one ability by 2 and another by 1 *or*
all three by 1, never above 20, and only among the three it lists; a class
skill must be one the class offers and must not be chosen twice; Scholar's
Expertise requires proficiency in that skill first; a subclass is refused
before its level and required at it; a Wizard's spellbook holds six spells at
level 1 and two more per level after; prepared spells must be in the book and
must number what the table prints.

Hit points follow the SRD: the maximum die at level 1, then the fixed value or
a roll, plus the Constitution modifier, never less than 1 per level.

### The tables are transcribed by hand

`classes.md` has no parser, so the Wizard table and the Evoker are written out
in `wizard.ts` from the SRD text. Transcription is where typos hide, so the
tests assert *relationships* rather than presence — every printed Proficiency
Bonus is checked against `proficiencyBonusForLevel`, and slots are checked
never to decrease as levels rise. The same suite runs against any class
definition, so the second class to land fails loudly rather than quietly
disagreeing with the engine.

A `classes.md` parser is the eventual home for this, and would replace the
hand-written tables without touching the structures around them.

### One complete path, and what is missing around it

Supported end to end: a Human Sage Wizard from level 1 to 3, Evoker at 3.
Everything else is transcription rather than design, and the structures are
shaped for it.

- **One class, one subclass, one species, one background.** Adding more is
  data. Nothing in `progression.ts` or `creation.ts` is Wizard-shaped except
  two feature ids it looks up by name — Scholar's expertise and the Evoker's
  free spells — which is a seam to generalise when a second class arrives.
- **Feats are validated but not executed.** All four SRD Origin feats are
  modelled, and the choices they demand are checked: Magic Initiate's spell
  list, spellcasting ability, two cantrips and level 1 spell, all against the
  parsed SRD; Skilled's three proficiencies, which *are* applied to the sheet;
  and the rule that Magic Initiate taken twice must use different lists. What
  is not done is execution — Magic Initiate's cantrips do not join the
  character's cantrip list and its free daily casting is not tracked, Alert's
  Initiative proficiency is not applied, Savage Attacker's reroll is not. Each
  feat carries a note saying so.
- **Multiclassing is not modelled**, nor are Ability Score Improvements taken
  as score increases rather than feats.
- **Owning and wearing are separate; weight and attunement are not modelled.**
  `inventory` is everything the character has — class package, background
  package, and anything the GM added — and `equipped` is the subset actually
  worn or held. Armour Class reads `equipped`, so a chain shirt in the backpack
  protects nobody. What is still missing: weight, attunement, containers, and
  whether the quarterstaff in the package is the same object as the arcane
  focus. Adventuring gear is not parsed, so most entries are names rather than
  references; armour and weapons are.
- **Species traits above level 1 are not reached.** The structures handle a
  trait that arrives at character level 3 — `cumulativeFeatures` reads a species
  exactly as it reads a class — but the Human has none, so nothing exercises it.
- **Spell *execution* is still the caller's.** Creation now validates every
  spell choice against the parsed SRD, but knowing a Wizard has Fireball
  prepared does not make `resolveCast` aware of Fireball's effects; a spell's
  own mechanics are narrated and applied through the existing commands.
- **Arcane Recovery is a pool, not a behaviour.** The single use is declared and
  spends correctly; choosing which slots to recover, and the half-level cap, are
  the caller's.

### The SRD creation workflow, step by step

Audited against SRD 5.2.1 "Character Creation" for the one supported path.
Every required choice and grant is accounted for; anything the engine does not
execute says so.

| SRD step | Required choice or grant | Where | Test |
|---|---|---|---|
| 1. Choose Class | Class | `resolveParts` | refuses an unknown class |
| 2. Origin — background | Which background | `resolveParts` | refuses an unknown background |
| | Ability scores: +2/+1 or +1/+1/+1 among its three, never past 20 | `checkAbilities` | four cases, including the all-three shape |
| | Origin feat (Sage → Magic Initiate (Wizard)) | `grantsFeat` + `checkFeats` | refuses a feat the background did not grant |
| | Two skill proficiencies | `gatherProficiencies` | gathered from every source |
| | One tool proficiency | `gatherProficiencies` | `toolProficiencies` |
| | Equipment: package A or B | `inventoryOf` | both packages, and mixing them |
| 2. Origin — species | Which species | `resolveParts` | refuses an unknown species |
| | Species traits, and their choices (Human: a skill, an Origin feat) | `grantedFeatures`, `checkFeats` | Skillful applies; Versatile demands a feat |
| 2. Origin — languages | Common plus two from the Standard Languages table | `checkLanguages` | count, duplicate, off-table |
| 3. Ability Scores | Standard array, point buy, or manual | `checkAbilities` | array and 27-point budget |
| 4. Alignment | One of the nine | `checkCharacter` | refuses one that is not |
| 5. Details — features | Class features recorded, with their choices made | `grantedFeatures`, `checkFeatureChoices` | every feature granted; missing choice names the feature |
| 5. Details — numbers | Saves, skills, Passive Perception, hit points, AC, Initiative | `planCharacter` → `CharacterSheet` | save DC, skill modifiers, AC, hit points |
| 5. Details — hit points | Max die at level 1, fixed or rolled after, minimum 1 per level | `hitPointsFor` | fixed, rolled, and a Constitution penalty |
| Spellcasting | Cantrips known, spellbook, prepared — all against the parsed SRD | `checkSpells` | id, class list, level, duplicate, preparation, acquisition level |
| Subclass (level 3) | Which subclass, and its own choices | `resolveParts`, `checkEvocationSavant` | refused early, required at 3; school and level cap |
| Level Advancement | New spells per level, kept apart from copied ones | `advanceCharacter` | advances preserving copied spells and current state |
| Starting at Higher Levels | Minimum XP for the level | `planCharacter` | 900 XP at level 3, 0 at level 1 |
| | GM's extra equipment, money and magic items | `checkDmGrants` | refused when unstated above level 1 |

**Missing choices are errors with a field attached, never silent defaults.**
`checkCharacter` returns every problem at once with the `field` it belongs to,
so a caller can point at what needs fixing; `planCharacter` returns the first
as an ordinary `Result` error.

### Two places the SRD does not answer, and what the engine does instead

**Overlapping proficiencies.** SRD 5.2.1 gives no rule letting a player re-pick
a proficiency they already have — the 2014 guidance to that effect is not
reproduced anywhere in it. So the engine does not invent one. Proficiency is
binary, as the glossary says, so overlapping grants **union**; the redundant
pick comes back in `plan.warnings` as `redundant_proficiency`, and the table
decides whether to swap it. Not an error, because the rules do not make it one.

**What a higher-level character starts with.** SRD: "The GM decides whether
your character starts with more than the standard equipment for a level 1
character, possibly even one or more magic items." That is a decision the
engine cannot make, so above level 1 it must be *stated* — `dmGrants` with a
note, even if the note says "nothing beyond the standard package". An absent
grant is refused rather than defaulted, because a silent zero would be the
engine answering a question the SRD asked the GM.

### Spells are validated against the parsed SRD

Choices are **stable spell ids** (`magic-missile`), not names, checked against a
generated index of all 339 SRD spells. Every selection is checked for
existence, class-list membership, level, and duplication; the spellbook also
checks that the acquisition level is one the character has reached, and
preparation checks membership in the book and that the spell is of a level the
character has slots for.

The Evoker's two free spells are checked **separately**, on the feature's own
terms — Evocation school, level 2 or lower, not already in the book — so a bad
pick says which of the feature's rules it broke rather than a generic
spellbook complaint.

### Level-granted spells and spells found in play

SRD gives a Wizard six spells at level 1 and two per level after, and
*separately* lets them copy any Wizard spell they find. So a spellbook entry
records where it came from: `level`, `copied`, or `feature`. **The count rule
measures only the `level` subset.** An earlier version enforced an exact total,
which meant levelling up would reject a Wizard for the crime of having looted a
spell scroll. Copied spells ride along and are preserved across advancement.

They are still checked: a copied spell must be a real Wizard spell of a level
the character can prepare, which is what the SRD requires to copy it at all.

## Monsters State Their Numbers; Characters Derive Them

A character's Armour Class follows from their armour and Dexterity. A monster's
is printed. The same goes for saves, skills and the proficiency bonus — an
Adult Red Dragon has a +0 Dexterity modifier and a **+6** Dexterity save, which
no combination of proficiency and ability produces.

So `CharacterSheet` carries an optional `stated` block that wins over
derivation, and `adaptMonster` fills it from the stat block rather than
reverse-engineering proficiencies that happen to add up. Characters are
untouched: with no `stated`, every derivation behaves exactly as before.

**A stat block prints damage types and conditions in one run.** A Zombie's
immunities read "Poison, Exhaustion, Poisoned" — one damage type and two
conditions, which the engine treats completely differently. `adaptMonster`
splits them, and anything it recognises as neither is kept as a caveat rather
than silently dropped.

**A qualified defence is not an unconditional one.** "Charmed (except from its
vampire master)" applied as flat immunity makes the vampire unable to charm the
one creature the entry exists to let it charm. The engine cannot evaluate a
qualification, so it does not pretend to: qualified entries stay *out* of the
automatic tables and `conditionApplicability` returns one of three answers —
`allowed`, `immune`, or `needs-adjudication` with the qualification attached.

Three outcomes rather than a boolean, because they mean different things
upstream: proceed, refuse, or ask. Collapsing the third into either of the
others is exactly how a conditional immunity becomes an absolute one.

## Conditions Remember Why

A condition is not a name on a list, it is a set of **reasons**. A creature
held by Hold Person and separately knocked unconscious has two independent
causes of Incapacitated; lifting the unconsciousness must not lift the hold. A
flat list of names could not tell them apart, and did not.

So `ConditionState` holds `ConditionInstance`s — `{ id, condition, source,
impliedBy }` — with deterministic ids (`condition:source`) so they survive a
replay. Applying a condition adds what it implies, tagged with the instance
that carried it, and `removeConditionInstance` drops exactly that cause and its
children. Prone is the documented exception that outlives its cause: "when this
condition ends, you remain Prone."

`conditions` stays on the state as a derived, sorted list of distinct names, so
every existing reader is unchanged.

## Transitions Are Engine-Owned Batches

Some changes are not one event. Dropping to 0 hit points makes a character
Unconscious; healing from 0 lifts *that* unconsciousness and nothing else;
Exhaustion 6 kills. Leaving those follow-ups to the caller meant relying on a
language model to remember bookkeeping the rules already mandate — and damage
alone left characters at 0 hit points and wide awake.

`commands.ts` produces these as coherent batches: validation lives there, the
reducer stays pure replay. That split is deliberate — commands answer "may
this happen and what else follows", the reducer answers "what does the record
mean".

Healing lifts only the `ZERO_HIT_POINTS` cause, which is the whole reason
sources exist: a character put to Sleep *and* dropped to 0 wakes from the hit
points and stays asleep.

Death that is not hit-point loss gets its own event. Damage is the wrong
instrument — a healthy creature taking exactly its maximum in damage drops to
0, it does not die.

### Retry-safety has two halves, and only one is free

A pure command gives identical events from identical state. That is worth
having and it is **not** the guarantee a retrying caller needs, because a
caller retrying after its first batch was already applied is looking at
*updated* state: the slot is gone, the casting happened, the generator has
moved on. Casting again there is a genuine second casting, and the engine is
right to treat it as one.

So commands take an optional `commandId`, the event that results carries it,
and the fold remembers it. A retry with an id that has already landed returns
an empty batch. Three details make it actually work:

- **The check comes before validation.** Otherwise a retry reports the damage
  the first attempt did — "no level 2 slots left" — rather than reporting that
  the casting already happened, and the caller cannot tell a duplicate from a
  genuine refusal.
- **The outcome stays recoverable.** `commandOutcome` gives back the casting id
  the command produced, so a retry that gets no events can still link that
  spell's effects.
- **It is opt-in and generic.** Without an id nothing changes; any future event
  that carries a `commandId` gets the guarantee without a second mechanism.

The same id means the same command, and the engine holds callers to it: the
inputs are fingerprinted alongside the id, and reusing an id for different work
is **refused**, not swallowed. A silent no-op there is the worst available
outcome — the second command never runs and nobody is told. The fingerprint
sorts object keys at every level, so field order is the caller's business
rather than part of the command's identity, and it carries the operation's kind
so a damage id and a casting id cannot collide by having similar shapes.

**Every mutating tool on the Maestro surface takes a command id.** That is not
optional the way it is for the engine's own callers. A model-driven loop
retries for reasons that have nothing to do with the game — a `pause_turn`
resume, a dropped connection, a tool re-invocation after a stream error — and
an unidentified retry is a second casting that spends a second slot and rolls a
second save. The id is what makes "did that go through?" answerable rather than
a guess. The engine keeps it optional because a test fixture or a scripted
scenario has no such problem; the tool surface has no such excuse.

## Conditions Close The Loop

`conditions.ts` is the first module that feeds *back* into the rolls rather
than adding a layer beneath them. Checks, saves and attacks all take condition
state and read the rules themselves — the caller supplies who has what, never
the resulting advantage.

Four things it does that a mode list alone cannot express:

- **Implication.** Unconscious carries Incapacitated *and* Prone; Paralyzed,
  Petrified and Stunned each carry Incapacitated. `expandConditions` closes
  over these to a fixed point and sorts the result, because condition state
  reaches the event log and an order-dependent set would break replay
  comparison.
- **Automatic failure.** A Blinded creature fails a sight-dependent check and a
  Stunned creature fails a Strength save regardless of the die. The roll is
  still recorded — other effects can care what it showed — but `autoFailed`
  overrides the total, and no after-the-fact bonus rescues it.
- **Automatic criticals.** A hit on a Paralyzed or Unconscious target within 5
  feet is a critical even without a natural 20.
- **Context-dependence.** Frightened only applies while the source is in line of
  sight; Grappled only against targets other than the grappler; Invisible only
  against creatures that cannot see you. These take context rather than being
  unconditional.

Purely narrative effects — "you can't speak", "you're unaware of your
surroundings", Petrified's tenfold weight — are deliberately not modelled.
They belong to narration, not arithmetic.

## Combat Model

Zones, not a grid. A scene is a `Zone { id, name, adjacent[], cover, terrain }`
graph; ranges resolve as bands — same zone is melee, adjacent is ~30ft, two hops
is 60ft+. This keeps the decisions that matter (closing to melee, AoE catching
several targets, ranged-into-melee disadvantage, cover) without line-of-sight
maths or token rendering.

Rendering a battlemap later is a presentation change, not an engine change.
Resist scope creep toward a VTT — the zone model is deliberately the boundary.

## Claude Integration (M2+)

Verified against the bundled `claude-api` skill — these are current API shapes,
not recalled ones. Re-check the skill before changing any of it.

- Model `claude-opus-5`, `thinking: {type: "adaptive"}`, streamed via
  `client.beta.messages.toolRunner({ ..., stream: true })`
- Check `stop_reason === "pause_turn"` each iteration and `pushMessages` to
  resume — **the runner does not auto-resume**, it silently returns a truncated
  turn
- Enable refusal fallbacks (`betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`) and check `stop_reason === "refusal"` before reading
  content. Dark-fantasy narration is exactly the traffic that trips a classifier,
  and a DM that hard-fails mid-combat is a broken product
- **Caching is architecture, not tuning.** The system prefix (persona + DM
  directives) is frozen and carries an explicit `cache_control` breakpoint;
  tools are serialised in stable sorted order. Per-turn game state goes in as a
  `{role: "system"}` message appended to `messages[]` — never by editing
  top-level `system`, which would reprocess the whole campaign uncached every
  turn. An integration test asserts `cache_read_input_tokens > 0` on turn 2+,
  because that failure is silent and expensive
- Never interpolate date, session id, or player name into the system prompt

## Parsing the SRD

`packages/srd/raw/` is a third-party transcription, and it is uneven. Two rules
follow from that, both learned the hard way:

- **Never hand-edit `raw/`.** Corrections go in `parse/overrides.ts`, sourced
  from the official PDF, so re-vendoring upstream cannot reintroduce a defect.
- **Assert counts, not just "no problems".** A parser that silently skips
  everything reports zero problems. `animals.md` yielded 0 creatures for exactly
  this reason — it shifts its heading hierarchy up a level, which is why the
  parser now detects the entry level instead of assuming it.

Defects found so far, all covered by regression tests:

| Defect | Where |
|---|---|
| 12 spells use singular `**Component:**` | normalised in `parse/spells.ts` |
| 498 modifier cells use U+2212, not a hyphen (`parseInt` → `NaN`) | `parseSignedNumber` |
| 3 stat blocks have collapsed table cells (`+10 +10`, `CON 29`) | `parse/overrides.ts` |
| Succubus puts Initiative on its own line | searched block-wide |
| `animals.md` shifts heading levels | `detectEntryLevel` |
| Equipment rows drop `</tr>`; one `<tr>` is doubled | cells grouped in sixes, not by row |
| Weapon properties contain commas inside parentheses | `splitTopLevel` |
| Legendary CR lines carry a lair value (`XP 5,900, or 7,200 in lair`) | `CR_LINE`, no defaults |

**A default is how a format change becomes a wrong number.** An optional
capture group defaulting the proficiency bonus to +2 gave 32 legendary
creatures — every dragon with a lair — the proficiency of a goblin, silently,
for weeks. Parse strictly and report a problem; never fall back to a plausible
value.

Where a field is derivable from another, **assert the relationship** rather
than only the presence: every monster's proficiency bonus must match what its
challenge rating implies. That test is what catches the next variant.

For table-driven content, assert the **per-section** counts, not just the
total. A missed section heading leaves the total correct while silently filing
every row under the wrong category.

The parser stays strict on a mangled ability table rather than guessing. A
silently wrong modifier is the worst failure this codebase has — it looks like
a rules bug forever after.

## Known Pending Work

- M0: adventuring gear and tools (93 entries in `equipment.md`), plus classes,
  feats and magic items, are vendored but not yet parsed. Weapons and armour
  are done because `attack.ts` needs them; the rest can wait for a consumer.
- **M1 is done.** Its ship criterion — "a scripted 4-round combat between two
  parties resolves identically from the same seed" — is discharged by
  `scenario.test.ts`. Spell slots, Concentration, casting, rests, the clock,
  effect durations and one complete character path have landed; the
  limitations recorded above are the honest edges of that work, each with the
  reason it is still open.
- M1 leftovers, none of them blocking: the remaining classes, species and
  backgrounds (transcription onto the structures the Wizard path proved),
  feat *execution*, and multiclassing.
- M2–M5: tools, DM loop, CLI harness, persistence, web app, persona
