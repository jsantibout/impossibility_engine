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
- Golden-scenario fixtures assert exact event sequences for worked SRD examples
  (grapple escape against an escape DC, Fireball across zones, concentration
  broken by damage, death saves to stabilisation)
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
- **Initiative is a Dexterity check**, so everything that touches ability
  checks touches it — the Alert feat's Proficiency Bonus, the Bard's Jack of
  All Trades half-bonus, a magic item. It takes the same `Bonus[]` machinery as
  any other check rather than a narrow signature.
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
than silently dropped. Parenthesised restrictions ("Charmed (except from its
vampire master)") register the immunity *and* keep the qualification, because
no boolean captures it and the DM still needs it.

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
- M1: engine beyond `dice.ts` — character, checks, attack, conditions, zones,
  combat, spells, rest, progression, events, reducer
- M2–M5: tools, DM loop, CLI harness, persistence, web app, persona
