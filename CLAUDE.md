# InfiniteRealms — CLAUDE.md

## Project Identity

An AI Dungeon Master for D&D 2024, built on SRD 5.2.1. TypeScript monorepo:
pure rules engine → tool surface → Claude orchestration → Fastify + React.

Target user: a player who wants a real D&D campaign — solo or with friends —
run by a DM with actual personality and rules you can trust.

**`docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` is the constitutional document and outranks this file.** It
states what must remain true of the Engine whatever it is asked to do next;
this file records how the code actually works and why. Where they disagree,
the doctrine wins and this file is the thing that needs correcting. Its core
principle is the one line worth carrying everywhere: **AI interprets
possibility; the Engine adjudicates reality.**

## Architectural North Star

The Impossibility Engine must provide authoritative, deterministic mechanical
truth **without restricting legitimate player creativity or DM judgment**.

A "safer" architecture that makes creative D&D substantially harder is not a
successful architecture.

The Engine owns established mechanical truth. The DM owns world authorship and
adjudication. For novel actions, the DM may invent a ruling and compose
existing mechanical primitives; the Engine resolves the mechanically knowable
pieces.

Before introducing a refusal, a hard constraint, a bespoke command requirement,
or an additional model round trip, ask whether it protects established
mechanical truth or merely compensates for an inflexible interface.

See `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` for the governing doctrine.

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
npm install
npm test                  # Vitest, all packages
npm run test:watch
npm run test:coverage
npm run typecheck         # tsc -b (build) + tsconfig.tests.json (tests)
npm run lint              # ESLint 10 flat config
```

Postgres is not required until M3.

**npm workspaces**, declared in the root `package.json`; a sibling package is
depended on as `"*"`, which npm resolves to the workspace before the registry.

npm gates install scripts, so `allowScripts` records the one decision taken:
**esbuild's postinstall is denied**. It ships its platform binary as an
optional dependency package, so the script is redundant here — vitest resolves
and runs esbuild without it, and the whole suite passes. Left unrecorded, npm
warns on every install and in CI.

## Two people work on this repo

**`CONTRIBUTING.md` is the full picture — ownership, the daily loop, and a
per-file conflict playbook. This is the part that must not be broken by an agent
that has not read it.**

Work is split by file, not by feature, because files are what git resolves.
**A owns content** — spell definitions, the registry, `VERIFIED_SPELLS`, the
spell tests. **B owns mechanism** — `commands.ts`, `events.ts`, the timing and
positioning modules, and the *type declarations* at the top of
`spell-definitions.ts`. Stay in your lane; if a change genuinely needs the other
lane, say so rather than reaching across.

Four rules that a session will otherwise break, all of them learned here:

- **Never regenerate `packages/engine/fixtures/golden-log.json`.** It is frozen
  on purpose. Regenerating it to make `persistence.test.ts` pass converts a
  compatibility test into a rubber stamp, which is worse than deleting it.
- **Always run `npm run coverage`** after touching a spell definition, and
  commit the result. CI fails on a stale `COVERAGE.md`.
- **Check the registry before adding a spell.** Two parallel sessions once both
  wrote Vitriolic Sphere; only a duplicate-symbol error caught it. Grep first.
- **Rebase on `main` before pushing**, and keep pull requests to one logical
  change.

Four tracked files are `merge=binary` in `.gitattributes` and will never
auto-merge: `COVERAGE.md`, `package-lock.json`, `packages/srd/src/*-index.ts`
and `golden-log.json`. That is deliberate — each is regenerated rather than
merged, and a text merge of them succeeds while producing something nobody
computed. `CONTRIBUTING.md` says what to run for each.

## Development workflow: an architect, builders and a reviewer

Development runs as one Fable session — the **architect**: principal engineer
and final technical judgment — delegating approved, bounded tasks to one to
three Opus **builders**, each in its own git worktree and each checked by an
independent Opus **reviewer**, with the owner deciding what is built and what
is merged. `docs/dev/WORKFLOW.md` is the procedure; this is the part a
session must not get wrong.

- **Fable is event-driven.** It thinks, delegates, and ends its turn; it is
  woken by a builder's completion notification, an escalation, an owner
  decision or the periodic audit. It does not poll, monitor, narrate progress
  or do speculative architecture while builders run. Fable's tokens are the
  scarce resource; Opus does the volume, including review and rework.
- **Start with `/qb`.** It injects the live queue, the validator's summary and
  the git state, so a fresh session resumes from the repository alone.
- **Sources of truth, highest first:** the doctrine; this file; `PROGRESS.md`;
  the task file and `docs/dev/QUEUE.md`; `COVERAGE.md`. A task's state lives
  on the `state:` line of its own file under `docs/dev/tasks/`, and
  `node docs/dev/check-queue.mjs` refuses any state outside the closed set.
- **Three owner gates, none optional:** work approval
  (`OWNER_APPROVAL_REQUIRED`), a material decision
  (`OWNER_DECISION_REQUIRED`) and merge approval (`AWAITING_MERGE_APPROVAL`).
  Fable recommends; only the owner's words in the conversation move a task
  across one, and they are quoted in the task file. Fable never approves its
  own proposal and never merges unasked.
- **The architectural gate is lightweight by default.** Fable reads the
  completion digest — builder result, reviewer verdict, tests, conformance,
  deviations, primitives touched, special cases — and inspects the diff only
  when a risk signal in it says so. GREEN stays between builder and reviewer;
  YELLOW wakes Fable as `ARCHITECTURE_BLOCKED`; RED goes to the owner.
- **Fable does not write engine code; builders and reviewers do not merge.**
  `qb-builder` and `qb-reviewer` are Opus, the builder `isolation: worktree`,
  both behind a hook that refuses `git push`, `git merge` and ref surgery, and
  Claude Code's own isolation that refuses edits and git aimed at the main
  checkout. Rework goes builder ↔ reviewer without Fable.
- **One owner per primitive.** Two tasks that both change `events.ts`,
  `commands.ts`, the types at the top of `spell-definitions.ts` or any other
  foundational primitive run one after the other, never concurrently.
  Content, conformance, tooling and docs run beside a mechanism task.
- **Builders never edit `PROGRESS.md` or `docs/dev/`.** Fable is the only
  writer there; the Done row is recorded at merge, as it always was.
- **`WHOLE_ENGINE_AUDIT_DUE`** after every 3–5 engine tasks; `QUEUE.md`
  counts, and the audit is recorded where the previous ones were.

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

- **A Goblin Warrior is Fey, not Humanoid.** SRD 5.2.1: "Small Fey
  (Goblinoid)". Goblinoid is a subtype tag; the *type* changed in 2024, and it
  means Hold Person — "Choose a Humanoid" — cannot touch one. The scripted
  scenario cast it at goblins for three commits before the engine carried a
  creature type and could say so. Every 2014 instinct about who is a Humanoid
  is worth re-reading.
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
- **A flat addend printed beside the dice is part of the damage.** Finger of
  Death is "7d8 + 30" and Disintegrate is "10d6 + 40". `DiceScaling` carried
  the number from the start and nothing on the damage path read it — the one
  caller of `scaledFlatFor` was Temporary Hit Points — so Finger of Death dealt
  7d8 for as long as it had existed, silently. A **minimum** is what catches
  this: 7d8 + 30 cannot come to less than 37, and it was dealing 32. The
  addend does not double on a critical, for the same reason no flat bonus does.
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

**An Armour Class is something an effect can push on.** `BonusApplies` covers
attacks, saves and ability checks — all rolls — and now `ac`, which is not a
roll but a number rolls are measured *against*. It is in the same union rather
than a mechanism of its own because the SRD writes it in the same sentence
shape: Shield of Faith's "+2 bonus to AC" beside Bless's "+1d4 to the attack
roll". Only the flat half reaches an Armour Class; a standing number has no
moment at which a die could be thrown for it, and no SRD spell asks for one.

`armorClassOf(state, id)` is the reader. `armorClass(sheet)` still answers for
a creature nobody has cast anything on, and is what it falls back to. Cover
stays outside both: it is a fact about one attacker's line to one target, not
about the target, so the attack that reads it adds it.

The engine never infers which bonuses apply. Whether Archery or Boots of
Elvenkind is in play is a question about feats and inventory, which the engine
does not model; the layer that knows passes them in, and the engine applies
them correctly.

## Advantage Is A Property Of A Roll, Not Of A Creature

`combineRollModes` has settled a list of modes correctly since the day it was
written, and `ModeSource` has attributed each one. What sat between them was
nothing: a mode reached a roll through a hard-coded reader that knew **one
question** — `standingSaveModes` could answer about a save, `standingSkillModes`
about a skill check, `standingInitiativeModes` about Initiative, and
`attackedWithDisadvantage` about a weapon attack. Four readers, four grant
kinds, and no way for a fifth question to be asked at all. So the twenty-odd
SRD spells that grant a standing Advantage or Disadvantage had nowhere to be
written down, and Blur — "any creature has Disadvantage on attack rolls
**against you**" — could not be said in the vocabulary even in principle.

`roll-modifiers.ts` is one question asked once:

> **Does this source modify THIS roll?**

Four fields answer it, all closed unions naming rules the engine already
resolves. There is no expression, no callback and no string to interpret; a
definition that cannot be said in this vocabulary is a shape that has not been
built, which is the honest answer and what the coverage tables are for.

| | |
|---|---|
| `roll` | `attack`, `ability-check`, `saving-throw`, `initiative`, `death-save` |
| `relation` | `roller`, or `against-holder` |
| `ability` | narrows a check or a save; absent means the whole family |
| `skill` | narrows a check; absent means the whole family |

**`relation` is the bit that was missing, and it is one bit wide.** These are
different rules about the same creature, and before this the second could only
be expressed as a grant kind of its own:

| | |
|---|---|
| `roller` | "The affected creature has Disadvantage on attack rolls." |
| `against-holder` | "Attack rolls against the affected creature have Advantage." |

**`against-holder` is legal only on an attack**, and that is a rule rather than
a simplification: an attack roll is the one D20 Test the engine records a
second participant for. A saving throw knows its DC and not who set it — the
gap this file has recorded since Countercharm — so an `against-holder` selector
on a save would match every save ever rolled. The validator refuses it.

**Two roll families exist because the SRD insists on them.** `initiative` is
not `ability-check`, because Feral Instinct grants Advantage on "Initiative
rolls" and does not help a Barbarian pick a lock. `death-save` is not
`saving-throw`, because a death save is "not tied to an ability score" and an
ability-keyed grant would either miss every one or catch every save in the
game. Beacon of Hope names both in one sentence and means two different things.

**There is deliberately no member for "D20 Tests".** Three SRD spells write the
phrase — Foresight, Resurrection, Ray of Enfeeblement — and every one is
blocked on something else: a casting time of a minute, a penalty linked to no
casting, a repeat save that ends a spell hanging no condition. A vocabulary
member no definition can use is a guess, and the phrase does not even mean "all
five of these": a death save is a D20 Test, and Initiative is one already
counted as a check.

### One vocabulary, two lifetimes

A class feature's grant and a spell's grant are the same mechanic and differ
only in how long they live, so they share the selector and the predicate:

| | Stored where | Ends how |
|---|---|---|
| A feature, or an action anybody can take | nowhere — derived from the world on every read | when its own requirement stops holding |
| A spell's grant | `CreatureState.rollModifiers`, by `roll-modifier-granted` | `releaseCasting` / `releaseOnTarget`, through the casting in its `source` |

`StandingGrant` lost four members and gained one, which is what made Dodge
expressible as a mode rather than as a mechanism. `rollModesFor` is the one
gatherer: it reads the roller's standing effects, the *target's* standing
effects, and both creatures' durable grants, deduplicates by source, and hands
the list to `combineRollModes` — which is still the only thing in the engine
that decides an outcome. No subsystem rolls its own cancellation.

**Both ends of an attack are asked, which removed a fork nothing was comparing.**
`resolveAttack` read the defender's standing effects and the spell attack
inside `resolveEffects` read nothing about the defender at all, so a **Dodging
creature was easier to hit with a Fire Bolt than with a club** — silently,
because each path was correct on its own terms. SRD Dodge says "any attack roll
made against you"; it does not say "with a weapon".

**A durable grant's identity is the source *and the rolls it reaches*.**
`bonus-applied` and `armor-class-granted` both key on the source alone, which
is right for them and wrong here: Beacon of Hope grants "Advantage on Wisdom
saving throws **and Death Saving Throws**" — one casting, one source string,
two modifiers. Keyed by source, the second silently replaced the first and the
spell lost half its own sentence between the definition and the state.
`rollModifierKey` is that identity; re-granting the *same* rolls from the same
casting still replaces rather than stacks, which is what those two events were
protecting.

**A mode is not a bonus, and folding them together would have made Blur a
negative number.** A bonus is arithmetic that adds and stacks; a mode is
presence that cancels, so three Advantages against one Disadvantage is a
*normal* roll and no arithmetic says that. And `BonusApplies` has no relation
axis at all.

### What this deliberately does not reach

Each is a named missing piece with the spells that want it, rather than a
vague edge:

| Missing | Spells |
|---|---|
| An ability **chosen at the casting** | Hex, Enhance Ability, Bestow Curse |
| A filter on the *attacker's* creature type | Protection from Evil and Good, Dispel Evil and Good, Magic Circle |
| A sight clause read from the **attacker's** side | Faerie Fire |
| The effect's *source* as a participant — "against **you**", meaning the caster | Bestow Curse |
| A grant conditioned on proximity, or carried by an aura | Holy Aura, Conjure Animals |
| A save keyed to a named **condition** rather than an ability | Protection from Poison |
| "D20 Tests", and "Strength-based D20 Tests" | Foresight, Resurrection, Ray of Enfeeblement |

**A one-shot mode is a different mechanic, not a short-lived one.** Guiding
Bolt's "the **next** attack roll against it", Vicious Mockery's "the next
attack roll it makes" and Ray of Enfeeblement's success branch all need a
modifier that is **consumed** by the roll it changes. Nothing here consumes
anything — a durable grant applies until its casting ends — so those stay in
`unmodelled` where they were.

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
simplification, it is what Chebyshev means. Measuring areas geometrically while
measuring distance by the grid would let a creature be 20 feet from a blast by
one rule and outside its 20-foot radius by another. Two metrics is how a system
ends up contradicting itself. Cone, Line and Cube are directional, have no
Chebyshev shorthand, and are the one approximation here: they resolve against
cube centres.

**How wide that square is depends on where the origin sits, and the engine will
not choose for you.** An earlier version of this line claimed a 20-foot radius
formed a 40-foot square; it forms a *45*-foot one, nine cubes across, because
the origin was always read as a cube. That is not a bug — it is one of two
right answers, and the code was silently picking one while this file described
the other.

A coordinate cannot say which it is: the lattice corner and the cube's minimum
corner are the same three numbers. So the *thing holding* the coordinate says,
and `AreaPoint` is that one bit:

| | Resolves to | A 20-foot radius | A 5-foot-wide Line |
|---|---|---|---|
| `{ space: p }` | the cube's centre | 9 cubes, 45 feet | 1 cube wide |
| `{ intersection: p }` | the edge four cubes share | **8 cubes, 40 feet** | 2 cubes wide |

The rule that falls out is general and names no spell: **an even-cube footprint
wants an intersection, an odd-cube footprint wants a cube.** SRD 5.2.1 mandates
neither — its "Playing on a Grid" sidebar covers squares, Speed, entering a
square, corners and ranges and says nothing whatever about areas of effect, and
the intersection convention comes from a 2014 optional rule. So `space` is the
default because that is what every casting already meant, `CastSpellRequest`
carries `anchoring` for a caster who wants the other, and `OngoingSpell` keeps
it so a Web catches the same creatures an hour later that it caught at the cast.
Absent means `space`, which is why every log written before this folds
unchanged.

**An intersection is horizontal, deliberately.** It is the vertical edge four
cubes share, taken at the mid-height of the cube the coordinate names. The
convention it transcribes is about squares on a map, and nothing gives a
vertical stack an intersection. Reading the `z` as a floor *plane* instead
would drop every origin half a cube below every creature standing on that
floor — which for a 5-foot-wide Line is the whole of its half-width. A
three-dimensional corner is a third member if a rule ever asks for one; none
does.

**Both ends of a directional template are read in one frame.** `inShape` used
to take an origin its one caller had already centred and a `towards` it centred
itself — correct, and correct only because there was exactly one caller. The
moment a second origin convention existed that became a 2.5-foot-per-axis tilt,
which at five feet is 26 degrees. Both endpoints are now resolved by the same
function before any predicate sees them, and `placeArea` reads a single
anchoring for the whole shape, so the axis is always the difference of two
coordinates written the same way.

**The radial shapes measure to cube centres, and that changed no answer.** For
an origin on a cube, "Chebyshev from that cube's centre to the nearest centre
of the target's volume" and the old box-to-box Chebyshev are the same number:
touching spans give 0 by both, adjacent spans 5, a gap of `g` gives `g + 5`. A
box is a product of intervals and Chebyshev is a max, so the per-axis minima
compose. The whole suite passes unchanged, which is the evidence.

A Cylinder is the exception that proves the origin is not simply a point: SRD
puts its origin "at the center of the circular top or bottom" — horizontally
central, vertically on a **face**. So its height is measured from the lattice
plane the origin sits on, never from a cube's mid-height, which would leave a
40-foot Cylinder straddling cube boundaries and covering seven of them.

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
- **Three Reaction triggers are enforced; the fourth needs machinery that does
  not exist.** SRD writes a Reaction's casting time as a clause — "Reaction,
  **which you take when you are hit by an attack roll**" — and the clause is a
  rule. `SpellDefinition.trigger` carries it, and a casting whose moment has
  not arrived is refused before a slot or a Reaction is spent.

  **Shield works, including the hard half.** "A +5 bonus to AC, including
  against the triggering attack" means the attack must still be undecided when
  the Reaction lands, and it is: `pendingAttack` — the window built so a Divine
  Smite could land between an attack's two rolls — holds the hit, the roll that
  made it, and the Armour Class it was measured against. So the hit is
  re-measured, and whether +5 is enough is arithmetic the engine owns rather
  than a judgement the model makes.

  Two details in that re-measuring, both from the book. The bonus is applied to
  **the number the attack actually met**, which already has that attacker's
  cover in it — recomputing an Armour Class from the creature would quietly
  drop the cover and let the barrier cancel the pillar. And a **natural 20 hits
  regardless**, so no bonus turns one aside.

  **Hellish Rebuke works, and what it needed was a fact rather than a
  mechanism.** Its trigger is "taking damage from a creature that you can
  see", and its target is "the creature that damaged you" — but every damage
  event carried only a `source`, which is *prose* for the audit trail
  (`'a trap'`, `'Longsword'`). Prose cannot be set on fire. So damage now names
  its dealer where one is known, `CreatureState.lastDamage` remembers the most
  recent, and a trap still names nobody — which is the honest answer, not a
  gap: there is nothing to rebuke.

  **The window is two facts already in state, not a number.** "In response to"
  means immediately, and the finest grain the engine has for that is the turn —
  the same grain the one-slot-per-turn rule uses. Outside combat there are no
  turns, so the clock closes it instead: a Reaction is legal while both the
  turn and `elapsed` still match the moment the damage landed. Inventing a
  window of so many seconds is exactly the kind of number this engine exists
  not to invent.

  **The target is forced, so aiming it elsewhere is refused** rather than
  quietly redirected — the rule `eligibleTargets` states for every spell, and
  the one place a Reaction could have smuggled in a substitution.

  **Counterspell works, and what it needed was for a casting to stop being
  atomic.** See "A Casting Can Be Interrupted" below. One Reaction trigger is
  left:

  | Spell | What it answers | What is missing |
  |---|---|---|
  | Feather Fall | a creature falling | falling, which is not modelled at all |

  A `ReactionTrigger` member arrives with the machinery that makes it
  checkable, never before.
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

## A Casting Can Be Interrupted

`resolveSpell` was atomic: it validated, spent the slot, and landed the
effects in one breath. SRD 2024 Counterspell interrupts "a creature **in the
process of casting a spell**", and there was no such process to interrupt.

**The SRD decides which costs are already paid, and it is not "all of them".**
One sentence settles the whole design:

> "On a failed save, the spell dissipates with no effect, and **the action,
> Bonus Action, or Reaction used to cast it is wasted**. If that spell was cast
> with a spell slot, **the slot isn't expended**."

So the economy is spent at declaration and never given back, and the slot is
**not spent at declaration at all**. That asymmetry is the reason this is a
two-event casting rather than a spend-and-compensate one: there is no refund,
because nothing was taken. Every event still records something that happened.

| | Declaration (`spell-declared`) | Settlement (`spell-cast`) |
|---|---|---|
| Action / Bonus Action / Reaction | **spent** — "wasted" whatever follows | — |
| Concentration the caster was holding | **broken** — "the moment you *start* casting" | — |
| The spell slot | — | **spent** |
| A feat's free daily casting | **spent** | — |
| The new Concentration | — | **started** |
| The casting's own deadline | resolved, so it cannot fail later | scheduled |
| The effects | — | **resolved** |

Two of those rows are readings rather than transcriptions, and are stated here
because nothing else records them. **A feat's free daily casting is spent and
not spared**: the SRD's relief names the spell slot and nothing else, and
extending it to a different resource would be inventing a rule. And **the
one-slot-per-turn rule reads expenditure**, so a countered casting does not use
up the turn's one slot — the marker rides on the settling `spell-cast`.

**It is opt-in, and that is the compatibility story.** `resolveSpell` with no
`hold` is byte-for-byte what it always was: one call, one `spell-cast`, no
pending state — which is why every log written before this exists still folds,
`golden-log.json` included. Turning every casting into a two-step ceremony to
serve a moment that is usually empty would be a worse API for no rules gain.

**The reducer branches on the id, not on "is anything pending".** A
Counterspell is itself cast *while* a casting is open, so its own `spell-cast`
has to allocate the next id in sequence rather than trying to settle somebody
else's casting. Matching `pendingCasting.castingId` against the event's is what
keeps those two cases apart; asking "is a casting open" conflates them and
corrupts the log.

**The casting id is allocated at declaration**, because the entire point is
that other mechanics can name the casting while it is open — `cast:3` is what
`spell-interrupted` refers to, and what a log reader asking why Hold Person
never landed needs to see. So `spell-declared` advances `castingsBegun` and the
settling `spell-cast` must not advance it again.

**Settlement takes no fresh request.** Who the spell was aimed at, what level it
was cast at and which route supplied it were settled and written down at
declaration; `resolveDeclaredCast` reads them off the pending record. A
settlement that accepted a new request could declare Fireball at the goblins
and settle it at the party, and no rule in the engine would have noticed.

**The deadline is pinned at declaration, not re-resolved at settlement.**
`resolveDuration` can refuse — a turn-anchored duration outside combat — and a
refusal *at settlement* would be a window that could never be closed, which is
a wedged fight. Refusing before the window opens costs nothing, which is the
same validate-before-rolling rule the rest of casting obeys.

**A pending casting is engine debt, and it is guarded the way the others are.**
The turn refuses to advance past it; a second casting is refused while it
stands, except the Reaction that answers it; and a caster who leaves the game
takes it with them, exactly as `settleHoldsInvolving` already does for a held
attack and a declared move. A debt whose only settling command is addressed to
a creature who has left is a campaign that never continues.

**A guard placed before the duplicate check is a lie told to a retry.** The
`casting_pending` refusal was written above the command-id check first, and a
retried declaration then reported that somebody was mid-cast — which was true,
and was the retry's own first run. This is the third time that trap has been
sprung in this file (`triggerRefusal` and the six unstamped commands were the
others), and it is always the same shape: *a retry looks at the world its first
run made*. The duplicate check comes first, always.

**A clause that excludes nothing is documented, not modelled — and this now
has two users.** Nondetection hides its target from Divination spells, and
every Divination spell the engine defines is cast at Self or at no creature at
all, so the clause has no reachable case. Same shape as Counterspell's:

**Counterspell's components clause is not checked, and the reason is in a
test.** SRD triggers it on "casting a spell with Verbal, Somatic, or Material
components" — and all 339 SRD 5.2.1 spells have at least one of the three, so
the qualifier excludes nothing the engine can be asked about. A field whose
only reachable value is "yes" is not a rule, so the gap is reported in
`unverified` and `counterspell.test.ts` pins the count that makes it safe.

**Two things this deliberately is not.** It is not a general interruption
framework — one pending casting, no stack, and a Counterspell answering a
Counterspell is refused rather than nested. And it is not the long-casting-time
machinery: a casting of a minute or more needs a per-turn obligation the caster
must keep, which is a state machine, not a window.

## A Casting Is History; What It Left Behind Is State

The engine has given every casting an identity since the first spell landed,
and used it to link the conditions and bonuses that casting created. What it
never had was the other half — **which castings are still running, on whom, and
at what level** — and three SRD sentences are unwritable without it:

| Sentence | What it needs live |
|---|---|
| Dispel Magic: "any ongoing spell of level 3 or lower **on the target**" | which spells are on a creature, and their level |
| Vampiric Touch: "you can make the attack again on each of your turns" | the casting, its caster, and the level it was cast at |
| Mage Hand: "the hand vanishes ... **if you cast this spell again**" | the caster's own prior casting of that spell |

`OngoingSpell` in `spells.ts` is that half, held in `state.ongoing` by casting
id. **The log keeps the casting for ever** — which slot went, which action, at
what moment — and this keeps only what a later rule has to ask. Ending the
second never touches the first, which is what the distinction is for: a test
asserts the record is gone and the `spell-cast` event is still there.

**The level is why it exists.** Before it, a spell's level lived in the log and
on a *concentrating* caster, so a spell whose caster was not concentrating had
no live level anywhere and Dispel Magic had nothing to read.

### No second identity, and the evidence for that

One casting can affect several creatures — Hold Person at level 3 holds two —
and each is released independently. But each is addressed as *(casting,
creature)*, which the engine has done since the repeat save. The only SRD
spells that make several independently addressable *things* from one casting
are the ones that give those things **positions** — and a position turned out
not to need an identity either: see "A Casting Can Hold A Point", where the
force is a field on the casting and is addressed as the casting. The one spell
that genuinely makes *several* placed things is Dancing Lights, which is
blocked on light being modelled at all, so a second level of identity would
still be a structure invented ahead of any mechanic that needed it.

### Range decides what a spell is *on*; the target list does not

Vampiric Touch is **Range: Self** and punches somebody else every turn. It is
on the wizard. Getting this backwards would let a fighter end it by standing
still and being hit. Everything else is on whom it was cast — **minus whoever
it failed to catch**, because a creature that saved against Banishment is not
banished and a record claiming otherwise reports a hit where there was none.

That is why the record is written at the **end** of the resolution rather than
beside the slot: what a casting is on is not knowable until the casting has
resolved. A tracked spell resolves nothing and keeps all its targets, which is
how Darkvision stays dispellable.

### Lifecycle, and the one place it ends

`releaseCasting` is the **single** place the record is removed, so Concentration
breaking, a deadline arriving and an explicit dispel all converge on one answer
to "is this spell still running". There is no second route by which a finished
spell stays queryable, and no zombie.

| | |
|---|---|
| Created | `spell-ongoing`, once the effects have resolved |
| Concentration lost | the existing derived pass; no event, as before |
| Deadline reached | the existing timer; no event, as before |
| Dispelled or recast | `spell-ended`, with a reason |
| Target shakes it off | leaves `on`; the casting runs for everyone else |
| Target leaves the game | leaves `on`; the spell is **not** ended, because the SRD does not end a Bless when one of the blessed walks out |

**Expiry and a broken Concentration still write nothing.** Nobody decides
either, so they stay derived — the same audit trade this file already records
for every other derived ending.

**Three paths resolve a casting, and one record has to come out of all of
them.** The ordinary cast, the settlement of a declared one, and the release
of a readied one all end in `resolveEffects`, and the third wrote no
`spell-ongoing`: a readied Bless was running, concentrated on, adding its d4,
and invisible to Dispel Magic. A fork no single-path fixture can see, so
`ongoing-spells.test.ts` now drives the Ready path to the same record.

**A casting's debts include the damage it scheduled.** `scheduledDamage`
carries the casting id in its source exactly as a condition does, and
`releaseCasting` dropped conditions, bonuses and timers while leaving a later
hit standing. No ongoing spell schedules one yet — both delayed-damage spells
are Instantaneous — which is precisely when a convergence point is cheapest to
complete and easiest to forget.

### `spell-ended` carries the whole of Dispel Magic's target distinction

`on: null` ends the casting and everything it made; `on: <creature>` releases it
on that creature. Both operations have existed since Hold Person's repeat save;
this is the event that names which. SRD lets Dispel Magic target "one creature,
object, or **magical effect**", and that is the same distinction: a spell on
this creature and nobody else has nothing left to be, so it ends, while one that
caught three loses only this one.

### Dispel Magic is 2024, and 2024 removed a roll

"Any ongoing spell of level 3 or lower on the target ends" — **no check at
all** below the threshold. The 2014 habit of rolling for everything is a
different spell. Above it, "DC 10 plus that spell's level", a bare ability check
on the caster's spellcasting ability. And the printed "level 3" is not a third
number: it is the same sentence as *Using a Higher-Level Spell Slot* read at
the spell's own level, so the engine has one rule — **automatic at or below the
level this casting was made at.**

The definition therefore carries **no numbers at all**. Every one of them is a
fact the engine holds, and a definition restating any would be a second place
to get the spell wrong.

### Acting through a spell on a later turn

`activateSpell` is the narrow shape two SRD spells write identically —
Vampiric Touch and Flame Blade — and it is not scripting. What is pinned and
what is read afresh is the whole design:

| Pinned at the casting | Read again now |
|---|---|
| the level, so the dice do not grow when the caster does | who it is aimed at |
| the route, so the numbers are the ones it was cast with | the range to them |
| the caster — nobody else may act through it | their Armour Class, conditions, defences |

**Flame Blade is the one that proves the shape is a shape**: its casting does
nothing whatever, so its own effect list is empty and every blow it strikes
comes through the activation. A spell whose activation the engine resolves is
therefore **executed, not tracked**, and `coverage.ts` counts it that way.

### The family that works and the family that does not

The twenty-odd spells that act on a later turn split cleanly, and the split is
not about the rule — it is about whether the spell made a **thing with its own
position**:

| | Spells | Status |
|---|---|---|
| A permission the caster exercises | Vampiric Touch, Flame Blade, Expeditious Retreat, Gust of Wind, Telekinesis, Detect Thoughts | the shape built here |
| A permission exercised **from a point** | Spiritual Weapon | see "A Casting Can Hold A Point" below |
| A thing with statistics | Unseen Servant, Arcane Hand, Project Image | the **summons** seam |
| A point whose effect needs a trigger the engine lacks | Flaming Sphere, Call Lightning's cloud, Dancing Lights, Arcane Eye, Mage Hand's hand, Silent Image, Mislead | named, spell by spell, below |

The second row was the doctrine's own "non-creature persistent world objects"
seam and is now open. The third and fourth are not, and the split between them
is the thing that batch settled: **what the SRD prints decides it, not what the
spell looks like.**

## A Casting Can Hold A Point

`OngoingSpell` gained one optional field, `origin: Point`, and that is the
whole of the spatial primitive. No entity, no object record, no second
identity, nothing in the scene's `positions` table.

**Spiritual Weapon is the adversarial case, and it argues against itself.** It
is the spell most obviously "a thing" — a floating spectral weapon that moves
about the battlefield and hits people — so if anything in the SRD justified a
world object, it would. Read against the two spells in the same book that
*are* objects, it prints none of what they print:

| | Spiritual Weapon | Unseen Servant / Arcane Hand |
|---|---|---|
| Armour Class, Hit Points | none | "AC 10, 1 Hit Point"; "AC 20 and Hit Points equal to your Hit Point maximum" |
| Can be attacked | nothing addresses it | dropping to 0 Hit Points ends the spell |
| Occupies its space | nothing says so | Arcane Hand says explicitly that it does **not**, which is a rule only an occupant needs |
| Acts | the caster spends a Bonus Action | commanded, with a Strength score of its own |
| Moved by anyone else | no | no |

So: **a point is a point until a mechanic proves it needs to be more.** Giving
the force a creature record would have been inventing an Armour Class the book
declines to print, and every spell that hits it would then have been the
engine answering a question the SRD asked nobody.

**Three numbers, three homes, and they are not interchangeable.**

| SRD | Field | Measured from |
|---|---|---|
| "appears within range in a space of your choice" | `range` | the caster |
| "one creature within 5 feet of the force" | `origin.reach` | the point |
| "move the force up to 20 feet" | `origin.movableBy` | the point, **now** |

The third is why the allowance lives on the definition rather than a boolean
beside it: a fixed origin — Web's Cube, Call Lightning's cloud — is the same
storage with no `movableBy`, so **a fixed origin and a movable one share
state without sharing commands.** Do not give a spell a movement allowance
because it has a point.

### Actor and spatial origin are two different things

This is the seam the spell forced, and it is one optional argument wide.
`resolveEffects` takes a `from?: Point`; the roller, the attack modifier, the
dice and the level are all still the caster's, and only the *spatial* questions
move — the reach, and the Prone rule that reads "within 5 feet of you".

The two alternatives were both lies in state: moving the caster to the force
(a teleport nothing narrated) or making the force a creature (an Armour Class
nobody printed). Audited across the engine, nothing else needs the distinction
yet — a weapon attack, a spell attack and an Opportunity Attack all originate
at their attacker — so it is an argument rather than a concept.

### Moving the point is not creature movement

The two change coordinates and share nothing else. None of Speed, Difficult
Terrain, Opportunity Attacks, occupancy, Prone-for-sharing, Grappled or
Disengage applies, because the SRD applies none of them to the force. Routing
the relocation through `moveCreature` to reuse the geometry would have imported
every one of them silently, which is why `relocateOrigin` is its own eight-line
function that reuses the *ruler* and nothing else.

What the engine does own is exactly what the SRD prints: the allowance in feet
measured from where the point is **now**, the scene's extent, and the identity
of the casting being moved. The caller chooses the destination.

**The move is part of the activation, not a command of its own.** Every SRD
spell in this family spends one action to move and act — "move the force up to
20 feet **and** repeat the attack", "you can control the hand thus again. As
part of that action, you can move the hand up to 30 feet" — so a separate
command would charge a second Bonus Action or charge none, and both are wrong.
`ActivateSpellCommand.to` is optional because "up to 20 feet" includes none of
them.

### A casting that holds a point is on nobody

`OngoingSpell.on` answers Dispel Magic's "any ongoing spell **on the target**",
and the force is not on the goblin it hit. A Dispel Magic aimed at that goblin
must not put the Cleric's weapon out, so the presence of an origin *is* the
rule: the spell is on its point, and `on` is the empty list the record already
supports for a spell that caught nobody.

### What the SRD scene test had to be

Two guards looked tested and were not, and the reason is worth keeping: in a
600-foot hall, **every space past the wall is also past sixty feet**, so the
range check answers first and a missing scene check hides behind it
permanently. The discriminating fixture is a room barely wider than the spell
reaches. Same lesson as the multiclass fixture and the Rogue who resisted
nothing: a guard needs a case where it is the *only* thing that can refuse.

### The point goes with the casting, through one door

`releaseCasting` already removed the conditions, bonuses, timers and scheduled
damage a casting created, and the record with them — so the origin needed no
new cleanup at all. Concentration broken, the minute running out, a dispel, the
caster leaving: all four converge there, and a test asserts the serialised
state no longer mentions the casting id at all.

**A new scene leaves the point where it was**, and that is a debt with a name
rather than an accident. `scene-set` unplaces every creature and nothing can
re-place a force — the only command that moves one moves it twenty feet.
Dropping the point instead would be worse: a Spiritual Weapon with no point is
a spell whose every reach check silently stops happening. So the coordinate
stands, the reach comes back in `unverified`, and the real fix is the
doctrine's multiple-scenes seam.

### Which spells this reaches, and which it does not

Thirty-nine SRD spells keep a place. **One is executable by this primitive
today**, and the honest reason the rest are not is never "it needs a position":

| Blocked on | Spells |
|---|---|
| A creature that **ends** its turn in an area | Moonbeam, Cloudkill, Incendiary Cloud, Insect Plague (and Grease and Black Tentacles, whose casts already execute) |
| A creature that **starts** its turn in an area — a different boundary, a round apart | Stinking Cloud, Web, Sleet Storm, Zone of Truth |
| A creature that **enters** an area, on its own move or a forced one | Web, Grease, Insect Plague, Moonbeam, Cloudkill, Incendiary Cloud, Black Tentacles, Sleet Storm, Zone of Truth |
| An area that **moves into** a creature's space — printed only by areas that move | Moonbeam and Spirit Guardians (**built**); Cloudkill and Incendiary Cloud, blocked on automatic turn-start drift |
| Ending a turn within 5 feet of a point, and a point rolled into a creature's space | Flaming Sphere |
| Distance travelled inside an area, which no move records | Spike Growth |
| A wall with a length and a barrier rule, and no later trigger at all | Wind Wall |
| An activation that resolves an area at a point chosen now | Call Lightning, Storm of Vengeance |
| A stat block created mid-fight | Unseen Servant, Arcane Hand, the four Conjures, Guardian of Faith, Faithful Hound, Phantom Steed, Summon Dragon, Giant Insect |
| Walls and barriers as obstacles | Arcane Eye, Passwall, Wall of Stone, Prismatic Wall |
| A standing effect derived from where a creature is standing | Spirit Guardians' halved Speed, every Paladin aura |
| Light, which is not modelled | Dancing Lights, Daylight, Darkness |
| A second location | Project Image, Secret Chest |

**One origin per casting, and Dancing Lights is the reason that is a decision.**
It is the only SRD spell that makes several independently placed things from
one casting — four lights, each within 20 feet of another — and it is blocked
on light being modelled at all, so plural storage would be a shape built ahead
of any mechanic that could use it. Adding an index later is additive to the
event and to the record; choosing plurality now would not be.

**Call Lightning was audited as the candidate second user and rejected.** Its
cloud is a fixed origin, which is exactly the evidence wanted — but its
activation aims at a *point* and resolves an area there, which no activation
does, and its "point you can see" and outdoor-storm damage bonus are facts the
engine does not hold. It is a new shape, not a transcription.

### Two bugs this found in code that was already there

- **`releaseOnTarget` computed the surviving bonuses and never applied them.**
  From the day it was written. Nothing noticed because every spell that
  released on one target hung a *condition* — Hold Person, Black Tentacles —
  and Dispel Magic is the first thing to release a spell that hung a **bonus**.
  A Bless the rules had ended went on adding its d4.
- **`spell-cast` never declared the `route` it was emitting.** Excess-property
  checking on a union accepts a property **any** member declares, and
  `PendingCasting` declares one — so the field reached the log and no reader
  could see it. This is the second instance of that trap in this file; the
  first was a `command` stamp on an event that did not declare it.

## A Reaction Is A Window, Not A Trigger

Eight class features spent eleven batches saying *"needs an interrupt the
engine does not have"* while the three pieces of arithmetic they wanted —
`reduceDamage`, `interveneAfterRoll`, `rerollTest` — sat written, correct and
reachable from no command at all. That is the tenth instance in this file of a
pure function nothing calls, and the largest.

What was missing was not arithmetic and not a trigger language. **It was two
instants**: a damage roll that has been made and not applied, and a D20 Test
whose total is known and whose effects have not occurred.

**The vocabulary is five named windows and it is shared with spells.**
`ReactionWindow` in `reactions.ts` is the whole of it, and it is a table rather
than a framework because every member is a point in a resolution the engine
already performs:

| Window | Pinned before it opens | Still unresolved | Who names it |
|---|---|---|---|
| `hit-by-attack` | the attack roll hit; the Armour Class it beat | the damage roll | *Shield*; seven monsters' Parry |
| `damage-rolled` | the damage, by type | what the target takes | Uncanny Dodge, Deflect Attacks, Cutting Words |
| `damaged-by-creature` | **everything** | nothing | *Hellish Rebuke*, Retaliation |
| `test-rolled` | the total, and whether it beat the DC | the effects of that outcome | Indomitable, Dark One's Own Luck, Peerless Skill, Cutting Words |
| `casting-a-spell` | the casting, the action, the Concentration dropped | the slot, the effects | *Counterspell* |

**`damaged-by-creature` is in both columns**, and that overlap is the evidence
the vocabulary is shared rather than merely tidy: *Hellish Rebuke* and
Retaliation answer the same instant under the same rule, and `damageWindowOpen`
is the one function that decides whether it is still open. Two clients, one
reading.

Class features therefore did **not** reuse the spell machinery — a spell
Reaction is a *casting*, with a definition, a route, a slot and an action, and
a feature has none of those. Both sit on the window instead.

### The window opens only when somebody can answer it

A window that opened on every damage roll would make every swing of every
sword a two-command negotiation, and `scenario.test.ts` and the frozen
`golden-log.json` would both have had to change. With no eligible reactor the
damage is dealt in the same breath it was rolled, the same events come out, and
no caller learns a window exists.

That is not an optimisation. It is the rule `pendingMove` has followed since
Opportunity Attacks landed — **a move that provokes nobody simply happens** —
and `pendingMove.provoked` was already the offer list this batch generalised
from. Three instances of "a finite list of creatures, answered one at a time,
with the thing they hold up happening when the last one answers" is evidence;
one would have been a guess.

### An offer is a (reactor, feature) pair, not a reactor

One creature can hold two features in one window. A Rogue 5 / Monk 3 is
offered Uncanny Dodge *and* Deflect Attacks against the same blow, and a
Fighter / Fiend Warlock may reroll a failed save with Indomitable and then add
Dark One's Own Luck to the new roll — the SRD forbids neither. The reducer
first matched an answer by **reactor**, so the first answer consumed both
offers, and a settlement that recorded one pass per offer then found the
second already gone and threw. A legal build crashed `settleDamage` and wrote
a `test-settled` batch the fold refused for ever.

So an answer names its feature and settles exactly that offer; a bare pass
(no feature) lets every offer the reactor holds lapse, which is what declining
the window means. Every single-class fixture has one feature per window, which
is how the mismatch survived a whole suite — **the multiclass is the fixture
that discriminates**, the same lesson as class level against character level.

### The window and the action-economy cost are two facts

Four of the eight features here spend a Reaction and four spend none at all.
Indomitable, Dark One's Own Luck and Peerless Skill are bare permissions
limited by a pool; the SRD asks for no Reaction and never mentions one. This is
the commonest mistake about this corner of the rules, and folding the two
together would have made half the batch wrong. `costsReaction` is a per-feature
field for that reason.

### Settlement is its own command, and that is the opposite of `pendingMove`

`takeDamageReaction` answers an offer; it does not deal the damage.
`settleDamage` does, always, and records every offer still outstanding as
passed. Four things follow, and they are why the choice went the other way from
the move:

- **One place computes the number.** The damage is arithmetic the reactions
  changed, so exactly one function applies the reductions and the defences.
- **"Nobody reacts" has a command.** The engine will not wait forever for a
  decision nobody is going to make, and it will not take the decision either.
- **A departing bystander cannot wedge the fight.** Their offer stays in the
  record and the settlement records it as passed. Only a departing *target*
  closes the window, with the damage undealt — the same honest record
  `settleHoldsInvolving` already writes for a held attack.
- **The turn has one thing to refuse on.**

### Ordering among two reactors is the caller's, and the log records it

SRD writes no rule for sequencing two voluntary Reactions, and the order is
observable: halving a total and then subtracting three is not subtracting three
and then halving. So the engine does not choose — **whoever answers first is
applied first** — and each `damage-reaction-answered` carries its own
reduction, so the log shows the sequence rather than a normalised total. That
is the smallest deterministic protocol that invents no rule.

### A reduction is an adjustment, and the SRD orders it

"Modifiers to damage are applied in the following order: adjustments such as
bonuses, penalties, **or multipliers** are applied first; Resistance is applied
second." So Uncanny Dodge's halving and Deflect Attacks' 1d10 both land
*before* Resistance, and a Rogue with Resistance who dodges takes a quarter.
The order is observable and a mutation that reversed it **survived the whole
suite**, because the fixture's Rogue resisted nothing. A test for an order of
application needs a target that has both.

What the SRD never says is which damage *type* a reduction comes off when an
attack deals two, because every worked example it prints has one. Uncanny Dodge
halves "the attack's damage" — the total, which `applyDamage` cannot take as
one number because Resistance is per type. So the engine chooses, once, in
`adjustmentsFor`: **largest raw amount first, ties by type name**. A choice
rather than a rule, which is why it is stated rather than buried.

### The two windows this batch added, and what they hold

`pendingDamage` holds the typed components as rolled, who dealt it, whether an
attack roll caused it, the reductions in the order they were taken, and the
offers still outstanding. `pendingTest` holds the resolved `D20TestResult` and
its offers. Both are in `GameState`, derived from events, and the turn refuses
to advance past either — the `pendingSaves` discipline, not the pending
Concentration save that had to be torn out.

**Closing a test window changes nothing**, deliberately. A standalone check or
save is a number the engine owns and a consequence the table owns; the window
existed so the number could be pushed. Same honest answer as
`SpellCheck.onSuccess: 'none'`.

**`resolveTest` is the command a DM always needed.** `rollAbilityCheck` and
`rollSavingThrow` were complete and correct and reachable only from inside a
spell's own resolution. A DM asks for a save constantly and the engine had no
way to be asked.

### What the window is *not*, and where it stops

- **Spell damage does not open one.** A spell rolls its damage once for every
  target it caught, so holding one target's share open would mean holding the
  whole casting open per target — a different debt. Cutting Words answers a
  sword and not a *Fireball*, and that is stated rather than silently true.
- **A spell's saving throws are atomic**, so nothing can be pushed inside
  `resolveSpell`. That is what blocks Countercharm, along with the fact that
  **nothing records what a save was against**.
- **A feature carries one grant**, which is what blocks Disciplined Survivor's
  reroll: the feature already grants six save proficiencies, and its second
  sentence is Indomitable's shape exactly.
- **`reactionOpportunities` transfers no authority.** It reports what is open
  and what it would cost; taking it goes through the command that checks all of
  it again, and the query re-checks affordability rather than trusting an offer
  in state that may have gone stale.
- **No nesting.** A Reaction cannot be answered by another Reaction: there is
  one open window at a time and the reducer refuses a second. No currently
  implemented SRD mechanic needs otherwise — the nearest, Counterspell on
  Counterspell, was already refused deliberately and stays refused.
- **Two windows open on the actor's opt-in; three open on detection.**
  `damage-rolled`, `test-rolled` and `damaged-by-creature` open because the
  engine found somebody who could answer. `hit-by-attack` and
  `casting-a-spell` open only when the *attacker* holds the attack or the
  *caster* holds the casting — so whether a Rogue gets their *Shield* depends
  on the other side's command. The engine holds every fact needed to say
  "somebody could answer this" before the swing; a pre-flight query is the
  consistent shape, and auto-holding would change the atomic path.
- **"Can answer" is not "would".** Cutting Words answers any creature's
  damage roll within 60 feet, allies included, so a Lore Bard with a die left
  turns every party hit into a two-command negotiation. That is the SRD, not a
  bug; withholding the offer by side would invent a rule. The tool surface is
  where "the Bard is not cutting the Fighter" belongs.
- **Spell attacks do not open `damage-rolled` either**, and the reason given
  above covers a *Fireball* but not a *Fire Bolt*: SRD Uncanny Dodge answers
  any attack roll, and a single-target spell attack rolls per target already.
  The same seam blocks Indomitable against a save a spell forced, a
  Concentration save or a repeat save: `resolveEffects` resolves every target
  in one breath, so `test-rolled` opens only from `resolveTest`. Both are one
  missing thing — **a casting's resolution suspended per target** — and
  Indomitable is executed today only for the saves a DM calls for directly.

### The duplicate check comes first, and this batch sprang the trap a fourth time

The `damage_pending` and `test_pending` guards were added to `castOrRelease`
above the replay check, beside a `saves_pending` guard that had sat there since
turn hooks landed. None is opened by a casting's own first run, which is why it
was quieter than the three before it, and it was the same trap: a retry that
arrives after somebody else held a roll open, or after the next boundary
raised a save, was told about the world instead of that its command had
landed. `unsettledRefusal` is now the one function that names those debts,
`castOrRelease` skips it for a replayed command, and `activateSpell` reads it
too — an activation is a Magic action into the world exactly as a casting is,
and it had none of the casting's guards.

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

`classes.md` has no parser, so all twelve class tables and their subclasses
are written out from the SRD text, one file each. Transcription is where typos
hide, so the tests assert *relationships* rather than presence — every printed
Proficiency Bonus against `proficiencyBonusForLevel`, slots never decreasing,
a subclass granted at the level the class says, a hit die the game uses — and
that suite runs against **every registered class**, not the one it was written
for. Pointing it at all twelve immediately found that Pact Magic breaks "slots
never go backwards", which is a rule rather than a typo: a Warlock's slots move
up rather than accumulate.

Growth tables get their own assertions for the same reason: Sneak Attack's dice
per level, the Monk's Martial Arts die, Bardic Inspiration, Rage, Wild Shape,
Favored Enemy. A table that climbs by the wrong step in the middle is exactly
what a transcription gets wrong and nothing else would catch.

A `classes.md` parser is the eventual home for this, and would replace the
hand-written tables without touching the structures around them.

### Twelve classes, and the seams that opening them exposed

All twelve SRD classes, each with the subclass the SRD publishes and a level
1–20 table. Creation and advancement are validated for every one of them.

**A class says what it is; a feature says what it does.** Three string matches
on feature ids came out over the course of getting here, and each was found by
a class the previous code could not have anticipated:

| Seam | Found by | Now |
|---|---|---|
| `wizard:scholar` for Expertise | Rogue, Bard, Ranger | `grants: { kind: 'expertise' }` |
| `evoker:evocation-savant` for free spells | Life Domain, Draconic, Fiend | `grants: { kind: 'spells' }` |
| `human:skillful` for a skill proficiency | Barbarian's Primal Knowledge | any feature whose choice is a skill |

A generalisation with one user is a guess dressed up as a structure. Each of
these became real when a second class needed it and differed in some way the
first had not — Expertise takes *two* skills and comes round twice, a domain
grant is **fixed** where the Evoker's is chosen.

**Three spellcasting styles, which are not interchangeable.** SRD's 2024 tables
head the column "Prepared Spells" for every caster, which is exactly what makes
three rules look like one:

| Style | Classes | Means |
|---|---|---|
| `spellbook` | Wizard | prepared from a book you had to fill |
| `prepared-from-list` | Cleric, Druid, Paladin | chosen fresh from the class list |
| `known` | Bard, Sorcerer, Warlock, Ranger | a fixed set; never prepared |
| *(absent)* | Barbarian, Fighter, Monk, Rogue | casts nothing at all |

**Absent is not zero.** A Fighter does not know zero cantrips; a Fighter has no
cantrips, so `cantripsKnown` is *absent* and `checkSpells` short-circuits
before it can ask a Fighter for a spellbook. The distinction earned its keep
twice: once for a class that casts nothing, and once for the Paladin and Ranger
— genuine casters, with slots and prepared lists, that have no cantrips.

**Two rules corrections from reading the tables rather than recalling them:**
2024 gives the **Paladin and Ranger spellcasting at level 1** (2014 started
both at 2), and SRD's **Multiclass Spellcaster table is identical to every full
caster's own**, which is why it is read off one rather than transcribed twice.

Class *features* are a different matter from class *tables*: 88 of 230 are
executed, and every one of the rest carries a note saying what a DM still does.
`npm run coverage` counts them, because a project that does not count them
will believe it has twelve working classes when it has twelve validated ones.
The recurring blockers, each wanted by several classes:

- **A class feature that replaces the Armour Class calculation.** Unarmoured
  Defense, wanted by Barbarian (Constitution), Monk (Wisdom) and Draconic
  Sorcery. Two classes wanting the same missing hook is what makes it a shape.
- **Extra attacks inside the Attack action.** The economy counts one Attack
  action, not the attacks in it, so Extra Attack is offered by nobody.
- **Reactions with triggers — built.** See "A Reaction Is A Window, Not A
  Trigger". Uncanny Dodge, Deflect Attacks, Deflect Energy, Cutting Words,
  Peerless Skill, Indomitable, Dark One's Own Luck and Retaliation all run.
  What is left in this family is named rather than vague: Countercharm needs a
  spell's saving throws to be interruptible *and* a save that remembers what it
  was against; Superior Hunter's Defense needs a Resistance with a deadline;
  Slow Fall needs falling; Disciplined Survivor's reroll needs a feature to
  carry two grants; a stat block's printed Reactions are not read at all.
- **Auras that follow a creature.** Every Paladin aura, Spirit Guardians.
- **Defences that change after a rest.** Fiendish Resilience, Rage.
- **A grant that can be re-chosen on a rest.** Circle of the Land's spells, and
  every "swap a prepared spell on a Long Rest" rule.

### Multiclassing

`multiclass.ts` holds the rules that belong to no single class, because every
one of them reads *across* the set. `CharacterChoices.multiclass` carries the
classes beyond the starting one — SRD's own framing, since the starting class
is the one that grants its proficiencies in full.

- **Proficiency Bonus and character level come from the total**, never from a
  class level. A level 3 Fighter / level 2 Rogue is a level 5 character.
- **Spell slots come from a weighted sum** — all your levels in the five full
  casters, half rounded up in Paladin and Ranger — read off the full-caster
  table, not from adding two classes' tables together.
- **Pact Magic is a second pool.** SRD keeps it out of the sum and then lets
  the two be spent on each other's spells, so merging them would invent a slot.
- **Prerequisites read both directions**: 13 in the primary ability of the new
  class *and* every class you already have.
- **Hit Dice pool by die type**, and hit points pay the maximum die once, for
  the starting class, at total character level 1.

**Two casting classes is refused**, and the refusal is the honest answer rather
than a gap. SRD requires each prepared spell to remember which class prepared
it and to use that class's spellcasting ability; a creature here carries one
prepared list and one ability, so validating a merged list would record a
character the rules do not describe. The slot arithmetic for that case is
implemented and tested against the SRD's worked example — per-class preparation
is what is missing.

### What is still missing around the class system
- **Three of the four Origin feats are executed; one is not.** The choices
  every feat demands are checked — Magic Initiate's spell list, spellcasting
  ability, two cantrips and level 1 spell, all against the parsed SRD;
  Skilled's three proficiencies; and the rule that Magic Initiate taken twice
  must use different lists. Beyond validation: Magic Initiate's spells are
  castable on the feat's own ability with its free daily casting as a pool,
  Alert's Initiative Proficiency rides on the roll, and Skilled's proficiencies
  are on the sheet. **Savage Attacker's reroll is not applied**, and Alert's
  Initiative *swap* is not offered. Each feat's note says which it is, and so
  does every Ability Score Improvement feature that grants one — because
  whether a feat does anything is a property of the feat, not of the class
  feature that handed it over.
- **Ability Score Improvements taken as score increases** rather than as feats
  are not modelled; the choice is always a feat.
- **Owning and wearing are separate; weight and attunement are not modelled.**
  `inventory` is everything the character has — class package, background
  package, and anything the GM added — and `equipped` is the subset actually
  worn or held. Armour Class reads `equipped`, so a chain shirt in the backpack
  protects nobody. What is still missing: weight, attunement, containers, and
  whether the quarterstaff in the package is the same object as the arcane
  focus. Every package entry is a catalogue id and packs are opened; what is
  missing is weight, containers and attunement.
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

Audited against SRD 5.2.1 "Character Creation". Every required choice and grant
is accounted for, for every class; anything the engine does not execute says so.
The table below names the Wizard path it was first written against, and every
check in it runs for all twelve.

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

## A Persistent Area Catches You At A Moment The Spell Names

Twenty-odd SRD spells fill a patch of ground and then go on doing something to
whoever is standing in it. A taxonomy audit read them all and found that
"an area trigger" is **not one mechanic** — it is at least eight, and this
builds two of them:

| | SRD wording | Detected at |
|---|---|---|
| **A turn boundary** | "starts its turn there" / "ends its turn there" | `turn-advanced` |
| **Entering** | "enters the area" | the creature's own authoritative position change |

An area that *moves onto* a creature is a third, and is built — see "An Area
Can Arrive At A Creature Standing Still". Everything else the audit named is
still out: a path or a distance travelled, an aura the holder carries, an
activation that blasts a point, a barrier. Each is a different detection with
different evidence, and one generic "trigger system" would have been a
framework built from one example.

### The clauses are transcribed, not taxonomised

`AreaTrigger` has three fields and each is one sentence out of the book. The
three frequency behaviours everyone talks about fall out of the combinations
rather than being an enum somebody invented:

| Spell | `at` | `onEntry` | `oncePerTurn` | Comes to |
|---|---|---|---|---|
| Insect Plague | end | first-per-turn | **yes** | one save a turn, whichever clause reached them |
| Web | **start** | first-per-turn | — | the entry is capped; the boundary is not |
| Grease | end | every-entry | — | nothing is capped at all |
| Black Tentacles | end | every-entry | **yes** | one save a turn |

**Web against Insect Plague is the pair that proves the difference is real.**
"The first time a creature enters the webs on a turn **or** starts its turn
there" caps the *entering*; a creature that began its turn in the webs has not
entered, so tearing free and walking back in is still that turn's first entry
and saves again. Insect Plague's "a creature makes this save **only once per
turn**" caps the *creature*. One per-turn stamp serving both would be Insect
Plague's rule wearing Web's name, and every single-spell fixture passes under
either reading.

**A cloud next door must not lend a spell a clause it does not print.** The
guard is not a comment: each definition's own SRD prose is read out of the
parsed book and the three fields are held against it, the same technique
`spell-tracking.test.ts` uses. Stinking Cloud names no entry clause; nothing
can quietly give it one.

### The debt is not a `PendingSave`, and the difference is the rule

`OwedAreaEffect` is the fourth debt of this shape and it was worth not folding
into the third:

| | `PendingSave` | `OwedAreaEffect` |
|---|---|---|
| Presupposes | a condition or timer already on the target | nothing; the target may be untouched |
| What the roll does | releases an effect that is already running | applies the spell for the first time |
| On success | the effect ends on that creature | whatever the spell says — often half damage |
| Keyed by | the timer it belongs to | the casting and the creature |

Forcing Web's "save or be Restrained" into a shape that exists to let a
Restrained creature *stop* being Restrained would have inverted the rule.

**It holds facts and never behaviour** — a casting id, a creature, a moment, a
turn. No predicate, no callback, no copy of the spell: settlement looks the
definition up through the casting's own `spellId` and runs it at the level and
route the casting was made with, through the same machinery an ordinary
casting uses. There is no second save calculator and no second damage
resolver, and the caller supplies no DC, no roll and no outcome.

**A list, not a keyed record**, which is the one place it differs from
`pendingSaves` in storage as well as meaning: a save is keyed by effect and
turn so that one boundary raises one of it, while Grease caps nothing and a
creature that walks in three times owes three.

### The two moments in one `turn-advanced` are a round apart

One event carries the finishing creature's end and the next creature's start,
and they are **not simultaneous**.

**Ordering the settlements is not enough**, and the first version of this made
exactly that mistake: it raised both sets of debts in the same fold and then
sorted them. Sorting settles them in order; it does not *determine* them in
order. Whether the next creature is caught at its start is a question about the
world the previous creature's end left behind — and that world does not exist
while the end is still owed.

So `turn-advanced` raises the end and records `pendingTurnStart`; a derived
pass reaches the start once nothing the end owed is outstanding, and raises the
start debts from *that* state. Derived rather than emitted for the usual
reason: nobody decides that a moment has arrived. A replay reconstructs both
because the fold does — the same log leaves the same debts outstanding at the
same points.

The common case passes straight through inside the fold of `turn-advanced`
itself, so a boundary that owes nothing behaves exactly as it always did and no
caller learns there were two moments. A caller with no generator can stop
between them: the end stays owed, the start has not happened, and the creature
whose turn it is may not act until both are settled.

Settlement still orders — end, then entry, then start — and re-reads the queue
on every pass rather than snapshotting it, because settling the end is what
brings the start about.

**The end of a turn belongs to the turn that is ending**, and `turnsTaken` has
already moved on by the time the reducer sees the event. Stamping the end with
the new number put a creature's entry and the end of the very turn it entered
on into two different turns, and Insect Plague's cap caught it twice.

**Settled before the Death Saving Throw**, deliberately. Both are "at the start
of your turn" and the SRD orders neither, but only one order leaves room for a
start-of-turn *heal* to matter — Aura of Life's shape — and an ordering that
makes a future rule unreachable is the wrong one to pick by accident.

### A spell already cast does not change when its caster does

`OngoingSpell` stored the *route* — a name — and every later use resolved it
against the caster's **current** sheet and derived the numbers again. A Cleric
who levelled between conjuring a Web and somebody walking into it moved the
save DC; so did an Ability Score Improvement, a new proficiency bonus, or
preparing the same spell through a second class.

So the numbers are pinned at the casting, and there are four of them rather
than a snapshot of the sheet:

| | Read by |
|---|---|
| `saveDc` | every save the spell calls for, and every escape check it offers |
| `attackModifier` | a later spell attack — Spiritual Weapon, Vampiric Touch, Flame Blade |
| `spellcastingModifier` | "plus your spellcasting ability modifier" on damage, healing and Temporary Hit Points |
| `casterLevel` | a cantrip's upgrade steps, read off the caster rather than off the slot |

What goes on being read live is everything about the creature it is happening
*to*, and everything about the caster that is genuinely current — a Bless on
them now applies now.

**A casting can outlive its caster, and the pinned numbers are why that works.**
SRD Grease runs its minute whether or not the wizard does, and a save it calls
for afterwards is still owed; forgiving it because the DC could not be
recovered would be the engine losing a rule to its own bookkeeping. What
genuinely cannot happen is an effect that throws dice *from a sheet that has
left*, so `resolveEffects` takes a nullable caster and is loud rather than
quiet about it. A saving throw needs no sheet, and every non-Concentration area
trigger in the book is a bare saving throw — asserted, not assumed. A
Concentration spell never reaches the question, because its caster leaving ends
it.

### A mandatory effect blocks everybody; an un-arrived start blocks one creature

`mayAct` is the one policy, called by every command that spends an Action, a
Bonus Action, movement or a feature's use: Dash, Disengage, Dodge, Ready,
feature activation, the three pool commands, an effect check, an attack, a
move, a casting, an activation, and the turn. A sweep holds the list, so a
command added without the guard fails there rather than in play.

**An owed area effect is global engine debt, and getting that wrong is
instructive.** It was per-creature for one commit, on the reasoning that a
goblin's unmade Web save says nothing about the wizard across the room. The
counterexample is three moves long and every move is an existing mechanic:

1. a Cleric concentrates on Hold Person, and a goblin is Paralyzed by it;
2. the Cleric is shoved into an Insect Plague and owes its damage;
3. a third creature attacks the goblin.

Settling step 2 can drop the Cleric, break the Concentration and free the
goblin — so step 3 is an attack against a creature who may already be free, and
that is not a small difference: Paralyzed within 5 feet is Advantage and an
automatic Critical Hit. **The engine does not work out which actions happen to
be independent**, because it does not need to: settle the mandatory mechanical
fact first. That is exactly why `pendingDamage`, `pendingTest` and
`pendingSaves` are global, and this belongs with them.

**A turn whose start has not arrived stays per-creature**, and the difference
is that *nothing has been raised yet*: what is unresolved is whether this
creature is about to be caught, and their budget has already refreshed. No
mechanic makes that anybody else's problem, and no evidence says otherwise.

**Reactions are not routed through either**, nor is `settleAreaEffects`, nor
are the commands that close a window somebody else opened. A guard that refused
its own settlement would be a deadlock wearing a rule's clothes.

**After the duplicate check, never before it** — the sixth instance of that trap
in this file. A retry arrives at the debt its own first run raised.

### Causing a condition and owning it are two different links

The engine had one mechanism for both: the casting id inside the condition's
source. That is right for every condition a spell *sustains* — Hold Person's
Paralyzed "for the duration", Web's Restrained "while in the webs", Black
Tentacles' "until the spell ends". SRD Grease sustains nothing: "or have the
Prone condition", and Prone ends when the creature stands up.

So the casting ending was lifting a condition the book leaves standing, and a
Dispel Magic aimed at a greased creature stood them up. `outlivesCasting` on the
effect records the condition under the spell's **bare name**: the log still says
what caused it, the casting's cleanup walks past it, and the casting is not
*on* the creature.

That last part made the two halves of `on` agree at last. **A casting is on a
creature while it has a live effect there that the casting owns** — the rule
`alsoOn` already applied when a triggered effect landed a minute later, now
applied at the cast as well. Damage alone is not being on somebody: the swarm
bit you and is carrying nothing of yours.

### Entering is a position that actually changed

Raised from `creature-moved`, `mounted` and `dismounted` — never from a
declared move. A declaration is an intent an Opportunity Attack can end, and
raising there would charge a creature for walking into a Web it never reached.

**Every creature whose position changed, not the one the event names.**
`moveCreature` carries riders with their mount, so a rider crosses into a Web
with no event mentioning them at all. Reading `event.id` is a bug only a
mounted fixture catches.

**Placement is not entry, and that is structural.** A creature being put into
the scene is not in the previous scene's positions at all, so it has no outside
to have come from and the diff cannot fire for it. There is no guard saying so
because there is nothing to guard: a mutation that calls the detector from
`creature-placed` changes no behaviour. The same goes for an unplaced creature,
which is in no area.

**Settlement is its own command**, and the reason is `declineOpportunity`: it
completes somebody else's declared move and has no generator to roll a save
with. A debt only the moving command could settle would wedge the fight on
exactly that path.

### What it cannot see, stated rather than guessed

**The path.** Movement records where a move started and where it ended and
nothing in between, so a creature that walks clean across a Web and out the
far side transitions outside → outside and nothing fires. Inferring the
crossing from a straight line between the endpoints would be the engine
inventing a route nobody took. SRD lets a creature break its movement into
segments and each segment is a move this *does* see, which is the operational
answer until movement records a path — and it is why Spike Growth ("2d4 for
every 5 feet it travels") is not attempted at all.

**Outside combat nothing is capped.** There is no turn to be once-per, so every
entry fires — the reading the one-slot-per-turn rule and every once-per-turn
feature already take, preserved rather than invented.

### `OngoingSpell.on` grows, and here is the half that does not

SRD Dispel Magic ends "any ongoing spell ... **on the target**", and `on` was
written once, at the resolution, because that was the only moment a casting
could reach anybody. A persistent area breaks that: Web restrains a creature
that walks in a minute later, and a Dispel Magic aimed at *them* has to find
it.

So `on` grows, derived, on the link every other cleanup already uses: **a
casting is on a creature while it has a live effect there that the casting
owns.** Deliberately not "everyone the area has ever touched" — a creature
Insect Plague damaged carries nothing of the swarm's, so the swarm is not on
them.

**The asymmetry is real and is not new.** `on` grows here and still does not
shrink when an independently-timed condition lapses. That was already an open
debt; before this, no executed spell reached it, and now Web does. And Web's
Restrained is worse than that: SRD says it lasts "while in the webs", and a
condition that ends when its holder walks out of an area has no shape here at
all — so it runs until the casting ends or the creature breaks free, and the
definition says so in `unmodelled`.

**One finding worth carrying:** Grease's Prone is linked to its casting, so the
engine lifts it when the Grease ends. SRD leaves Prone standing until the
creature gets up. That was true before this batch and `on` growing makes it
reach further; it is a fix to Grease's definition, not to `on`.

### A test that passes for the wrong reason is what mutation testing is for

"A move that never leaves the area" passed against a *mutation that should have
broken it*, because the landmark it walked to was outside Grease's Cube —
Grease is a **10-foot** square and Web a 20-foot one, and a spot chosen for the
larger left the smaller. The assertion was right, the fixture was wrong, and
nothing but a deliberate break could have said so.

## An Area Can Arrive At A Creature Standing Still

SRD Moonbeam writes three trigger clauses in one sentence, and the first is
not a way of saying the other two:

> "A creature also makes this save **when the spell's area moves into its
> space** and when it enters the spell's area or ends its turn there. A
> creature makes this save only once per turn."

| | SRD wording | The authoritative operation |
|---|---|---|
| **A turn boundary** | "ends its turn there" | `turn-advanced` |
| **A creature entering** | "enters the spell's area" | the creature's own position change |
| **An area arriving** | "the spell's area moves into its space" | the **area's** position change |

Cloudkill, Incendiary Cloud and Spirit Guardians print the same pair; Insect
Plague, Web, Grease and Black Tentacles print no such clause and their areas
never move. **A neighbouring spell's moving-area sentence lends a fixed area
nothing**, so the clause is a field on the trigger, checked against the spell's
own prose out of the parsed book.

### The operation says what changed; nothing asks whether membership did

`creature-moved` means a creature's membership may have changed;
`spell-origin-moved` means *this casting's area* moved. Two detectors, each
answering the operation that raised it. The weaker question — "did membership
change somehow" — would pass every test in both files and would have erased
the distinction the book drew, which is observable in two places: the caps can
differ, and the log has to say which clause caught somebody.

**The event needed no extension at all.** One casting had one point, and now
that point is somewhere else — which is what `spell-origin-moved` already
said. The detector hangs off its reducer case, derived like every other
consequence, so a replay reconstructs both the point and the debt.

### `area-moved` is a fourth moment, not a fourth cause of `entry`

`entry` is deliberately one value for walking in, being shoved in and being
carried in by a mount, because the SRD writes one clause for all three. An
area arriving is a *different clause*, and two things follow that a shared
value gets wrong:

- **The entry cap must not be spent by it.** `onEntry: 'first-per-turn'` is
  Web's cap on *entering*, and a beam sliding onto a creature standing still
  is not that creature's first entry of the turn. So the stamp field is
  `byCreatureEntry` — named for the cause, because the shorter `byEntry` read
  as true of both — and an area's arrival never sets it.
- **The history must say which happened.** "You walked into the beam" and
  "the beam swept over you" are different answers to why a creature is hurt.

No registered spell prints both clauses today, which is exactly when the narrow
reading is cheap to write down and impossible to reconstruct later. What the
two *share* is the consequence: one `OwedAreaEffect`, one queue, one
settlement, no second save calculator.

### The movement allowance is the action, not a rider on one

Two SRD sentences, two fields, and collapsing them would make a movement-only
action indistinguishable from a rider that was declined:

| | SRD | Field |
|---|---|---|
| Spiritual Weapon | "move the force up to 20 feet **and** repeat the attack" | `CastingOrigin.movableBy` |
| Moonbeam | "take a **Magic action** ... to move the Cylinder up to 60 feet" | `SpellActivation.movesArea` |

So Moonbeam's activation carries no range, no effects and no targets, and a
caller who names a destination is required rather than optional — a Magic
action spent moving nothing is not something the spell offers. Giving it a
`CastingOrigin.reach` instead would have been inventing a distance the book
never prints, purely to make it fit the other spell's shape.

**Range is where an area may first be put; the allowance is how far it then
travels.** Moonbeam reaches 120 feet and moves 60, from wherever the beam now
is — so a beam walked steadily away ends up further from its caster than the
spell's Range, and re-checking against the caster would wrongly forbid it.

### Two points do not imply the line between them

**This is the part that could not be hand-waved.** A beam that steps twenty
feet passes over the space in between by any route a person would draw, and
the engine has no route: Chebyshev distance says how far an origin moved, never
which way it went. Drawing a straight line would be the same invention
`raiseAreaEntries` already refuses about a creature's own movement, and a
displacement is in any case only a *lower bound* on the distance travelled.

So the route is the caller's to state. `ActivateSpellCommand.via` carries the
spaces the area passed through, each consecutive pair is one authoritative
relocation with its own `spell-origin-moved`, and the allowance caps the **sum
of the legs** — which is what "up to 60 feet" measures, so a beam walked round
three sides of a square has spent all three. With no waypoints there is one
leg and the sum is the displacement, so every existing caller is untouched.

A leg one space long has nothing in between to be unknown. **Any longer leg is
a question**, and asking is the third option that the two obvious ones hide:
draw a line nobody drew, execute the move while silently skipping whoever it
crossed, or go and get the fact. The first two are the same failure in
different clothes.

So a coarse leg comes back as `needs-context` with a `route` request, and
nothing is spent — no action, no die, no debt, no movement. Only where a rule
reads the route: a casting whose area triggers on nothing as it travels has no
route to be wrong about, which is every Spiritual Weapon, and giving it the
requirement because Moonbeam has it would be a neighbouring spell's clause
lending it a rule again.

Not a path *finder*. Nothing searches, smooths, or checks that consecutive
waypoints are adjacent: a waypoint is a fact the caller supplies. Spike
Growth's "2d4 for every 5 feet **it travels**" is a creature's distance and a
different primitive, and is still not attempted.

### `via` is adjudicated, and asking for it is not a refusal

A player says "move the beam onto the ogre". Which way it goes — through the
other two ogres, around the paladin, straight there — is judgement about intent
and fiction, and **Maestro owns it**, because Maestro is the layer that reads
the fiction. The engine validates the route and never chooses it: the same
boundary `eligibleTargets` draws for targeting, where the shortlist is a
shortlist and never a substitution.

| | |
|---|---|
| Maestro decides | which spaces the area passes through, whether to sweep through enemies, whether to keep off allies, what the player's words already settled |
| The engine decides | that every waypoint is on the lattice and in the scene, that the legs add up to the allowance, who the area arrives on, and what that costs them |

**The engine is blind to sides, deliberately.** A route that catches the
caster's own party catches them, because that is the route it was given.
Sparing allies would be the engine overriding the command it was sent, which is
the targeting failure in another costume.

`route` is a new `ContextRequest.kind` and the odd one in that union: every
other kind is satisfied by *declaring a fact* through a command of its own, and
this one by *re-sending the same command with a field filled in*. `satisfyWith`
says which, as it does for all of them.

**Never describe this as the engine rejecting a turn.** Nothing here reaches a
player. It is the collaboration boundary the whole `needs-context` channel
exists to be: the engine refuses to invent the missing fact, Maestro supplies
the judgement, the engine resumes the action the player meant.

### A route settles as the area reaches each space, not once it is over

SRD Moonbeam: a creature makes the save "when the spell's area moves into its
space" — at that point in the route. That is not a nicety, and the case that
proves it is three moves long:

1. the druid is concentrating on Moonbeam and sweeps it onto their own space;
2. the save lands, the damage lands, the Concentration save fails;
3. Moonbeam ends — so the waypoints after that **never happen**.

An implementation that emitted every leg and settled afterwards gives the same
answers right up until a consequence changes what the rest of the route may do,
and then gives the wrong one silently. So each leg is moved, settled, and only
then followed by the next: `spell-origin-moved`, the `area-effect-settled` it
caused, the next `spell-origin-moved`. The settlement is `settleAreaEffects` —
the same command a turn boundary and a creature's own move already use, reached
with the generator the action already holds, so there is no second resolver and
no caller-supplied save, DC, damage or Concentration decision.

**A casting that ends mid-route is a successful action, not an invalid one.**
Nothing is rolled back: the action was spent, the beam moved, and what it did
to the caster is why there is nothing left to move. The command returns the
events that actually occurred, and its identity is recorded so a retry reruns
neither the movement nor the damage.

**That moved `spell-activated` above its own content.** It used to be written
after the movement; an event saying the caster took the spell's later action,
written after the casting it names has gone, is the log arriving in the wrong
order. The stamp still rides on it, because it still always happens.

**And it sharpened the duplicate check once more.** A retry of a route that
ended its own casting finds no such casting — so a `not_ongoing` refusal above
the duplicate check would tell a caller their command was impossible when it
had in fact succeeded. Seventh instance in this file; same shape every time.

### Creation is not movement

A casting's first record says where its area is and raises nothing: the
creatures standing there are caught by "when the Cylinder appears", which is
the casting's own effect. Only a move of an area that already exists reaches
the detector, and that is structural rather than guarded — `spell-origin-moved`
throws for a casting that holds no point.

### One action is one move, which is why the same-turn repeat lives in a route

The caster has one Magic action a turn, so a beam cannot be swung twice by two
activations without a turn passing between them — and the cap is per turn. The
creature that *can* meet two clauses inside one global turn is therefore the
caster itself: it moves the beam onto itself, and then its own turn ends with
it still standing in it. A stated route is the other case, because a route may
arrive on a creature, leave, and arrive again.

**A beam that drops its own caster's Concentration ends the spell**, and a
fixture that lets that happen goes on asserting things about a Moonbeam that is
no longer there. Half damage on a made save is still damage, and is what those
tests read instead.

## An Area Can Be Carried, And Then Its Origin Is Not A Point

SRD's glossary settles this in one sentence, and it is not a Spirit Guardians
rule but the definition of the shape:

> "An Emanation **moves with the creature or object that is its origin** unless
> it is an instantaneous or a stationary effect."

So a casting's area sits at a point *or* on a creature, and which it is was
decided at the casting by the definition:

| | `area.origin` | Read from | Spells |
|---|---|---|---|
| A point the casting keeps | `point` | `record.origin` | Web, Grease, Insect Plague, Black Tentacles, Moonbeam |
| The caster, wherever they now are | `self` | `record.caster` | Spirit Guardians |

**`OngoingSpell` needed no new field for this**, and that is the finding. Both
facts were already there: the definition says `origin: 'self'`, the record says
who cast it, and `creaturesInArea` has taken `{ creature }` since positioning
landed. A copied point would have been a second answer to "where is the aura",
kept in step by remembering to update it — and the first operation that moved
the caster by a route that forgot would leave the aura frozen where it was.
Deriving it is not an optimisation; it is the difference between one fact and
two facts that can disagree.

The same reading is what makes a carrier who *leaves* behave correctly: an
Emanation whose origin creature has no position catches nobody, rather than
hanging in the air at the last place they stood.

**An Emanation measures from the whole carrier and excludes it.** Both were
already true of `creaturesInArea` and both are load-bearing here: a Huge
carrier's 15-foot Emanation reaches 30 feet from the anchor where a Medium
carrier's reaches 15, and a cleric is never hurt by the spirits they are
carrying.

### A carrier walking is the area arriving, not the creature entering

One authoritative fact — a creature's position changed — and two rules read it,
because the SRD writes two clauses in one sentence: "whenever the **Emanation
enters a creature's space** and whenever **a creature enters the Emanation**".

| | Whose position changed | Who is caught | Moment |
|---|---|---|---|
| `raiseAreaEntries` | the creature that is caught | creatures that moved | `entry` |
| `raiseCarriedArrivals` | the **carrier** | creatures that did **not** move | `area-moved` |

A creature that moved has entered; a creature that stood still has been entered
upon. Asking the weaker question — "did membership change somehow" — would pass
every test in both files and erase the distinction the book drew, and the two
clauses can be capped differently.

**The carrier is whoever actually moved, never whoever the event names.**
`moveCreature` carries riders with their mount, so a cleric on a horse takes
their aura with them on an event that mentions only the horse. Reading
`event.id` is a bug only a mounted fixture catches — the same lesson the
creature-side detector already learned, arriving a second time.

### The carrier's route is the same question, from the other side

Moonbeam asks to move an *area* thirty feet; a carrier asks to move a
*creature*, and the area comes along. Either way the engine holds two endpoints
and no route, and either way the creatures who would be caught are the ones who
did nothing. So the answer is the same answer: a move of more than one space
comes back as `needs-context` with a `route` request naming the casting, the
carrier, both ends and what to send instead.

**It reuses movement rather than adding a route field**, and that is deliberate.
A creature move is already authoritative, already segmentable, and the global
area-debt guard already stops the next voluntary action until what a step
raised has been settled — so a Maestro-adjudicated sequence of five-foot steps
already settles as it goes. A `MovePath` here would have been a second
mechanism for something movement can express, built for symmetry with Moonbeam
rather than because a rule asked for it.

### Two clauses the geometry must not quietly absorb

**Designating creatures unaffected is a choice, and never allegiance.** SRD:
"When you cast this spell, you can designate creatures to be unaffected by it."
Alarm prints the same shape, which is what makes it a transcribed clause rather
than a general area filter. It is chosen once and kept, so it outlives every
later move; it is filtered inside `creaturesInCastingArea`, so the one decision
reaches every sentence that reads the area; and it is **explicit**, because a
cleric may spare an enemy and may decline to spare an ally. Substituting `side`
would be the engine answering the question the caster was asked.

**A damage type the SRD decides on a fact the engine does not hold is stated,
not guessed.** "3d8 Radiant damage (if you are good or neutral) or 3d8 Necrotic
damage (if you are evil)." Alignment is held for a character the engine built
from choices and for nobody else — not a monster, not a declared NPC — and
side, class and deity are none of them alignment. So the casting states which,
the engine refuses anything the spell does not print, and the answer is pinned
on the casting exactly as the save DC is. Picking Radiant because most clerics
are good is where a Necrotic-immune Undead finds the engine out. This is the
discipline declared cover and declared sight already follow, and it is **not**
an alignment system: building one needs a second user.

### Coverage needed a third word

`verified` claims a spell is complete and driven; `untested` says nothing
drives it. Spirit Guardians is neither — its Emanation, three clauses, cap,
save and damage all run under a suite of their own, and the **halved Speed
inside the Emanation** is a rule the engine owns and has not written. That is a
standing spatial effect rather than a trigger: it wants a Speed derived from
where a creature is standing, and mutating a base Speed on entry and exit would
be correct only while every enter and leave paired up perfectly.

So `PARTIAL_SPELLS` is the third state, and a spell listed there must say in
`unmodelled` what it is missing — otherwise it becomes the place claims come to
be quietly parked. Same move the adjudication map made when `table` and a
missing shape could not express `engine`.

## Turn Boundaries Collect What They Are Owed

SRD effects that repeat a save are everywhere — Hold Person, Dominate Person,
Ensnaring Strike — and they all have one shape: a moment, a save, and something
that happens when it lands. "At the end of each of its turns, the target
repeats the save, ending the spell on itself on a success."

**The effect carries its own hook.** A `RepeatSave` on the timer says which
boundary it fires on, whose turn, which ability, against what DC, what a
success does, and how the roll reads in the log. Everything the resolution
needs is on the effect rather than in the caller's head, because the point is
that nobody has to remember it: the turn knows what it owes.

**Raising is derived; rolling is commanded.** The reducer cannot roll —
randomness enters the log once, at the point of the roll — so `turn-advanced`
*raises* the saves the boundary owes into `pendingSaves`, and `resolveTurn`
rolls them. Raising is derived for the same reason a broken Concentration is:
nobody decides that a turn ended, so nobody should have to remember what
ending it costs.

**A pending save is a debt, not a leak.** This looks like the pending
Concentration save that had to be torn out, and is its opposite in the way that
matters:

| | The one that was wrong | This one |
|---|---|---|
| Where it lived | a return value | `GameState`, derived from `turn-advanced` |
| After a reload | gone | still there, because the fold rebuilds it |
| If forgotten | the spell silently stayed up | **the next turn is refused** |
| How to settle it later | there was no way — the command id was spent | `resolvePendingSaves` |

`resolveTurn` given a generator rolls immediately; given none it leaves the
debt in state and then refuses to advance again until it is paid. Forgetting
stops the game rather than quietly dropping a rule, which is the only version
of "optional" that is honest here.

**One boundary raises one save.** Pendings are keyed by effect *and* turn, so
folding the log twice raises it once, and the next turn raises it again — which
is what "repeats the save" means. An effect that ends first takes its hook and
any outstanding debt with it, so nothing waits on a save for a spell that is
already over.

**A success ends the effect where the hook says.** `end-on-target` is Hold
Person's "ending the spell **on itself**": that creature is freed, the casting
carries on for anyone else it caught, and the caster keeps concentrating
because the spell is still doing something. `end-casting` is for effects that
end outright. Either way, other targets, independent effects and the caster's
Concentration are untouched.

One bug this design caught in itself: releasing an effect on one target looked
up its timer by rebuilding a key from the first doomed condition instance — and
`doomed` includes the conditions the effect *implied*, which sort ahead of it
(`incapacitated:...` before `paralyzed:...`). The lookup pointed at the wrong
timer, left the real one running, and the hook fired again on a spell that had
ended. Filtering the timers rather than guessing a key is what fixed it.

## A Definition Is Validated Data, And The SRD Is Its Oracle

`spell-definitions.ts` was never code. All 125 definitions are pure declarative
data — closed typed unions, no expression, no hook — and the runtime holds no
spell-name special case anywhere, which is asserted rather than assumed. So the
comparative audit's "move definitions out of TypeScript" named the wrong half
of the problem. **What was missing was the validator, not the format**: the
compiler was the only guard, so a definition that did not arrive through `tsc`
had nothing to check it at all.

Three questions, three places, and conflating any two is how "valid" comes to
mean "official":

| | Asks | Applies to |
|---|---|---|
| `spell-schema.ts` | is this definition **coherent** | any definition, SRD or homebrew |
| `scripts/spell-oracle.ts` | does it **agree with the printed spell** | only a definition whose id is in the book |
| `commands.ts` | may **this casting** happen, here, now | every cast |

A DM's invented spell is valid engine data and is not SRD-conformant, and both
halves of that sentence are load-bearing. `spell-schema.test.ts` drives one
through the validator and asserts it is not in the parsed book.

**`checkSpellDefinition` returns every problem, with a path on each**, which is
the `checkCharacter` shape for the `checkCharacter` reason: an author does not
want to be told about one mistake at a time. `parseSpellDefinition` takes
`unknown` and is the `Result` half, so a definition may come from a file, a
loader or a tool rather than from a compilation.

**Every rule was run against all 125 definitions before it was written, and
none of them fires.** These are the rules the catalogue already obeys, moved to
where a *new* definition meets them rather than being discovered by a sweep
test casting the spell and finding nothing happened. Several were previously
enforced in four different test files or nowhere at all. The ones worth naming:

- a **`#` in a spell name forges a casting link** — `castingSource` writes
  `Hold Person#cast:3` and `castingIdOf` reads it back, so a name carrying one
  could attach its effects to somebody else's casting, or detach its own from
  cleanup. Refused at cast time already; now refused at authoring.
- **slot scaling on a cantrip, and a Cantrip Upgrade on a levelled spell.**
  `scaledDiceFor` takes one branch or the other and silently ignores the field
  belonging to the one it did not take. This is the exact confusion that had a
  level 3 Wizard throwing Fire Bolt for 2d10.
- a **rolled bonus aimed at an Armour Class.** `armorClassOf` reads the flat
  half and nothing else, because a standing number has no moment at which a die
  could be thrown for it — so a rolled one is data nothing can apply.
- **a definition that resolves nothing and declares nothing.** The tracked rule,
  and the easiest mistake in the format to make, because it compiles.

**A field the engine does not know is not an error.** A definition written
against a later version is data this one does not understand rather than data
that is wrong; refusing it would make every schema addition a breaking change
for stored content.

**`checkShape` is the one place a runtime value restates the effect union**, and
the way that rots is a member added to the type and not to the set. The whole
catalogue is driven through `parseSpellDefinition`, so it fails the day that
happens rather than the day somebody loads a file.

### Range and duration had no oracle, and that was the named blind spot

`coverage.test.ts` has held every definition against the book for name, level,
school, casting time and Concentration. Two printed fields were never checked,
and this file already said so: *"the duration is the field with no automatic
check"*. Between them they are 250 numbers nobody was watching, and the class
of bug is the one this repository has had twice — Fire Bolt at 2d10, Finger of
Death dropping its flat 30.

Both turn out to be **structured in practice**. Across all 339 parsed spells
there are eighteen distinct range strings and twenty-four distinct duration
strings, and every one fits a three-line grammar. So they are parsed, and the
grammar is asserted to cover the *whole book* rather than the corner the
catalogue uses — a parser that silently returns null for a wording it does not
know reports no problems and checks nothing, which is what `animals.md` taught.

**The prose is deliberately untouched.** Damage dice, save abilities, area
shapes and sizes, conditions and scaling all live in the description; SRD 5.2.1
prints plain ranges (`Self`, `120 feet`) with the template in the sentence.
Anything claiming to oracle an area would be parsing English and calling the
result data. `spell-tracking.test.ts` scans that prose for *markers* and demands
a written adjudication, which is what prose honestly supports.

**One definition disagrees with the book, and the number is not the thing to
change.** Guiding Bolt prints `Duration: 1 round`, and the whole of what that
round bounds is its one `unmodelled` clause — the Advantage the next attacker
gets. Giving it six seconds would schedule a timer for a casting with nothing
to expire and make an ongoing record for a spell that is on nobody. So it takes
a **written exemption**, in the same shape the prose adjudications use: an
exemption must be needed, must still be needed, and must say something, and
each of those three is a test.

**The engine definition remains authoritative for execution.** The oracle can
say a definition disagrees with the book; it can never say what the spell does.

### An Armour Class a spell sets is not one it adds to

SRD Mage Armor: "the target's **base AC becomes 13 plus its Dexterity
modifier**." A flat `+3` on `ac` gives exactly the same number for an ordinary
unarmoured creature, which is what makes it the tempting answer and the
dangerous one. Two cases separate them and both fail silently:

- it would stack on a Barbarian's Unarmoured Defense, and SRD Multiclassing
  says "If you have multiple ways to calculate your Armor Class, you can
  benefit from only one at a time";
- it would stack on worn armour, which the spell's own sentence forbids.

**It is the shape Unarmoured Defense already is** — an alternative base
calculation, applying while unarmoured, the best applicable one winning — so
`armorClassCalculation` folds both sources into one comparison rather than
growing a second mechanism. Two concrete mechanics asking for one primitive is
the evidence the generalization rule wants.

`GrantedArmorClass` lives on `CreatureState` beside `bonuses` and carries the
casting in its `source`, so `releaseCasting` and `releaseOnTarget` end it with
the spell through machinery that already existed — a dispel, a broken
Concentration, the eight hours running out, the caster leaving, all one door.

Three details that are the SRD rather than the shape:

- **Dexterity is in the formula, not in the field.** Every base Armour Class
  calculation the book writes includes it, so `plusAbility` is the *second*
  ability — `null` for Mage Armor, `con` for a Barbarian. Naming it `ability`
  reads as though Mage Armor should name Dexterity, and adds it twice; it did,
  for one commit.
- **"while not wearing armour" needs no field.** The comparison lives in the
  unarmoured branch, so a grant is simply inert while armour is worn.
- **"a willing creature who isn't wearing armor" is a targeting clause**, so it
  is `TargetRule.mustBeUnarmored`, beside `mustBeType` where the target rules
  are, and refuses the casting rather than spending a slot on a creature the
  spell cannot touch.

`unmodelled` carries the half that is missing: **the spell does not end when
the target dons armour.** The Armour Class is right either way; what goes on
running is the casting, which is observable through `ongoing` and Dispel Magic.

Barkskin is deliberately *not* included: "an Armor Class of 17 if its AC is
lower than that" is a floor on the **total**, a different rule, and one spell is
not evidence for building it.

### A spell may declare the footprint its template wants

`SpellDefinition.anchoring` is the geometry pass's one bit of information, in
data. Precedence is **request, then definition, then `space`**, resolved by one
function so the geometry and the ongoing record cannot disagree; the caster
keeps the last word, because `CastSpellRequest.anchoring` exists precisely so a
caster who wants the other convention can ask for it. Absent on both, nothing
changes — `space` is still normalised away when the record is built.

**No SRD spell declares one, and that is a decision rather than a gap.** SRD
5.2.1 mandates no convention: its "Playing on a Grid" sidebar covers squares,
Speed, entering a square, corners and ranges and says nothing whatever about
areas of effect, and the intersection convention comes from a 2014 optional
rule. Declaring one per spell would be the engine choosing a rule the book
declined to give, and doing it inside a definitions pass would change thirteen
spells' footprints behind a migration. A test pins that nothing declares one,
so it cannot change silently.

The evidence a deliberate geometry pass would want is recorded in
`docs/architecture/spell-definitions-as-validated-data-2026-09-13.md` rather
than acted on: under a space origin every printed dimension comes out one space
wide, because the origin's own space is counted on both sides — a 20-foot Cube
covers 25 feet, a 20-foot-radius Sphere 45 — while a 5-foot-wide Line is
already right, which is what the geometry note predicted. Every point-origin
template in the catalogue is an even-space footprint; every `self`-origin one
cannot take an intersection at all, because the origin is a creature's space.

### What this deliberately did not build

**Definitions do not live in `GameState`.** Making `definitionFor` read authored
definitions out of state is what would let a homebrew spell actually be *cast*,
and it is twelve call sites, two helpers inside the fold (`areaDefinitionOf`,
`creaturesInCastingArea`), one event, one state field and one validating
command. Its only user is authorship. One user is not evidence, so it is a seam
with a name and a cost rather than a mechanism — and the consequence is stated
plainly: **a non-SRD definition can be validated today and cannot be cast
today.**

**Outcome-scoped child effects are deferred**, and not because they are large.
The rider fields are not free child effects: `plus` shares one saving throw
*and* one damage application, `condition` shares the same save, and `delayed`
is a debt rather than an effect. A naive `onFail: SpellEffect[]` would let an
author nest a saving throw inside a failed saving throw, which is the
definition becoming a miniature untyped program. The branch lists need their
own restricted child vocabulary, and the evidence for which members it needs is
what the next two families produce — a condition with no saving throw, and a
standing Advantage a spell grants. The validator makes that migration safer
when it comes, because the invariants that must survive it are now in one place
instead of inferred from four test files.

**`SpellEffect.damageType` stays `string`.** Narrowing it to `DamageType`
ripples through `damageTypeStated`, `applyDamage`'s keys and the monster
adapter, which is a typing pass rather than a definitions pass. The validator
checks the value instead, at the same place a homebrew definition would get it
wrong.

## Spells The Engine Executes

`@ie/srd` parses every spell's id, level, school, class list and prose. None of
that says what a spell *does* — the description is English. So a spell the
engine resolves needs a definition in `spell-definitions.ts`, written from the
SRD text and checked against it.

Four shapes, six spells. The **structures** are the reusable part and the
spells are the proof they fit something real:

| Shape | Spells | What the shape has to get right |
|---|---|---|
| Attack, scaling damage | Fire Bolt | cantrip upgrade by caster level, crits double the dice |
| Save, condition, repeating escape | Hold Person | turn-boundary hook, per-target cleanup |
| Save, damage, stated success | Sacred Flame, Inflict Wounds | **none** vs **half** on a success are different spells |
| Healing, plus the caster's modifier | Cure Wounds, Healing Word | the cap at maximum, 0 hit points, Bonus Action |

A spell that fits one of these is data. A spell that does not is a new shape,
and a new shape is a milestone rather than a definition.

**There are three ways a spell finds its targets, not two**, and the third is
the one that gets collapsed into the other two:

| | SRD wording | Field |
|---|---|---|
| The caller names them | "a Humanoid that you can see" | `targets` |
| The geometry picks them | "each creature in a 20-foot-radius Sphere" | `area` |
| The caller names them, from inside an area | "choose up to six creatures in a 30-foot-radius Sphere" | `targetsWithin` |

Mass Cure Wounds is the third and neither of the others: an `area` would heal
every enemy standing in the Sphere, and a plain target list would let the
caster heal anyone in range and ignore the Sphere. **The range then belongs to
the point rather than to each target** — the SRD reaches 60 feet to place a
30-foot Sphere, so a creature 85 feet away is a legal target and measuring it
from the caster would wrongly refuse it. Weird is both halves at once.

**"Each creature of your choice" names no number at all**, so `targets.count`
has nothing honest to hold and `unlimited` says so rather than picking a
generous one. It is not unchecked: range and sight bound it, and both are
already checked against every name the caller gives.

**Damage and healing scale by the same arithmetic**, so `DiceScaling` is named
for dice rather than for damage: Cure Wounds reads "increases by 2d8 for each
spell slot level above 1" in exactly the sentence shape a damage spell uses.
The per-slot entry is a whole notation, not a count, because the upcast die is
not always the base die *count* — Inflict Wounds is **2**d10 and grows by
**1**d10, and reading the increase off the base would double it.

**What a success buys is stated, never defaulted.** Inflict Wounds gives "half
as much damage on a successful one"; Sacred Flame gives nothing at all, because
its text says "or take", not "half as much". Defaulting either way silently
rewrites one of the two spells. A success against a `none` spell rolls no
damage dice at all — the spell did nothing, and rolling would move the
generator for no reason.

**Half comes off the spell's damage, before the target's defences.** SRD:
"The halved damage is equal to half the damage that would be dealt on a failed
save." So the order is: roll, halve for the save, then adjustments, Resistance
and Vulnerability. It matters: 5 necrotic against a vulnerable creature that
saved is 2 then doubled to 4, where doubling first would give 5.

**Healing is not negative damage**, and the differences are all in the rules
rather than the arithmetic. It is capped at the hit point maximum, it lifts
exactly the unconsciousness that having no hit points caused and no other, it
adds the *chosen route's* spellcasting modifier rather than the class's, and
hit points alone will not raise the dead — `healCreature` refuses a corpse, and
the refusal costs no slot.

**A creature's defences are state, and damage reads them.** `adaptMonster` has
always produced Resistance, Vulnerability and Immunity from a stat block, and
until this milestone they went nowhere — `applyDamage` was called with an empty
table, so a fire-immune creature burned like anything else, silently. They now
live on `CreatureState` and every spell's damage goes through them. Only
*unconditional* entries: a qualified one ("except from its vampire master")
stays out, because no boolean captures it and treating it as absolute is the
documented wrong answer.

**Spell damage settles the Concentration it puts at risk.** Every damaging
effect goes through `resolveDamage` rather than `damageCreature`, so a target
concentrating on something rolls its Constitution save in the same operation
that hurt it. The attack path did not, before: Fire Bolt could drop a caster's
Hex to 0 hit points' worth of damage and leave the spell running.

**Spellcasting can be declared.** A character's comes from their choices, which
is why `character-created` carries it. An NPC Cleric has no class table to
derive from, so `spellcasting-declared` states it — the same rule as a stat
block's printed Armour Class: declared wins, and the engine does not
reverse-engineer a class that happens to add up.

**Everything mechanical is derived, not supplied.** `resolveSpell` takes a
caster, a spell id, some targets and a slot. It derives the attack modifier and
save DC from the caster's sheet, the damage dice from the definition's scaling
and either the caster's level (a cantrip) or the slot (a levelled spell), the
target count from the slot, and the condition, duration and end-of-turn repeat
save from the definition. A caller names a spell; it does not get to say what
the spell does.

That is the whole reason this exists. Fire Bolt spent a commit being thrown for
2d10 by a level 3 Wizard because the number lived in a test fixture, where
nothing in the engine could check it.

**Cantrips scale by caster level and levelled spells by slot**, and they are
separate fields rather than one overloaded number, because conflating them is
exactly the mistake that was made.

### Once Per Turn Is A Turn, Not A Round

Four SRD class features add damage to a hit and cap it at once a turn — Sneak
Attack, Colossus Slayer, Divine Strike, Primal Strike. The **allowance** is the
shape; the **qualifications** are not, and keeping them apart is the whole
design. Sneak Attack wants Advantage or a flanking ally and a Finesse or Ranged
weapon; Colossus Slayer wants a weapon and a target already wounded. Those are
declared fields on the grant, each transcribed from its own sentence, exactly
as `usingAbility` (Rage Damage) and `meleeOnly` (Radiant Strikes) already were.
Folding them into one predicate language would be a trigger framework nothing
asked for.

**The allowance records a turn number, never a flag.** SRD says *a* turn, and
the distinction is only visible on somebody else's: a Rogue who Sneak Attacked
on their own turn may Sneak Attack again on the Opportunity Attack they take
during the Fighter's. A flag would be cleared by the budget refresh at the start
of the Rogue's *own* turn — the one moment that does not matter — and would go
on blocking every Reaction until then. So `featureUsedOnTurn` sits on the turn
budget beside `spellSlotSpentOnTurn` and is compared against `turnsTaken`,
which is global and never reused. Outside combat there are no turns and nothing
restricts it, the same reading the one-slot-per-turn rule takes.

**A failed qualification must not eat the allowance.** The spend is computed
after every qualification has had its say, so a Rogue who swings a Mace still
has their Sneak Attack for the dagger later in the turn.

**Declared allegiance reaches a class feature.** Sneak Attack's second branch
needs "at least one of your allies within 5 feet of the target", and `side` is
null until somebody says so. A table not tracking sides gets no ally — the
benefit is withheld rather than invented — and the attack says so in
`unverified`. Same three-valued discipline as cover and sight.

**A held attack remembers how its roll came out.** `PendingAttack.mode` joins
`total` and `natural`, because SRD Sneak Attack asks about *the roll* and
`resolveAttackDamage` settles the damage in a second call that would otherwise
guess.

**A second attack on one turn is `free: true`.** A Rogue's Attack action holds
one attack, so the only honest way to swing twice on a turn is an attack whose
cost is paid elsewhere — which is exactly what `takeOpportunityAttack` passes.

**A rider whose damage type is chosen at the hit is chosen, or declined.**
Divine Strike is "Necrotic or Radiant (your choice)" and Primal Strike "Cold,
Fire, Lightning, or Thunder (choose when you hit)" — per hit, so it cannot live
on the sheet. `featureDamageTypes` on the attack command names it by feature
id, an illegal type is refused before the action is spent, and **naming none is
how the SRD's "you can" is declined**. That is one act, not two: a separate
opt-out field would answer a question the choice already answers.

**A chosen type is extra damage, not a bonus.** Radiant from Divine Strike
meets the target's Radiant defences; a mace's Bludgeoning does not. A test that
proves this needs a target that *has* damage defences — against an
undefended dummy the two are indistinguishable, which is how a mutation
discarding the chosen type passed a whole file of tests.

**An "Improved X" that only raises a number is the step in the first feature's
table, not a second grant.** Two grants would stack and deal both.

### A Feature Is Data Once Its Shape Exists — And So Is Its Dishonesty

Four more feature shapes landed after the once-per-turn rider, and the last two
are worth reading together because one found the other.

**Evasion is named for the SRD rule, not for either class.** The Rogue and the
Monk have the same feature under the same name, word for word, so the grant is
`{ kind: 'evasion' }` — the move `{ kind: 'expertise' }` already made. What
differs is one clause the Monk has and the Rogue does not ("You can't use this
feature if you have the Incapacitated condition"), and that is an ordinary
`StandingRequirement` on the feature whose text says it. It bites only where
the effect already offers half on a success, and it is read off the **target**,
because the Rogue standing in the Fireball is the one who evades it.

**A Critical Hit carries its own auto-hit.** SRD's glossary binds them in one
sentence — "you score a Critical Hit, **and the attack hits** regardless of any
modifiers or the target's AC" — so a Champion's 19 hits an Armour Class it
could not otherwise reach. The natural 1 is the opposite case and stays pinned
to the number, because the SRD sets it by naming the face rather than by a rule
a feature could restate. The threshold lives on the sheet, not in `standing.ts`:
there is no state of the world in which a Champion's 19 stops being a critical.

**Advantage a feature grants still cancels.** Feral Instinct and Remarkable
Athlete grant Advantage on Initiative, and a Barbarian with Disadvantage from
somewhere else rolls *one* die with both sources in `modeSources`. Deduplicated
by source, so a caller who also knows about the feature does not apply it twice.

**Nine features were counted as executed on the strength of a note.** Bardic
Inspiration, both Channel Divinities, Wild Shape, Second Wind, Action Surge,
Monk's Focus, Lay On Hands and Sorcery Points all said "declared as a pool" and
none was. A Bard had a Hit Die, three slot pools and nowhere to spend an
inspiration from.

**That is the one failure the coverage table cannot see**: a feature declares
its own automation, which is what makes the column read rather than guessed —
and nothing checked the declaration. The guard now lives in
`class-pools.test.ts`: *a note that claims a pool must be a feature that
declares one.* A note is prose and cannot be parsed for meaning; what it can be
checked for is that if it says the word, the feature has the thing. Worth more
than the nine fixes it forced.

**The SRD sizes a pool three ways**, and each is in `poolSizeOf` because a
feature uses it: a column of the class table, an ability modifier with a floor
("equal to your Charisma modifier (minimum of once)"), and a multiple of the
class level ("five times your Paladin level"). Each read at *that class's* own
level, so a multiclassed Bard's inspiration does not grow with their Fighter
levels.

**`recovers` stays honest about what it cannot say.** Monk's Focus and Action
Surge come back **whole** on a Short Rest and are tagged `short-rest`. Five
others give back *one* — "You regain one expended use when you finish a Short
Rest, and you regain all expended uses when you finish a Long Rest" — which is
`regainsOnShortRest`, and it arrived only once declaring the other pools turned
Rage's documented quirk into five features saying the same sentence. **The
evidence arrived before the abstraction**, which is the order the generalization
rule asks for.

**A guard nothing can reach is not a rule — and a pure function will take a
fixture that reaches it.** `restoreOn`'s `short-rest` check is unreachable
through any class, because every feature with a partial rule is also tagged
`long-rest` and takes the whole-refill branch first; the mutation that removed
it passed everything. But `restoreOn` is pure over a pool, so a pool that
recovers at *dawn* and gives one back on a Short Rest can simply be built. That
is the difference between this and `placeArea`'s dead `no_scene`, which stayed
dead because nothing could construct its case.

### What A Pool Buys, Which Was The Half Nobody Had Built

Every pool in the class tables was declared, sized correctly and refilled on
the right rest — and almost none of them could be *spent*. A Fighter had two
uses of Second Wind and no way to gain a hit point from either; a Paladin
carried five hit points per level and could not give one away; a Sorcerer's
Sorcery Points came back only at dawn. Four features' worth of arithmetic sat
in `restore()` and `healCreature`, both correct, both reached by nothing.
That is the same failure as `rollAttack` and `rollAbilityCheck` before them,
and it now has a name in this file for the eighth and ninth time: **a pure
function nothing calls is a rule nothing enforces.**

Three shapes, and what separates them is what the spending buys:

| Shape | Features | Spends | Buys |
|---|---|---|---|
| A recovery | Sorcerous Restoration, Magical Cunning, Uncanny Metabolism | one use of a pool of its own | uses of a *different* pool, capped |
| A self-heal | Second Wind, Wholeness of Body | one use | a die plus something, for the holder |
| A healing touch | Lay On Hands, Restoring Touch | hit points, one for one | hit points, and conditions at five apiece |

**"Once you use this feature, you can't do so again until you finish a Long
Rest" is a pool of one.** It is exactly what a pool already says, so it is one
rather than a second kind of limit sitting beside them.

**A cap is derived at the moment of use, never stored.** A pool's maximum can
move; a number written on the sheet at creation would go on being the old one.
The same rule `standing.ts` follows for every conditional benefit.

**"Half your *Sorcerer* level" is that class's level.** Only a multiclassed
character whose *starting* class is the other one can tell the two numbers
apart — a mutation returning the character level passed every single-class
fixture in the file.

**A moment is a fact, not a mechanism**, and the engine records the ones it
can see. `lastShortRestAt` joins `lastDamage` — the fact Hellish Rebuke's "in
response to" needed — and holds the benefit the rest *earned*, so an
interrupted Long Rest that collapsed into a Short one counts, which is what
the SRD says it is. The window is the Reaction window: the clock has not moved
since.

Two moments the engine does **not** hold, stated rather than quietly skipped:

- **Magical Cunning's "esoteric rite for 1 minute" is the table's.** No state
  distinguishes a minute of ritual from a minute of walking, and performing a
  rite is not arithmetic — the same side of the line a disguise is on.
- **"When you roll Initiative" is the first turn of the fight.** That is the
  closest the engine holds, and it is the same window for everyone in the
  order rather than one that depends on where in it the holder sits. *A turn,
  not a round*: with one combatant the two are indistinguishable, which is how
  a mutation reading it as "the first round" passed a whole file.

**"Those points don't also restore Hit Points to the creature"** is why Lay On
Hands keeps the cost and the healing as two numbers. Five points buy the
lifting and heal nothing, so a Paladin who draws 3 and lifts Poisoned spends 8
and the creature gains 3. And the SRD removes *the condition*, not a cause of
it, so an ally poisoned twice over is not half-cured.

**A touch is five feet, and the number that proves it is ten.** A test at
twenty cannot tell a touch from a Reach weapon.

**An event that always happens is where a stamp has to ride.** A healing touch
that only lifts a condition heals nothing and rolls nothing, so `resource-spent`
carries the command stamp — the lesson an effect check against an illusion
already taught, in its third instance. TypeScript did not catch the missing
field, because excess-property checking on a union accepts a property that any
member of it declares.

**Half a feature is not executed.** Persistent Rage says the same sentence as
Uncanny Metabolism and is still `manual`, because its other half — a feature
changing *another* feature's activation — has one user, and an abstraction
with one user is a guess dressed up as a structure. Its note says which half
and why, which is the only honest place for that to live.

### A Check A Spell Offers Against What It Is Still Doing

SRD writes this twenty times — see through the illusion, tear free of the
tentacles, disbelieve the terrain — and every one of them sat in an `unmodelled`
note until `resolveEffectCheck`. That was wrong twice over: the check is pure
arithmetic the engine owns, and `checks.ts` had been complete, correct and
reachable from **no command at all** since the day it was written.

**It is not the repeat save it resembles**, and collapsing the two would have
been the mistake:

| | Repeat save | Effect check |
|---|---|---|
| Who decides it happens | the turn boundary | the table |
| If nobody does it | the turn refuses to advance | nothing; it was never owed |
| Where the debt lives | `pendingSaves` | there is none |
| What it costs | nothing | the Action, in combat |

A repeat save is an **obligation**; this is an **opportunity**. Nobody is
obliged to look at an illusion, so nothing raises it and no turn blocks on it —
which is exactly why it needed no pending-debt machinery.

**The timer is the durable handle, and it already existed.** A check needs its
DC an hour after the casting, by which time the caster may have levelled,
changed which grant supplies the spell, or died — so the DC is written down when
the effect is created, exactly as `RepeatSave.dc` already is. `EffectCheck` sits
beside it on `TimedEffect`: an illusion hangs on the **casting's** timer, a
Restrained creature's escape on the **condition's**. No registry, no new state
container, and `effectKey` is the handle `pendingSaves` has always used.

**Who may attempt it is derived from what the timer sits on** — an effect on a
creature is that creature's to shake off, a casting with no victim is anybody's
to see through. `onSuccess` carries `'none'` and `'end-on-target'` and
deliberately not `end-casting`: the SRD writes it (Maze, Phantasmal Force,
Detect Thoughts) and every one of those spells is blocked on something else, so
it would be a value nothing could be written with.

**`'none'` is a real answer, not a stub.** An illusion seen through changes
nothing the engine holds; the knowledge is the table's and the *number* was the
engine's. So that branch emits `roll-recorded` and no settling event at all —
which makes it the shape the idempotency sweep most needed to cover, because a
guard whose event never happens is a guard that never fires.

**The check costs the Action and no definition says so.** Every SRD instance
spends one — "can take an action to make a Strength (Athletics) check", "must
take the Study action" — so it belongs to the mechanism, not to any spell.

**Which senses an attempt leans on is the caller's to state.** Blinded
"automatically fails an ability check that requires sight", and Minor Illusion
is why that cannot live on the definition: it creates "a sound **or** an image".
`senses` is a fact about the attempt, like a situational Advantage, and nothing
the caller passes reaches the comparison — there is no field for a result, a DC
or a modifier, and `effect-checks.test.ts` asserts that with `@ts-expect-error`
rather than a comment.

**An unknown creature is a request; an unknown effect key is a refusal.** The
engine wrote every timer it holds, so its own ledger is complete knowledge and
a miss there is genuinely no — there is no fact out in the fiction that would
make a missing timer exist. A creature nobody has mentioned is the opposite: a
thin record with a provider that fixes it.

**Dispel Magic is blocked on a fact the engine already emitted and did not
keep.** SRD 2024 needs "DC 10 plus **that spell's level**", and `GameState`
holds no record of an ongoing casting beyond a counter, a concentrating
caster's `{castingId, spell, level}`, and condition sources carrying a name and
an id. Nothing holds the level of a casting whose caster is not concentrating,
and nothing enumerates the spells running on a creature. Taking the level from
the caller was refused rather than built: the engine *emitted* that casting, so
asking a model for its level is asking fiction to supply established truth.

**A tracked spell may execute part of itself.** Tracked means the engine spends
the cost and the effect is the table's — it has never meant the engine does
nothing mechanical. Disguise Self is tracked because a disguise is not
arithmetic, and the Investigation check that sees through it is, and is rolled.
`spell-tracking.test.ts`'s adjudication map gained a third value, `'engine'`,
for exactly this, and asserts it in **both** directions: a definition carrying a
check must claim `engine`, and a spell claiming `engine` must carry one. That
second half exists because a mutation proved the first was not enough — a
written reason is only as honest as its author, but *this* claim is checkable.

### Tracked Is A Claim About The Cost, Not A Half-Finished Execution

Forty-four spells have a definition with `effects: []`. The engine casts every
one of them for real — the action or Bonus Action, the slot, the Concentration
it takes and the one it breaks, the deadline on the clock, the range and the
target count, the command id that makes a retry a no-op — and what the spell
*does* is the DM's. Disguise Self will never be executed, because what a caster
looks like is not arithmetic. Refusing the cast outright, which is what the
engine did before this existed, meant the slot was never spent: a worse answer
than either.

**`unmodelled` means one thing and must never come to mean the other:**

| | |
|---|---|
| ✅ | this part of the spell belongs to the fiction, and the engine should never decide it |
| ❌ | the engine ought to enforce this and nobody has built it yet |

Those two read identically at the table and only one of them is honest, so the
line is drawn by a test rather than by review. `spell-tracking.test.ts` reads
each tracked spell's **own SRD prose** out of the parsed book and scans it for
thirteen clauses the engine demonstrably owns — dice, a saving throw, an
ability check, an Armour Class, Hit Points, a Resistance or Immunity, a
condition, Advantage or Disadvantage, a Speed, a percentage chance, a cost in
feet of movement, a teleport, extra damage. A hit demands a written
adjudication, and one that is not `'table'` must name an enumerated missing
shape. Adding Barkskin to the tracked list therefore means writing `armor-class`
against a shape id, which is a visible act in a reviewed list rather than a
sentence in a spell nobody rereads.

It is a **floor, not a proof**: it reads English, so a rule phrased in none of
those words slips past — Gate and Etherealness move creatures between planes
and trip nothing. It fires on forty of the forty-five utility spells the audit
rejected, which is what it is for. Nothing can catch a *false* adjudication
either; the guard forces the sentence to exist and be specific, and review does
the rest.

**Which side a clause falls on is decided by the engine's own reach.** It is
the table's when the engine's resolution path never arrives at it — the
Disadvantage on a Perception check a DM calls for, the Prone on a creature
inside an unmodelled demiplane, the damage when a DM rules the stone collapsed.
It is debt when the path *does* arrive and would silently answer wrongly: Blur,
because `resolveAttack` rolls every attack; Mage Armor and Barkskin, because
the engine derives an Armour Class on each one; Death Ward, because the engine
drops creatures to 0 itself.

**No command teleports.** `moveCreature` charges a movement budget and
`placeCreature` refuses a creature that already has a position, so a spell that
relocates somebody has nothing authoritative to call — Misty Step's 30 feet,
unoccupied space and line of sight all go unchecked. This was misfiled for a
long time as "a separate placement the caller makes", which reads as a division
of labour and is a hole. A destination *outside* the scene is different in kind
and is genuinely the DM's: there is one scene, so Plane Shift and Word of
Recall have no position to move anybody to.

**"Until dispelled" is the absence of a duration, not a large one.** Arcane
Lock and Continual Flame carry no `durationSeconds` and schedule no timer.
Inventing a big number of seconds would be the engine answering a question the
SRD declined to ask.

**A tracked spell's numbers are as easy to get wrong as an executed one's, and
less is watching.** `coverage.test.ts` checks name, level, school, casting time
and Concentration against the parsed book; the *duration* has no automatic
check, so every one is quoted from the SRD in its docstring and at least one is
driven past its deadline by a test.

### What a cast refuses, and what it admits it cannot check

Refused: a spell with no executable definition, a spell the caster has not
prepared and knows from nothing else, no targets, a duplicate target, a
stranger, more targets than the slot allows, a target out of range, a target
behind Total Cover, no action left, no slot left, no free casting left, and
casting at all while a turn-boundary save is outstanding.

Reported rather than refused, in `unverified`:

- **The creature type a spell demands.** Hold Person wants a Humanoid.
  `CreatureState` carries a sheet, not a creature type, so there is nothing to
  compare against. A silent pass would be the engine claiming to have checked
  something it cannot see.
- **Range, when a target has no position**, or when no scene is set. "Refuse,
  don't guess" governs numbers with a right answer; where a creature is
  standing has none until somebody places it, and an unplaced creature is an
  engine-to-model signal rather than an error.

### What these effect types still do not cover

- **No wall or multi-area spells.** All six SRD shapes are castable, but a
  spell whose area is *several* of them — Meteor Swarm's four Spheres, Fire
  Storm's ten Cubes — or a wall with a length, a height and a thickness, has
  no way to say so. One area per spell.
- **Cover does not reach a saving throw.** Declared cover adjusts Armour Class
  and nothing else, so Sacred Flame's "no benefit from Half Cover or
  Three-Quarters Cover" describes an exception to a rule the engine does not
  have yet. Nothing records the exception, because a field for it would be
  read by nothing.
- **No Temporary Hit Points from a spell**, so False Life and Aid have no
  shape. `grantTemporaryHpTo` exists; no effect type reaches it.
- **Healing restores hit points only.** Lesser Restoration ends a condition,
  Revivify raises the dead, Aid raises the maximum — three more shapes, none of
  them here.
- **A second hit at a later moment now works; damage over time still does
  not.** SRD Acid Arrow's "2d4 Acid damage at the end of its next turn" is a
  `delayed` rider on the attack or the save that caused it, and Vitriolic
  Sphere is the same sentence off a failed save. What that does *not* buy is an
  effect that keeps dealing damage every round — one hit, one moment, and the
  debt is discharged.

  Three details the shape had to get right, each from the book rather than from
  the shape being tidy:

  - **The later damage carries its own scaling.** Acid Arrow: "The damage
    (both initial and later) increases by 1d4 for each spell slot level above
    2." Vitriolic Sphere: "The **initial** damage increases by 2d4" — its 5d4
    never grows. One shared field would have silently made one of the two
    spells wrong, and it is the sort of wrong nothing else could catch.
  - **A miss or a successful save owes nothing later.** Both spells end the
    sentence with "only".
  - **The debt is the target's, not the casting's.** Both spells are
    Instantaneous and neither takes Concentration, so the caster dying changes
    nothing — the acid is already on them.

  **A debt is not a deadline, and reads the same moment the other way.**
  `hasExpired` says **yes** for an anchor who has left the fight, deliberately,
  so nothing runs forever; `isDue` says **no** for the same deadline, because a
  moment that will never arrive means the damage is forgiven rather than
  collected. Reading one as the other fires Acid Arrow's second hit at the
  instant the last enemy drops. Two functions over one `Deadline` type, and a
  test pins the difference.
- **A spell has one effect list applied to every target**, so nothing yet
  expresses "each creature takes damage *and* is knocked Prone" with different
  outcomes per target beyond the save each one rolls.

**A pending turn-boundary save blocks casting**, not just turn advancement.
Somebody may or may not still be Paralyzed; acting into a state nobody has
settled would resolve against the wrong world.

### Feat grants reach usable state

Magic Initiate's selections are not a note on a sheet. The chosen cantrips and
level 1 spell land in `spellcasting.granted`, each carrying the feat's own
spellcasting ability — which matters the moment a Sage Fighter takes it — and
the level 1 spell's free daily casting is a long-rest pool the engine spends
before it reaches for a slot. `routeFor` says which source supplies a spell,
preferring the class's own, so a Wizard who has Fire Bolt twice casts it as a
Wizard.

Alert's Initiative Proficiency comes back from creation as a named
`initiativeBonuses` entry, which `rollInitiative` takes like any other bonus.
Its Initiative *swap* is not modelled.

### Who resolves the target, and in which order

**Maestro resolves the player's intended target before the engine checks
anything.** The order is not negotiable and it is one direction only:

1. The player says "I cast Hold Person on him."
2. Maestro reads the fiction and decides who "him" is. `eligibleTargets` is
   there to help — it hands over the shortlist, with a reason attached to
   everyone left off it, so the obvious target has something to be obvious
   about.
3. Maestro calls the engine with an **id**.
4. The engine checks that id, and only that id.

Step 4 never reaches back into step 2. **`eligibleTargets` is a shortlist, not
a substitution mechanism**, and no part of the engine may quietly aim a spell at
somebody other than the creature it was handed — however obviously better a
candidate is standing next to them. A player who said "the goblin" and hit the
thug has been lied to about what happened, and a log that records the thug is a
log that cannot explain the fight.

So an ineligible target is a refusal naming *that* target, with nothing spent,
even when exactly one legal target exists and the substitution would be
unambiguous. One bad target in a multi-target casting spoils the casting rather
than being silently dropped.

**Ask the player only when the intent is genuinely ambiguous**, and that is
Maestro's call, made before the engine is involved. A missing *fact* is never
that: it is an internal request (below), not a question for the table.

### A missing fact is a request, not a refusal

The engine takes ids and checks mechanics. Working out who a pronoun refers to
is interpretation, and belongs to the layer that reads the fiction.

What the engine owes that layer is a straight answer about what it cannot see.
There are three states, not two:

| | |
|---|---|
| The rules say no | an ordinary `err` — wrong creature type, out of range, behind Total Cover, declared unseen |
| The record is thin | `{ kind: 'needs-context', requests }` — nothing spent, no die thrown, go and find out |
| Fine | `{ kind: 'resolved', ... }` |

A `ContextRequest` says what is missing, which rule wanted it, and the event
that would establish it. It is addressed to the orchestrator, never to a
player: "sorry, that creature has no position" is the engine's problem leaking
out as the game's. The caller establishes the fact and casts again exactly as
they meant to — which is why asking costs nothing.

**Completing the record adds a fact; it never restates the world.** Declaring a
creature's type leaves its position, its sight lines, its hit points and
everything else exactly where they were, and declaring the same fact twice
changes nothing. Several missing facts are answered one at a time, each
answer standing while the rest are still outstanding. Anything else would mean
the second attempt resolved against a different game than the first asked
about.

**Unknown is not no.** Sight is declared, like cover, and deliberately
three-valued: seen, unseen, and *nobody has said*. Hold Person targets "a
Humanoid that you can see", so an undeclared line of sight is a fact to go and
get; a declared **unseen** is a refusal. Conflating the two would either invent
a rule or hide a gap, and both are worse than asking.

**Creature type is authoritative now.** It was previously reported as an
unverified check, which was honest but useless — nothing could act on it. A
character takes its type from its species; a stat block prints one; a creature
nobody has typed produces a request rather than a silent pass.

**A request names the command that satisfies it, and every command-level
request has one.** `declareCreatureType` is the provider for the type
request, and it is the durable-fact case: declaring the same type again emits
nothing, declaring a *different* one is refused with `type_established`, and
a log that contradicts itself is corrupt. Sight and cover are momentary facts
and re-declare freely. `ContextRequest.kind` is the field a tool surface
branches on — `creature`, `position`, `visibility`, `creature-type`, `scene`,
`route` — and `invariants.test.ts` asserts that no command returns
`needs-context` without saying which. Pure helpers beneath the commands return
the bare kind; the command that knows which rule wanted the fact attaches the
request. `route` is the one satisfied by re-sending the same command with a
field filled in rather than by declaring a fact through a command of its own —
see "`via` is adjudicated, and asking for it is not a refusal".

### Alert rides on the roll by itself

`rollInitiativeFor` reads the creature's own `initiativeBonuses`, which creation
worked out, and merges them with whatever the caller adds — deduplicated by
source, so it lands exactly once even if a helpful caller passes it too. A
feat that has to be remembered is a feat a character silently stops having.

Flat bonuses fold into the die's own modifier by design, so the guarantee is
arithmetic: +2 over the baseline, never +4.

### Which grant pays, and with what

A spell can arrive twice — the class list and a feat — and the two are not
interchangeable, because a feat brings its own spellcasting ability and
therefore its own save DC. So a casting may name its `source`, and the DC and
attack modifier come from *that* route.

**Default:** the class's own route where it supplies the spell; the single
grant where only a feat does. Naming a source that does not supply the spell is
refused rather than quietly falling back.

**Payment is never chosen for you.** A grant's single free daily casting is a
resource a player may well be saving, and spending it because no slot level
happened to be named is the sort of quiet decision that loses a fight two rooms
later. Where both a free casting and a slot would serve, the engine returns
`payment_required` and the caller says which. A cantrip costs nothing either
way, and a spell with one route asks nobody anything.

## Owning Is Not Wearing

Equipment is two separate facts about a creature, and collapsing them is the
bug this design exists to prevent: **chain mail in a backpack protects nobody.**
`inventory` is what is owned, `equipped` is the subset worn or wielded, and
Armour Class reads only the second. Equipping is an event, so the log shows the
moment the shirt went on.

**`equipped` is the fact; `sheet.armor` is a view of it.** The reducer derives
both armour fields from the whole equipped list after every equipment event
rather than patching one slot at a time, because patching is only correct while
events arrive in order and nothing else replaces the sheet — and
`character-advanced` replaces the sheet wholesale. One derivation, used
everywhere, is what keeps the two from drifting; a test walks the whole log
prefix by prefix asserting they agree at every step.

**One suit, one Shield, at creation as well as in play.** `equipItem` refuses a
second of either, and `checkEquipped` now refuses the same thing at creation.
Without that, a character could be born wearing two suits and the sheet would
have to pick one.

**Ids, not names.** `catalogue.ts` is one lookup over the SRD's four separate
equipment tables — gear, tools, weapons, armour — keyed by the slug the parsers
assign. A display name is not an identifier: the gear table alphabetises by
inverting them, so it prints `Lantern, Hooded` where a person says "hooded
lantern", and matching on display text is how a starting package silently stops
containing a lantern.

**A pack is its contents.** The SRD prices a pack as a bundle and lists what is
in it in prose, so `parsePackContents` resolves that sentence back to the rows
it names — through the plurals ("10 flasks of Oil") and the inversions
("Hooded Lantern" → `lantern-hooded`) — and an unresolved phrase is a parser
*problem*, never a silently dropped item. A Scholar's Pack is nine things.
Owning the label is owning nothing.

**Money is copper.** Every SRD coin divides into it, and a Blanket at 5 SP has
no representation in gold-only arithmetic. Prices the SRD prints as "Varies"
stay `null` and a purchase of one is refused with `no_price` — the book
declined to say, and inventing a number is worse than asking.

**One of A or B, never both.** A starting package is the items *or* the gold.
Each package contributes exactly one of its halves, and both halves come from
the same chosen option, so no route grants a package and the money instead of
it. Levelling up grants neither again: `advanceCharacter` emits differences,
and equipment is not one of them.

**A purchase is atomic.** The items and the coin move in one batch, so there is
no state in which a character has paid and not received. Refusals — unknown
item, no price, cannot afford, a quantity that is not a count — cost nothing,
which is the same "validate before rolling" discipline applied to a purse.

**Advancement recalculates the sheet and keeps the equipment.** The new level
derives everything a level changes — hit points, proficiency, slots — and knows
nothing about what is worn, so the reducer takes the *new* sheet and puts the
armour back from `equipped`. Gaining a level does not take your armour off, and
it does not put back what you took off either.

**What is worn is state, not a creation choice.** `choices.equipped` records a
decision made at level 1; the chain shirt bought in play was never part of it,
and the one taken off in play is still named by it. So `advanceCharacter` plans
against the creature's *live* inventory and equipped set, and writes those into
the record it stores. Before that, a GM note for level 4 that did not re-list
last season's chain shirt made the plan's inventory forget it, and advancement
was refused with `not_owned` for a character wearing armour they owned. That is
the shape of the bug this split prevents: a snapshot standing in for state.

### What equipment does not model yet

- **Nothing weighs anything.** Weight is in the catalogue; carrying capacity,
  encumbrance and the Strength score that governs them are not.
- **No containers.** Items are a flat list per creature. A pack's contents are
  granted, not held *inside* it, so nothing is lost by putting the pack down.
- **No magic items and no attunement.** `dmGrants.magicItems` records names
  only; none of them is in the catalogue and none has an effect.
- **Ammunition is owned, not spent.** Arrows are a line in the inventory; no
  attack consumes one, and none is recovered after a fight.
- **"Varies" rows cannot be bought.** Arcane Focus, Component Pouch and the
  other open-priced rows can be granted by a package or a GM, but not
  purchased, because the SRD prints no single price.
- **A package's `detail` is documentation.** The SRD's "Arcane Focus
  (Quarterstaff)" grants a quarterstaff and notes what it is for; the note
  stays on the package definition and does not reach the inventory, because the
  engine does not model what a focus is.
- **The Spellbook is class text, not a gear row.** SRD 5.2.1's equipment tables
  have no Spellbook; the Wizard's feature describes it. `CLASS_ITEMS` in
  `catalogue.ts` carries it from there, with no price, rather than letting a
  starting package name an item that resolves to nothing.
- **Only armour and weapons can be equipped.** Clothing, an instrument and a
  holy symbol are carried; none has a mechanical slot. Nothing checks that two
  hands are free, either.

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
optional the way it is for the engine's own callers. The sweep in
`invariants.test.ts` is the authoritative list of which engine commands honour
one; a command absent from it is unguarded, and the DM-facing four that were —
`applyConditionTo`, `endConcentration`, `setExhaustionLevel`,
`grantTemporaryHpTo` — are there now. A model-driven loop
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

**The zone graph described here was never built.** The plan was a
`Zone { id, name, adjacent[], cover, terrain }` graph with ranges resolving as
bands — same zone melee, adjacent ~30ft, two hops 60ft+ — and this section said
so for long enough that `ZoneId` survived in `ids.ts` as its only trace. It has
been removed; this note replaces it so the next reader does not go looking.

What shipped instead is **a lattice of 5-foot cubes with Chebyshev distance**,
and it is documented at length under "Positioning: Coordinates, Authored But
Never Defaulted". Zones were abandoned because the thing they were meant to
avoid — geometry — turned out to be the cheap part, while the thing they forced
was expensive: every area of effect becomes a judgement about which zone it
catches, and "does Fireball get two goblins or three" is the most consequential
positional call in the game. Exactness is cheap where the answer is arithmetic.

**The boundary the original note was protecting still holds**, and it is worth
keeping in those words: resist scope creep toward a VTT. The lattice is an
internal representation, nothing is rendered, Maestro speaks in feet from
landmarks, and cover and line of sight stay *declared* rather than ray-cast —
because computing them needs walls, and walls are where a rules engine becomes
a map editor. Rendering a battlemap later is a presentation change, not an
engine change.

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
| The master Adventuring Gear table is filed under `#### Ammunition`, not under its own heading | tables located by bold caption in `parse/gear.ts` |
| The Entertainer's Pack weighs `58½ lb.` — a vulgar fraction, not `58.5` | `parseGearWeight` |
| The Waterskin's weight carries a note, `5 lb. (full)` | `parseGearWeight` |
| One `#### Spell Scroll` heading prices two table rows | prefix match in `parse/gear.ts` |
| Gear rows invert their names to alphabetise: `Lantern, Bullseye` | kept as printed; the craft-list test un-inverts to match |
| A tool's Craft list mixes items with categories carrying parenthesised exceptions | split at the top level, as weapon properties are |

**A pack's contents are asserted item by item, not phrase by phrase.**
Checking only that every phrase *resolves* passes on three different wrong
answers — a plural that lost its count, an inversion that landed on a
neighbouring row, a phrase dropped entirely — because all three resolve to
something. All seven packs are transcribed from `equipment.md` as exact
`[id, quantity]` lists and compared whole.

**A craft list is a list of other rows, so check it against them.** Every item
a tool can make is asserted to resolve to something the SRD actually lists — or
to a category phrase like "Any Melee weapon (except Club, Greatclub,
Quarterstaff, and Whip)", whose commas sit inside parentheses and are exactly
the trap that bit the weapon parser. `Spell Scroll` is the single exception and
an honest one: it is a magic item, and `magic-items.md` is not parsed. The test
names it, so parsing that file will make the test say so.

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

**An empty cell is not one state.** The gear table prints `—` and `Varies` in
the same column, and they are opposites: a Bell weighs nothing worth carrying,
while Ammunition's weight is simply stated elsewhere, on the variant you
actually bought. Weapons and armour have only the first case, so they use
`weightLb: number | null`; gear has three states and uses a union, because
collapsing `Varies` into null makes a Musical Instrument weightless and an
encumbrance total quietly wrong. Anything the parser cannot read at all stays
null and is reported — it never becomes either.

## Known Pending Work

- M0: classes, feats and magic items are vendored but not yet parsed; they can
  wait for a consumer. Adventuring gear (82 priced rows) and tools (25) are
  done, and ship as `GEAR` and `TOOLS`, with every pack's contents resolved.
  `catalogue.ts` is the consumer: creation, purchases and equipping all refer to
  items by id. Nothing yet reads an item's *weight* — encumbrance is unmodelled.
  Mounts, vehicles, lifestyle expenses, food, hirelings and
  spellcasting services are separate sections of `equipment.md` and are still
  unparsed.
- M1 spell execution: six spells across four effect shapes. Areas of effect,
  Temporary Hit Points, condition-lifting healing and cover on a saving throw
  are the named gaps, each with the reason it is still open.
- **M1 is done.** Its ship criterion — "a scripted 4-round combat between two
  parties resolves identically from the same seed" — is discharged by
  `scenario.test.ts`. What that proves is the *engine*: dice, rolls, checks,
  attacks, damage, conditions, positioning, combat, spell slots,
  Concentration, durations, turn hooks, rests, the clock, progression and one
  character path, all reproducible from a seed. Two spells — Fire Bolt and Hold
  Person — are executable definitions the engine resolves end to end; every
  other spell can be looked up but not cast, and `resolveSpell` says so rather
  than guessing. Spell slots, Concentration, casting, rests, the clock,
  effect durations and one complete character path have landed; the
  limitations recorded above are the honest edges of that work, each with the
  reason it is still open. Equipment closes the loop from a creation choice to
  Armour Class: packages are granted by id, packs are opened, purchases are
  priced in copper, and what is worn is separate from what is carried.
- M1 leftovers, none of them blocking: **class feature execution** (88 of 230
  features run; the rest say what a DM still does), the remaining species and
  backgrounds, feat *execution*, per-class spell preparation for a character
  who casts from two classes, and the equipment gaps listed under "Owning Is
  Not Wearing" — encumbrance, containers, attunement and ammunition.
- M1 spells: 82 of 339 executable and 46 tracked, with the shapes that block
  the rest counted in `COVERAGE.md` and ranked in `PROGRESS.md`. The utility
  bucket was audited spell by spell rather than by shape: 30 of the 76 open
  ones became tracked, 42 carry a rule the engine should own, and 4 depend on
  a world fact nothing can represent. **An ability check a spell offers against
  its own ongoing effect is now built** — Black Tentacles' escape, and the
  Investigation check that sees through Disguise Self, Minor Illusion and
  Silent Image. **A durable record of an ongoing casting is built too** — see
  "A Casting Is History; What It Left Behind Is State": Dispel Magic reads the
  level of what it is dispelling, Vampiric Touch and Flame Blade are used again
  on a later turn, and Mage Hand and Minor Illusion end their own previous
  casting. **A casting can hold a point** — see that section: Spiritual Weapon
  appears in a space, strikes from it, and is moved twenty feet on a later
  Bonus Action. Areas of effect, healing, saving throws for damage or a
  condition, Temporary Hit Points, lasting bonuses and an interruptible casting
  all work. **A persistent area catches a creature at a moment the spell
  names** — see that section: Insect Plague, Web, Grease and Black Tentacles
  all trigger on the turn boundary the SRD prints and on entering. **And an
  area can arrive at a creature standing still** — see "An Area Can Arrive At A
  Creature Standing Still": Moonbeam's Cylinder is moved by a later Magic
  action, along a route the caller states, and catches whoever it comes to.
  **And an area can be carried** — see "An Area Can Be Carried, And Then Its
  Origin Is Not A Point": Spirit Guardians' Emanation is centred on its caster,
  moves because the caster does, and catches whoever it arrives on. **And a
  spell can set an Armour Class rather than adding to one** — see "An Armour
  Class a spell sets is not one it adds to": Mage Armor replaces the target's
  base calculation, competes with Unarmoured Defense instead of stacking with
  it, and ends with the casting through the door every other effect uses.
  **Definitions are validated data** — see "A Definition Is Validated Data,
  And The SRD Is Its Oracle": a pure validator any definition passes through,
  SRD or homebrew, and a conformance oracle over the printed range and
  duration. **And Advantage is a property of a roll rather than of a
  creature** — see "Advantage Is A Property Of A Roll, Not Of A Creature":
  Blur puts Disadvantage on attacks *against* the creature it is on, Beacon of
  Hope puts Advantage on the two rolls it names and on no neighbouring one, and
  a class feature's grant and a spell's now share one selector and one
  predicate. What does not work: casting a definition the catalogue does not
  compile in, summons, long casting times, an area that moves *by itself* at the
  start of a turn (Cloudkill, Incendiary Cloud), a standing spatial effect such
  as the Speed halved inside that Emanation, a path or a distance travelled, an
  activation that resolves an area at a point chosen now, and a Reaction that
  answers a fall.
- M2–M5: tools, DM loop, CLI harness, persistence, web app, persona
