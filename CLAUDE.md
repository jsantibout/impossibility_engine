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
spell tests. **B owns mechanism** — `commands/`, `events.ts`, the timing and
positioning modules, and the *type declarations* at the top of
`spell-definitions.ts`. Stay in your lane; if a change genuinely needs the other
lane, say so rather than reaching across.

Four rules that a session will otherwise break, all of them learned here:

- **Never regenerate `packages/engine/fixtures/golden-log.json`** — nor
  `golden-log-2.json`. Both are frozen on purpose. Regenerating either to make
  `persistence.test.ts` or `persistence-2.test.ts` pass converts a
  compatibility test into a rubber stamp, which is worse than deleting it.
- **Always run `npm run coverage`** after touching a spell definition, and
  commit the result. CI fails on a stale `COVERAGE.md`.
- **Check the registry before adding a spell.** Two parallel sessions once both
  wrote Vitriolic Sphere; only a duplicate-symbol error caught it. Grep first.
- **Rebase on `main` before pushing**, and keep pull requests to one logical
  change.

Five tracked paths are `merge=binary` in `.gitattributes` and will never
auto-merge: `COVERAGE.md`, `package-lock.json`, `packages/srd/src/*-index.ts`,
`golden-log.json` and `golden-log-2.json`. That is deliberate — each is
regenerated rather than merged, and a text merge of them succeeds while
producing something nobody computed. `CONTRIBUTING.md` says what to run for
each.

## Development workflow: a foreman, builders, a reviewer, an architect on call

Development runs as one **Opus** session — the **foreman**: the engineering
manager who holds the queue, proposes work, runs the floor and integrates —
delegating approved, bounded tasks to one to three Opus **builders**, each in
its own git worktree and each checked by an independent Opus **reviewer**.
**Fable** is the principal architect and is *on call*: a bounded architectural
question, the analysis behind an owner decision, the periodic whole-engine
audit, and nothing else. The owner decides what is built, a **tranche** at a
time. `docs/dev/WORKFLOW.md` is the procedure; this is the part a session must
not get wrong.

- **The owner's authority is the tranche, not the merge button.** A tranche is
  roughly 3–5 briefed tasks with their dependencies, order and concurrency.
  Approving it authorises exactly those tasks through implementation, review,
  rework, integration, merge, push and bookkeeping — and nothing else. No task
  joins an approved roster; `check-queue.mjs` refuses one that tries. Silence
  is never approval, and the foreman never approves its own proposal.
- **A clean task merges without asking, and thirteen conditions say what
  clean means** — inside the brief, builder COMPLETE, an independent reviewer
  PASS at high confidence, defects resolved, the gauntlet green, conformance
  green, no blocker, no unapproved deviation, no surprise primitive, no scope
  expansion, no non-mechanical conflict, integration still valid, risk gate
  passed. Any one false and the task stops — for the builder, for Fable, or
  for the owner. Removing the per-task button did not remove the conditions.
- **The foreman is event-driven.** It thinks, delegates, and ends its turn; it
  is woken by a builder's completion notification, an escalation or an owner
  decision. It does not poll, monitor, narrate progress or work speculatively
  while builders run. Opus does the volume — coordination, engineering, review,
  rework, integration — and Fable's tokens stay for architecture.
- **Start with `/qb`.** It injects the live queue, the validator's summary and
  the git state, so a fresh session resumes from the repository alone. Run it
  on Opus; a Fable session spent coordinating is the cost this shape removes.
- **Sources of truth, highest first:** the doctrine; this file; `PROGRESS.md`;
  the task file and `docs/dev/QUEUE.md`; `COVERAGE.md`. A task's state lives
  on the `state:` line of its own file under `docs/dev/tasks/`, and
  `node docs/dev/check-queue.mjs` refuses any state outside the closed set.
- **The foreman's risk gate is lightweight by default.** It reads the
  completion digest — builder result, reviewer verdict, tests, conformance,
  deviations, primitives touched, special cases — and inspects the diff only
  when a risk signal in it says so.
- **GREEN is the foreman's, YELLOW is Fable's, RED is the owner's.** The
  foreman may decide anything that follows already-established architecture;
  it may not invent foundational architecture. Fable is invoked as the
  `qb-architect` subagent with `model: "fable"`, given the evidence the
  foreman already gathered, and returns a decision the foreman records. RED
  stops at `OWNER_DECISION_REQUIRED`.
- **Builders and reviewers do not merge; only the foreman does.**
  `qb-builder`, `qb-reviewer` and `qb-architect` are subagents, the builder
  `isolation: worktree`, all behind a hook that refuses `git push`,
  `git merge` and ref surgery, and Claude Code's own isolation that refuses
  edits and git aimed at the main checkout. Rework goes builder ↔ reviewer
  without the foreman, and the foreman merges only under tranche authority.
- **One owner per primitive.** Two tasks that both change `events.ts`, the same
  module under `commands/`, the types at the top of `spell-definitions.ts` or
  any other foundational primitive run one after the other, never concurrently.
  Two that change *different* command domains may run beside each other, which
  is what splitting that file bought.
  Content, conformance, tooling and docs run beside a mechanism task.
- **Builders never edit `PROGRESS.md` or `docs/dev/`.** The foreman is the only
  writer there; the Done row is recorded at merge, as it always was.
- **Broad audits are the owner's to start.** The foreman keeps no counter and
  launches none; the owner runs one in a fresh Fable session against clean
  `main`, normally once per heavy development day, and the next foreman session
  reads the findings before proposing work. What the foreman does is flag
  systemic risk as `WHOLE_ENGINE_AUDIT_RECOMMENDED`, with the evidence — and
  stop at `OWNER_DECISION_REQUIRED` only if continuing would be unsafe. A
  bounded YELLOW escalation inside a tranche is an architecture consultation,
  not an audit, and needs nobody's permission.

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

**Two frozen logs watch the fold, and it took two because one was not enough.**
`golden-log.json` is 93 events across 35 types, written before most of this
engine existed — so most of the event types had no compatibility fixture at
all, and a schema change to any of them passed the whole suite. That is every
event carrying state a fold reconstructs for the five reaction windows, the
interruptible casting, the ongoing record, a moved area origin and the
area-trigger debt queue. `golden-log-2.json` is the other half: 551 events
across 88 types, a campaign with two fights, two rests and a second encounter
**saved mid-turn** — four Concentrations, five ongoing castings, eight
deadlines, a paralysis repeating its save and a damage roll made and not
applied. Between them the pair covered every type the reducer declared on the
day the second was written, and `persistence-2.test.ts` carries the list of
what they do not as a ledger rather than a count.

**That ledger has one entry now, and how it got there is the interesting
part.** `damage-defense-granted` arrived after both logs were frozen, and
neither can be regenerated: rewriting a fixture whose whole value is that
nobody rewrites it turns a compatibility test into a rubber stamp. So a *new*
event type is uncovered by construction until the next frozen log is written,
and the honest record is a named entry saying which and why rather than a
number that quietly drops. The event is driven end to end elsewhere; what is
missing is specifically the compatibility fixture.

Neither is ever regenerated, and the second is not a replacement for the
first: three types live only in the older log, which a test names so nobody
concludes it has been superseded. The generators —
`scripts/make-golden-log.ts` and `make-golden-log-2.ts` — exist so each log is
readable rather than magic, and are not steps in the build.

**A compatibility test needs a timeout it can meet.** The second log is folded
at *every* prefix — 551 events, 552 prefixes, some 150,000 event applications
— which is a second and a half on its own and was measured at 2.2 seconds
inside a full parallel run, against Vitest's default five. That is not margin:
it made the suite's only fold-at-every-prefix assertion fail intermittently
whenever anything else in the suite grew, and a red build that says nothing
about compatibility teaches everyone to re-run it. It carries 30 seconds now.
The test asserts a fold and not a speed, so the number is generous on purpose,
and the next task to add a few hundred cases should not have to discover this.

**Every one of the types the union declares is emitted by engine code now**, and the
second fixture still writes several of them by hand, as the rest of the suite
does. It was seventeen with no producer at all, in two families, and both are
closed:

| | |
|---|---|
| ~~A fact that sets up a world for the rules to run in~~ | the scene, a landmark, a first placement, sight, cover, that a fight has begun, that time passed outside combat, what an NPC can cast — see "Setting The Stage Is A Command Like Any Other" |
| ~~A fact the DM declares mid-play~~ | allegiance, mounting and dismounting, the free object interaction, Alert's Initiative swap, a stabilisation, death that is not hit-point loss, an item the DM took away, a bonus whose source was no casting — see "The Other Nine Facts A DM Declares" |

Both families read like an omission and were. `placeCreature`, `addLandmark`,
`declareCover`, `declareSight`, `startCombat`, `mount`, `dismount`,
`useFreeInteraction`, `swapInitiative`, `stabilize` and `mountingCost` all
existed as pure functions the whole time, and the *reducer* called them to
fold events nothing wrote.

`creature-added` was never among the seventeen: `createCharacter` emits one,
and the second fixture hand-writes one anyway for a thug who came from no
character sheet.

**The claim is a derived sweep rather than a count in this file.**
`invariants.test.ts` reads the union and every runtime module under `src/`, and
fails naming any declared type nothing writes — driven over a synthetic type it
must catch, so the analysis cannot quietly stop seeing anything. It asserts the
narrower reading too: taken as *the command layer* — every module under
`commands/`, plus `rest.ts` — five types come back, and each carries a written
exemption naming `creation.ts` as its emitter, which the test then checks. See
"Known Pending Work" for why that mattered before M2 rather than during it.

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

**And the two paths now share the gatherer rather than a shape.** They were
identical blocks in one file, which is how the fork happened the first time and
is worse once the command layer is a directory: the copies sit in
`commands/attacks.ts` and `commands/spell-resolution.ts`, where neither
author sees the other. `defendingModes` in `commands/rolls.ts` is the one
function both call — a mutation that empties it fails a weapon-attack test
*and* a spell-attack test, which is the evidence that it is one gatherer and
not two spelled alike.

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

`resolveCast` is the whole cost of a casting: it validates the spell, spends the
action, Bonus Action or Reaction the casting time names, expends the slot, and
moves Concentration — or refuses and changes nothing at all. The spell is
validated first and the economy second, so a refusal on either side leaves
slots, Concentration and the budget as they were. A retried command id is a
no-op on both halves.

`castSpell` stays for callers reconstructing a log or scripting a fixture,
where the economy is already accounted for. Same split as `damageCreature`
beneath `resolveDamage`, and the same policy: the low-level half exists, and
Maestro's tool surface does not expose it.

**`resolveCast` is a low-level half too**, and this file said the opposite for
a while. Its own docstring has always said that a Reaction's trigger "is
checked one layer up" — `resolveSpell` is where `triggerRefusal` reads the
window, where `unsettledRefusal` asks whether anybody may act at all, and where
the targets, the range and the sight lines are checked. So the operation a tool
surface exposes for a spell the engine has a definition for is `resolveSpell`;
`resolveCast` is what is left for a spell it has none for.

**It is guarded by `mayAct` now, and that debt is discharged.** The exemption
that covered it called itself "a named debt rather than a settled exemption",
and the debt was precise: being the low-level half is a *policy* about who
calls it, and a policy is not a guard. It spends an Action and a slot, so a
caller reaching it while a persistent area owed somebody a saving throw acted
into a world nobody had settled. The one path that must **not** be refused is
the Divine Smite cast inside `resolveAttackDamage`, which settles an attack the
engine is already holding open — so that one calls `resolveCastWith`, the half
with the identity already established, and the exemption that protects the
settlement keeps protecting it. The guard sits **inside** the `once` callback,
which is what `once` is for.

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

**So everything the caster stated has to be on that record, and two facts were
not.** `PendingCasting` pinned the targets, the origin and the area for exactly
the reason above, and carried neither the **damage type** nor the
**unaffected** list — so a held Spirit Guardians declared Necrotic settled
Radiant, and a creature the caster had explicitly spared was caught anyway.
Both are facts the engine refuses to guess at the *atomic* cast — see "Two
clauses the geometry must not quietly absorb" — and the held path dropped them
silently, which is this file's own warning arriving through the other door:
*picking Radiant because most clerics are good is where a Necrotic-immune
Undead finds the engine out.* The rule is one sentence and it has no exception:
**whether a casting is settled in one breath or held open for a Counterspell
changes nothing about what the caster said.**

Two details, and the second is the one that would have rotted. The stated type
reaches the **effects** as well as the record, because Protection from Energy
states its type for an effect that lands at the cast while Spirit Guardians
states it for an area trigger — so `statedDamageType` is applied at settlement
exactly as the atomic path applies it, and a mutation dropping only that
substitution reddens the Protection from Energy cases and nothing else. And the
sort and the empty-list elision are **one function, three readers** —
`statedFacts`, read by the atomic record, by the declaration, and by the
settlement. It is idempotent on purpose, which is what lets the settlement call
it on an already-normalised pending record rather than spelling the copy out a
second time: two normalisations of one sentence is the failure this file
records about every rule kept in two places, and here it would have meant two
declarations that mean the same thing folding to different bytes.

Both fields are optional, so a declaration written before this has neither and
means what it always meant — which is the whole compatibility story, and why a
pending record needed no upgrade path. `upgradeOngoing` fills an *ongoing*
record from the catalogue; `spell-declared` stores `event.casting` verbatim, so
absent keeps meaning absent with nothing to migrate.

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

**And that refusal is a value, which it was not.** The exemption above lets a
Reaction *answer* the open casting; nothing said it could not open a second
one, so a Counterspell asking to be **held** while a casting was already open
sailed past the guard and produced a `spell-declared` the reducer rejected as a
corrupt log. The rule was right and the instrument was wrong: an exception is
reserved for programmer error, and "you may answer this casting but you may not
hold a second one open beside it" is something a DM narrates around.
`castOrRelease` returns it, nothing is spent, and the reducer's throw stays
where it belongs — as the backstop for a log that claims it happened anyway.

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

### Everything a later rule reads is pinned; nothing else is kept

A casting already made does not change when its caster does — that is what
`CastingNumbers` has meant since a spell could first catch somebody a minute
later. **It did not cover the area**, and that was the hole the third
whole-engine audit measured: the *shape* of a persistent area and the clauses
that fire in it are catalogue data, and the fold asked `definitionFor` for them
at five call sites on every read. So a replay of last week's log consulted this
week's catalogue, and correcting a transcribed Cube size would raise different
debts in a historical fold than the live session raised — which is "every
future rules fix silently rewrote history" arriving through *data* rather than
through rules, in the one place this file says it must not.

`area` and `areaTrigger` are now pinned on the record at the cast, and
`events.ts` imports the catalogue **for types only**. The rule is unchanged and
now applies to both halves: *pinned for the casting, read live for the creature
it is happening to.*

**Both halves of the clause are read off the record now, and the second half
took a task of its own.** Four fields decide *who* is caught and when — `at`,
`onEntry`, `onAreaEntry`, `oncePerTurn` — and the reducer has read those off
the record since they were pinned. The other two decide *what it costs them*:
`effects` and `label`, which `settleAreaEffects` went on resolving through
`definitionFor`, so a correction to Web's saving throw reached a debt raised
before it — the same hazard from the other end, history rewritten by data.

The compatibility question that was left open turned out to be already
answered. `upgradeOngoing` fills the clause **whole** for a pre-versioned
record as it enters the fold, and `areaDefinitionOf` raises a debt only where
the record carries both an area and a clause — so nothing can be owed that the
record cannot settle, and the settlement reads exactly the fact the detector
used. The clause is stored whole because `AreaTrigger` is one value the SRD
writes as one sentence; it is read whole for the same reason.

**Two fields came off in the same pass, and they had no readers at all.**
`concentration` restated a fact the creature holds — whoever is concentrating
names the casting — and `route` is a *name*, which has to be resolved against a
sheet before it is a number and therefore answers nothing a minute later;
`numbers` is what a later use actually reads. Two answers to one question is
the failure this record was designed to avoid.

**"Absent means what it always meant" is the whole compatibility story.** Both
frozen logs were written in the older shape, and there is no second place those
areas could have been recorded — so a record with no `version` is filled from
the catalogue **once**, as it enters the fold, by `upgradeOngoing`. That
function is the only thing left on the fold's path that opens the catalogue,
its docstring says so, and it is in a module of its own precisely so the
lookup cannot read as ordinary again: five of them sat in `events.ts` with no
reader who knew they were there. A version rather than "is `area` absent",
because absence is ambiguous — most spells have no area, and reading every one
of them as legacy would leave the fold consulting the book for ever.

**A record for a casting that has *ended* is a corrupt log.** The reducer
already refused one for a casting nobody cast and one for a casting already
running; the third case put a finished spell straight back into `ongoing`,
visible again to Dispel Magic, to the turn boundary and to every area detector.
`castingsEnded` is the memory that catches it — written **only** where a record
was actually removed, because `releaseCasting` also runs for castings that
never had one and marking those would refuse the record the same batch is about
to write. It is the single deliberate mention a finished casting leaves in
state, and the cleanup tests say so rather than asserting no mention at all.

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
| No deadline at all | "Until dispelled" runs with no timer — see that section |
| Dispelled or recast | `spell-ended`, with a reason |
| Target shakes it off | leaves `on`; the casting runs for everyone else |
| Target's last effect lapses | leaves `on`; derived, by the rule `alsoOn` grew it with |
| Target leaves the game | leaves `on`; the spell is **not** ended, because the SRD does not end a Bless when one of the blessed walks out |
| Created again afterwards | refused as a corrupt log — `castingsEnded` is what remembers |

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
| the numbers themselves, so a levelled-up caster does not move the save DC | the range to them |
| the caster — nobody else may act through it | their Armour Class, conditions, defences |

**Flame Blade is the one that proves the shape is a shape**: its casting does
nothing whatever, so its own effect list is empty and every blow it strikes
comes through the activation. A spell whose activation the engine resolves is
therefore **executed, not tracked**, and `coverage.ts` counts it that way.

**Produce Flame is the same shape at cantrip level, and it separates two ranges
that a single field would have merged.** SRD prints **Range: Self** — what the
casting reaches is the caster's own hand — and then lets a later Magic action
hurl the flame "within 60 feet of you". So the sixty feet are
`activation.range`, checked afresh on every throw, and `range` stays `self`, so
a casting aimed at somebody is refused. Putting the sixty feet in `range` reads
fine and makes the spell castable *at* a creature, which it never is. The dice
follow the same split: a cantrip has no slot, so the growth is
`cantripUpgradesAt` read off the caster — the one number an activation could
otherwise carry quietly wrong for ever.

### The family that works and the family that does not

The twenty-odd spells that act on a later turn split cleanly, and the split is
not about the rule — it is about whether the spell made a **thing with its own
position**:

| | Spells | Status |
|---|---|---|
| A permission the caster exercises | Vampiric Touch, Flame Blade, Produce Flame, Expeditious Retreat, Gust of Wind, Telekinesis, Detect Thoughts | the shape built here |
| A permission exercised **from a point** | Spiritual Weapon, Arcane Sword | see "A Casting Can Hold A Point" below |
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
state mentions the casting id **only** in `castingsEnded` — the one deliberate
trace, which is what lets the fold refuse a `spell-ongoing` naming a casting
that is over. No point, no timer, no stamp, no debt, no bonus.

**A new scene leaves the point where it was**, and that is a debt with a name
rather than an accident. `scene-set` unplaces every creature and nothing can
re-place a force — the only command that moves one moves it twenty feet.
Dropping the point instead would be worse: a Spiritual Weapon with no point is
a spell whose every reach check silently stops happening. So the coordinate
stands, the reach comes back in `unverified`, and the real fix is the
doctrine's multiple-scenes seam.

### Which spells this reaches, and which it does not

Thirty-nine SRD spells keep a place. **Two are executable by this primitive
today** — Spiritual Weapon and Arcane Sword — and the honest reason the rest are
not is never "it needs a position":

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
| A stat block created mid-fight | Unseen Servant, Arcane Hand, Phantom Steed, Summon Dragon, Giant Insect, Find Familiar, Find Steed, Animate Dead, Create Undead, Animate Objects, Planar Ally, Simulacrum |
| Walls and barriers as obstacles | Arcane Eye, Passwall, Wall of Stone, Prismatic Wall |
| A standing effect derived from where a creature is standing | Spirit Guardians' halved Speed, every Paladin aura |
| Light, which is not modelled | Dancing Lights, Daylight, Darkness |
| A second location | Project Image, Secret Chest |

**Three spells left the stat-block row when it was read against the book**, and
the correction is recorded rather than made quietly. It used to say "the four
Conjures, Guardian of Faith, Faithful Hound"; SRD 5.2.1 rewrote the Conjure
family as **spirits** — a pack, a pillar of light, an Emanation, a point you
strike from — and none of the six prints an Armour Class, Hit Points or a turn,
any more than Guardian of Faith or Faithful Hound does. Conjure Fey turns out
to be Spiritual Weapon's shape exactly and is blocked on nothing at all. What
is in the row now is the spells that genuinely print a stat block, and
`blocked-on.test.ts` asserts both halves so the row cannot drift back. See "A
Consumer Count Is A Query".

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

**Arcane Sword is the second user, and it arrived as data.** SRD prints the
same three numbers in the same three places — 90 feet of Range to place the
sword, 5 feet of reach measured from it, 30 feet a later Bonus Action may move
it — so the definition needed no field and no code, which is what a second user
is for. It is also where the value of *not* carrying a rule across became
visible, twice in one paragraph:

- **"you make" is not "you can".** Spiritual Weapon's force appears whether or
  not there is anything beside it, which is `TargetRule.optional`; Arcane Sword
  names the attack without that word, so its casting takes a target and an
  activation naming nobody is refused. One word of SRD, one field.
- **It prints no *Using a Higher-Level Spell Slot* line at all**, so 4d12 from a
  level 9 slot is still 4d12. A `perSlotLevelAbove` copied off the neighbouring
  definition is invisible to every guard, and what catches it is casting the
  spell from two slot levels under one seed and comparing.

Its one gap is the destination: SRD moves the sword "to a spot you can see", and
sight here is a declared fact **from one creature to another** while a
destination is a coordinate. There is no pairwise declaration to read and
nothing it could read instead, so that is the table's — the line declared cover
already draws — and it is adjudicated as such rather than left unsaid.

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

**A timer names what it ends**, and `EffectTarget` is the closed list of what
that can be. One condition instance on one creature expires that instance and
nothing else — two Clerics' Hold Persons on one goblin with different durations
end one at a time. A whole casting ends the casting and everything it created,
which is the same cleanup a broken Concentration performs, so "Concentration,
up to 1 minute" is both at once: losing Concentration ends it early, reaching
the cap ends it regardless. A **feature** a creature switched on is SRD Rage's
"lasts until the end of your next turn", on a thing that is neither.

**The fourth is every grant one source made on one creature**, and it is the
one that took a task of its own. `bonuses`, `armorClasses`, `rollModifiers` and
`grantedDefenses` all end when their casting does and nothing ended one
*sooner* — which is why `ModifierRider` carries no `lasts` and why SRD Superior
Hunter's Defense ("Resistance to that damage ... **until the end of the current
turn**") had nowhere to be written. Three decisions, each of which could have
gone the other way:

- **`source`, not a casting id**, so a feature's grant and a casting's use one
  member. `Stoneskin#cast:3` and `ranger:superior-hunters-defense` are the same
  kind of string to a timer.
- **One member, not one per grant kind.** A per-kind member would need a
  per-kind *identity* — `rollModifierKey` against a bare source, which are not
  the same string — and would be four ways to write one sentence. What ends is
  *what that source granted*, which is one question however many of the four
  answer it.
- **It ends the grant and never the casting.** The spell goes on running, stays
  concentrated on and stays in `ongoing`; only what that source hung on that
  creature goes. A casting whose grant expired is still a casting, which is the
  whole difference between this member and `casting`.

Timers are keyed by their target rather than numbered, so re-applying the same
effect from the same source *replaces* its deadline instead of leaving a stale
one behind to end it early.

### One enumerator for the four, because the fourth was threaded through five places

`bonuses`, `armorClasses`, `rollModifiers` and `grantedDefenses` are four lists
of the same shape — a grant, and the source that hung it — and **five functions
walked all four by hand**: `releaseCasting`, `releaseOnTarget`,
`releaseGrants`, `expireEffects` and `holdsNothingOf`. The fourth family
arrived after the other three and had to be added to every one of them. A fifth
added to three of the five is how a grant comes to be ended by a dispel and not
by a deadline — silently, because each site is correct on its own terms, which
is the shape of the two lists of pool kinds `poolsFor` collapsed and the four
readers `roll-modifiers.ts` replaced.

`grantSourcesOf(creature)` is the read and `withoutGrants(creature, predicate)`
is the removal, and all five route through them. The predicate is the whole of
what varied: `releaseCasting` and `releaseOnTarget` match the casting id inside
the source, `releaseGrants` matches the bare source a feature's deadline
carries.

**The list of families is derived from `CreatureState`, not written down.**
`GrantFamily` is every key whose value is a list of things carrying a `source`,
so a fifth family joins it on the day it is *declared* — and `grantsOf`, whose
return type is a mapped type over it, then fails to compile naming the property
it lacks. There is one such literal and `withoutGrants` builds its answer from
it rather than spelling the four out again, so a fifth family is one edit in
one place and the compiler insists on it. That guard was checked by mutation in
both directions before the enumerator was written: a fifth field added to
`CreatureState` reddens the build, and a family removed from the literal reddens
it too.

**`initiativeBonuses` matches the shape and is excluded**, which is the one
written exemption. Creation derives it from the character's own feats; no
casting hangs it, and no casting, deadline or dispel takes it away. It was in
none of the five walks, and putting it in one would end a feat the rules never
ended.

**Four things it deliberately does not do.** It does not merge the four arrays
— they are read by different rules, and a mode is not a bonus. It does not
touch `rollModifierKey`: that two-part identity decides whether a **re-grant**
replaces or stacks, and it is not what an *ending* matches on, because Beacon of
Hope's two modifiers are one casting's grant and one deadline takes both. It
does not enumerate `scheduledDamage`, because a hit still owed is the casting's
debt rather than something the casting is doing to the creature — the reading
that keeps a creature Insect Plague merely damaged out of `OngoingSpell.on`.
And it does not enumerate conditions, which are a different link with their own
instances and implications; `holdsNothingOf` asks them separately.

**The answer is sorted and deduplicated**, so the family order is unobservable
and serialised state cannot depend on it — and `withoutGrants` returns the
creature *by reference* when nothing matched, which `releaseCasting` reads to
decide whether a derived pass touched anybody at all.

**The evidence that it is one enumerator and not four spelled alike is a
mutation, and it is the evidence `defendingModes` was held to.** Stopping the
shared walk from removing anything reddens the bonuses suite, the
granted-defences suite, the roll-modifier suite and the Armour Class suite
together — and `golden-log-2.json`, which is what says the fold itself runs
through here. Dropping one *family* reddens only that family's suite, which is
the weaker claim and is why the shared walk is the one to break.

**`expireEffects` is the site the frozen logs could not have protected.** It
reads the four in reverse, to decide whether a casting still owns anything on a
creature; an enumerator reporting a grant the old code skipped would keep a
finished casting in `OngoingSpell.on`, which is a wrong answer to Dispel Magic
and appears in no log either fixture contains. The set it reports is exactly
the union of the four the five sites read — nothing added, `scheduledDamage`
and the conditions still outside it.

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

### Two lists of pool kinds is how a level silently stops granting one

Creation declared seven kinds of pool — the Hit Die pool, the spell slots, a
feat's free casting, a feature that is switched on, a feature that *is* a
resource, a Reaction with a limit of its own, and a recovery's single daily
use. **Advancement carried a second list, and that list held two of them.**
The comment above it said "Pools that already exist grow; pools that did not
exist are declared", which was true of the two below it and false of the other
five, which is exactly why it read as complete.

What that cost was a wrong number in a shipped path — the class of failure
this file calls its worst, because it looks like a rules bug forever after:

| Feature | SRD sizing | A character advanced 3 → 4 had |
|---|---|---|
| Lay On Hands | "five times your Paladin level" | 15 hit points in the pool, not 20 |
| Sorcery Points | the Sorcerer level | 3, not 4 |
| Rage, Channel Divinity, Wild Shape, Second Wind, Bardic Inspiration | a column of the class table | whatever the table printed at the level they were *created* at |

And a pool that arrives later never arrived at all: a Fighter advanced to 9 had
Indomitable on the sheet and nothing to spend, so `takeTestReaction` refused a
Reaction the character was entitled to.

So `poolsFor` is the one derivation and both callers reach it. Creation maps
every pool to a declaration; advancement declares what the creature does not
hold, resizes what it holds at a different maximum, and **emits nothing at all
for a pool the level left alone** — a resize to the number already stored is an
event recording that nothing happened, and the log should not carry one per
level per feature. The level is read off `choices` rather than passed beside
it, because a caller that can hand in a different number is a caller that can
hand in the wrong one.

**Shrinking is proven absent rather than branched on.** A downward resize would
clamp `spent` to the new maximum and quietly hand back a use already spent, so
it wants a rule rather than a guess — and no SRD progression asks for one.
`class-pools.test.ts` sweeps every pool-declaring feature in the twelve classes
and asserts no column falls and no per-level multiple is negative, which is
what says so.

**Two frozen logs fold unchanged, and that is the compatibility story.**
`golden-log-2.json` contains a real advancement, written before any of these
events existed. The fixture is a *log*: folding it applies the events it
records, and a fold that would now emit more of them changes nothing about what
those events mean. Regenerating it to match a richer batch would have converted
a compatibility test into a rubber stamp.

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
  was against; Slow Fall needs falling; Disciplined Survivor's reroll needs a
  feature to carry two grants; a stat block's printed Reactions are not read at
  all.

  **Superior Hunter's Defense is the one whose blocker moved rather than
  cleared**, and it is worth saying what is left instead of striking it off.
  "A Resistance with a deadline" is built — `damage-defense-granted` hangs one
  and the `grants` timer ends it — and reading the SRD sentence against the
  machinery turns up **three further things, none of them the grant**: "When
  you take damage, you can take a Reaction to give yourself Resistance to that
  damage and any other damage of the same type until the end of the current
  turn."

  | | |
  |---|---|
  | A fifth `ReactionEffect` member | the union's own rule is that a member exists because **at least two** features write it, and this is one. `reduce-damage` is not a substitute: SRD orders Uncanny Dodge's halving as an *adjustment* and Resistance second, so a Ranger who already resists would take a quarter under the wrong one |
  | "that damage", when a hit deals two types | the SRD prints no worked example, exactly as it prints none for which type Uncanny Dodge comes off — so it is a choice the engine would have to make and state, like `adjustmentsFor`'s |
  | "the end of the **current** turn" | a fifth `Duration` member. `endOfNextTurn` said of the creature whose turn it is resolves two turn-endings away, which is a round late |

  So the member is built and its runtime user is not, which is the honest
  order: the deadline was the part nothing could express, and the rest is a
  feature task with three decisions in it.
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

**And that last line was a claim about a function nothing called.** SRD: "If
these dice are the same die type, you can pool them together... If your classes
give you Hit Dice of different types, track them separately." `hitDicePools`
has said exactly that, correctly, since it was written, and is tested against
both of the SRD's own worked examples — and `poolsFor` declared **one** pool,
from the *starting* class, sized at that class's level. So the rule described
here was true of the engine's arithmetic and false of every character it built.

That is wrong in two directions at once, and which one a character meets
depends only on what they took: a Cleric 4 / Fighter 1 had four d8 and **no d10
at all**, while a Paladin 4 / Fighter 1 — who shares the die, both being "D10
per level" — had **four** d10 where the SRD gives five. The second is the
nastier of the two, because one pool of a plausible size is what a correct
implementation also produces, and only the *number* is wrong.

**The fix is the call, and that is the whole of it.** This is the eleventh
recorded instance in this file of a pure function that is correct, tested and
unreachable, and the remedy has never once been to write a second one. The
derivation is `hitDicePools`; `hitDiePools` in `creation.ts` adapts its
`{ sides: count }` to pool declarations and does no arithmetic of its own.

**A single-class character comes out byte-identical** — same key, same label,
same maximum, same `recovers` — which is the entire compatibility story, since
both frozen logs fold through that pool. One class in gives one entry out at
`choices.level`, which is what the starting class always produced. It is
asserted directly rather than relied upon, because "unchanged" is exactly the
kind of claim that is cheap to believe and cheap to check.

**Advancement needed no change of its own.** IE-008's declare-or-resize loop
reads whatever `poolsFor` returns, so a level in a class whose die is new
declares that pool and a level in a class whose die is already held resizes the
one pool — and both leave what has been spent spent, because `resize` moves
only the maximum. Two lists of pool kinds that have to agree is the shape the
bug IE-008 fixed had; this is the payoff for there being one.

Numeric keys iterate in ascending order, so a Cleric / Paladin's d8 pool always
precedes their d10. The declarations reach the log, so that order has to be a
property of the character rather than of the order their classes were written
down.

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

**It holds facts and never behaviour** — a casting id, a creature and a moment.
No predicate, no callback, no copy of the spell: settlement looks the
definition up through the casting's own `spellId` and runs it at the level and
route the casting was made with, through the same machinery an ordinary
casting uses. There is no second save calculator and no second damage
resolver, and the caller supplies no DC, no roll and no outcome.

**Three facts and not a fourth.** It carried the turn it was raised on and
nothing ever read it: the once-per-turn caps are `state.areaTriggers`' business
and are stamped where the debt is raised, and settlement orders by the moment,
then the casting, then the target. A number on a debt that nothing reads is a
second place for a cap to be got wrong, which is precisely the distinction Web
and Insect Plague exist to keep apart.

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
Bonus Action, movement, the turn's free object interaction or a feature's use:
Dash, Disengage, Dodge, Ready, feature activation and extension, the three pool
commands, an effect check, an attack, a move, a mount and a dismount, the free
interaction, a casting, an activation, and the turn.

**The list is derived, not recalled.** `invariants.test.ts` reads every module
under `commands/` and `rest.ts` — as one string, because the closure crosses
them — and computes the transitive closure of the **six** action-economy
primitives in `combat.ts` and the two events whose reducer takes a resource
away — `resource-spent` for a pool use, `spell-cast` for a slot.
`useFreeInteraction` is the sixth and was missing from the seeds until
something called it: a turn budget has six fields and it consumes one of them,
so a command spending it spends exactly as much as one spending a Bonus
Action. Every exported
declaration in that closure must either be run against a world owing a
mandatory area effect and be refused `area_effect_owed`, or appear on an
allowlist with the sentence that exempts it, and never both. A command added
without the guard is in neither list and fails there rather than in play, which
is what the third whole-engine audit (2026-09-13) found was not true: the only
test was a hand-written case list covering nine of sixteen spenders, and
`extendFeature` spent a Bonus Action with no guard at all.

The allowlist is nine: five Reactions, two settlements of a window the engine is
already holding open, `castSpell` — the low-level half beneath `resolveSpell`
that leaves the economy to its caller — and `endRest`. `resolveCast` was the
tenth and is guarded now; its exemption said in its own words that it was a
named debt, and a sweep that asserts the list in both directions is what made
discharging it a one-line deletion rather than a search.

`endRest` is an **open question rather than a decision**. A rest
is not an action in the turn economy — SRD spends no Action, Bonus Action or
Reaction on one, and the Hit Dice it spends are the rest's own payout rather
than something taken during a turn — but whether an outstanding area effect
should stop a creature ending a rest is a question neither the SRD nor this
engine has ever asked. It is written down where the next person to read the
list will meet it.

Both sweeps are driven over a synthetic sample they must catch, so the analysis
cannot quietly stop seeing anything, and every case is asserted twice — refused
with the debt outstanding, and *not* refused once it is settled, because a
fixture in which a command was never reachable would prove nothing.

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

### `OngoingSpell.on` grows, and now it shrinks as well

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

**The asymmetry is closed: `expireEffects` shrinks it.** When a condition
instance lapses on its own deadline, the casting stops being on that creature —
**if that was the last thing it owned there**. One rule read in both
directions, rather than a list that only ever grew: a stale name in `on` let a
creature dispel a spell that was no longer on them. The "last thing" test is
the same four links `releaseCasting` walks — the conditions, the bonuses, the
Armour Class and the roll modifiers — asked of one creature, so a Hold Person
still holding somebody stays on them whatever else lapsed. Scheduled damage is
deliberately not one of them: a hit still owed is the casting's debt, not
something it is doing to the creature, which is the same reading that keeps a
creature Insect Plague merely damaged off the list.

**No executed spell reaches it yet**, and that is worth writing down rather
than dressing a fixture up as one. A condition needs a deadline *of its own*,
and the three definitions that give one — Ray of Sickness, Color Spray,
Sunbeam — are Instantaneous twice over and Range: Self the third time, so the
first two leave no record and the third is on its caster. The test drives it
through `applyConditionTo`, which has taken a per-condition `Duration` since
durations landed and carries the casting in its source like every linked
effect.

**Web's Restrained is not the case this reaches, and is worse than it.** It is
not independently timed — it hangs on the casting's own deadline, so the
casting's timer ends first and takes it along. And what the SRD actually gives
it is "while in the webs": a condition that ends when its holder walks *out of
an area* has no shape here at all, so it runs until the casting ends or the
creature breaks free, and the definition says so in `unmodelled`.

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

**And a fixture that enumerates what the runtime derives will drift.**
`spell-catalogue.test.ts` decided whether to drive a spell in combat by listing
the effect kinds that can carry a turn-anchored rider — `save`, `attack`,
`save-damage` — where `riderDurations` is the derivation the command layer
already uses to answer the same question. It had missed `condition`, which has
carried a rider since the standalone kind landed, so a definition of that shape
with a turn-anchored rider would have been driven *outside* combat and refused
for a reason belonging to the fixture rather than to the spell. The list is the
derivation now. Nothing was wrong in the catalogue; the next definition is what
it would have been wrong about.

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

`verified` says a test drives the spell end to end; `untested` says nothing
does. **Neither word says whether the spell finishes**, and Spirit Guardians is
where that stopped being a distinction nobody needed: its Emanation, three
clauses, cap, save and damage all run under a suite of their own, and the
**halved Speed inside the Emanation** is a rule the engine owns and has not
written. That is a standing spatial effect rather than a trigger: it wants a
Speed derived from where a creature is standing, and mutating a base Speed on
entry and exit would be correct only while every enter and leave paired up
perfectly.

So `PARTIAL_SPELLS` is the third state, and a spell listed there must say in
`unmodelled` what it is missing — otherwise it becomes the place claims come to
be quietly parked. Same move the adjudication map made when `table` and a
missing shape could not express `engine`. It is no longer kept by hand: every
entry is *derived* from a clause adjudicated to a missing shape — see "The same
guard, pointed at the spells the engine executes" — and Spirit Guardians turned
out to have fifty-two companions.

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

**And a creature who leaves takes its timers with it.** `pendingSaves` was the
one engine debt of nine with no leaving-creature handling —
`settleHoldsInvolving` closes a held attack and a declared move, and
`dropOrphanedAreaEffects` and `dropStrandedDamage` cover theirs. A Paralyzed
goblin removed mid-fight left its Hold Person timer standing, and
`dropOrphanedSaves` drops a save only when its *timer* is gone: so the debt
survived, `resolvePendingSaves` refused `unknown_creature`, `resolveTurn`
refused `saves_pending`, and **the fight could never advance again**. The
reducer's `creature-removed` now drops every timer that ends something *on*
that creature, and only that creature's — a Hold Person holding two is not both
of them being freed, which is the distinction the casting id was built for,
applied to the target. A **casting's** timer is untouched, because SRD does not
end a Grease because somebody walked out of it. Nothing is written for any of
it: expiry is derived, and nobody decides that a condition on a creature who
has left the game has stopped.

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

**The definitions are not code; the file they live in is not only
definitions.** Every one of them is pure declarative data — closed typed
unions, no expression, no hook — and the runtime holds no spell-name special
case anywhere, which is asserted rather than assumed. What the file *also*
carries is readers **of** that data: `definitionFor`, `scaledDiceFor`,
`scaledFlatFor` and `targetCountFor`, the seven IE-005 moved here from the
command layer, and `conditionRiderOf`, each answering a question about one
field of a definition — and `DIRECTIONAL_AREAS`, which is a third thing again,
neither a definition nor a reader but a set the geometry consults.

**No count appears in this section, and that is the point rather than an
omission.** It said 125 while the catalogue held 130, and the correction to 130
was stale before it merged, because another task added two definitions and a
twelfth reader in the meantime. This repository's answer to a number that
matters is a generator and a CI guard — `COVERAGE.md`, regenerated by
`npm run coverage` and diffed in the gauntlet — and prose has neither, so a
digit here is a claim nothing checks in a file whose whole subject is claims
that are checked. The quantifiers are what carry the paragraph and they are
guarded: **every** definition is data, because the whole catalogue is driven
through `parseSpellDefinition`. Ask `COVERAGE.md` for the size; it is always
current, and this never will be.

An earlier version of this paragraph said the file "was never code", and that
was never true: four of the readers were already in it on the day the sentence
was written. The distinction it was reaching for is the one worth keeping, so
it is stated rather than deleted — **a definition is data, and a function that
reads a definition is not a definition.** The rule those readers obey is that
one branches on a *field* and never on a spell's name, and every one does —
and **what holds them to it now is the sweep itself**, which reads every
non-test source file under `src`. It used to read `commands/`, `events.ts`,
`spells.ts`, `spellcasting.ts` and `standing.ts`; IE-005 moved seven of the
readers out of that population into this very file, and `spell-schema.ts`,
`duration.ts`, `attack.ts`, `positioning.ts` and `checks.ts` had never been in
it at all. No special case was found in any of them: a hole closed, not a
breach.

**The half that was called unfixable was not.** The argument was that the
sweep's second half asks a file to name no catalogue id, and a file of
definitions names every one of its own. True — and a definition's own `id:`
line is a *reviewed construct*, not an unavoidable smear: allow that one line
shape and nothing else in the catalogue names a spell at all. One other
construct needed the same reading, and it is data for the same reason: a
subclass's `grants: { kind: 'spells', fixed: [...] }` is the class table
saying which spells it grants, and nothing about a list of ids can branch on
one. So the allowance is two constructs rather than a few files waved through,
and everything else on every line of every file still counts.

**Excuse a construct, never a file — and never a list of files.** The first
version of that allowance was written as a line shape and described in prose as
"`cleric.ts`, `paladin.ts` and `warlock.ts`". It was wrong twice over in the
same sentence: `ranger.ts` writes the same grant *inline* on one line and
`sorcerer.ts` was simply left out, and both passed anyway because none of their
ids has a definition yet. So the sweep would have stayed green until a content
task defined Hunter's Mark and then failed for a reason with nothing to do with
that task. The claim is checked now instead of written down — every
`fixed: [...]` grant in the engine is asserted to be one the allowance reaches,
so a grant in a shape it cannot see fails where the message is about the
allowance rather than in the sweep.

Two words are excluded because the engine uses them for something else —
`shield` is an armour category and `light` is a weapon property — and one
comparison is allowlisted by its exact text in its exact file: `creation.ts`
asks which of a character's classes is the Wizard, which matches the shape and
is a **class** definition's id. Removing that belongs to the
feature-definition validator, not to this sweep.

So the comparative audit's "move definitions out of TypeScript" named the wrong
half of the problem. **What was missing was the validator, not the format**:
the compiler was the only guard, so a definition that did not arrive through
`tsc` had nothing to check it at all.

Three questions, three places, and conflating any two is how "valid" comes to
mean "official":

| | Asks | Applies to |
|---|---|---|
| `spell-schema.ts` | is this definition **coherent** | any definition, SRD or homebrew |
| `scripts/spell-oracle.ts` | does it **agree with the printed spell** | only a definition whose id is in the book |
| `commands/` | may **this casting** happen, here, now | every cast |

A DM's invented spell is valid engine data and is not SRD-conformant, and both
halves of that sentence are load-bearing. `spell-schema.test.ts` drives one
through the validator and asserts it is not in the parsed book.

**`checkSpellDefinition` returns every problem, with a path on each**, which is
the `checkCharacter` shape for the `checkCharacter` reason: an author does not
want to be told about one mistake at a time. `parseSpellDefinition` takes
`unknown` and is the `Result` half, so a definition may come from a file, a
loader or a tool rather than from a compilation.

**Every rule was run against the whole catalogue before it was written, and
none of them fires** — 125 definitions at the time, more since, and the count
is not restated here because the catalogue is driven through
`parseSpellDefinition` wholesale and a second place to keep a number is a
second place to get it wrong. These are the rules the catalogue already obeys,
moved to where a *new* definition meets them rather than being discovered by a
sweep
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

### Nothing could see a member nobody used, and that was the structural gap

`checkSpellDefinition` asks whether **one definition** is coherent. Nothing
asked the other direction — whether every member of the *format* is written by
at least one definition — so speculative shape accumulated in silence, which is
the exact failure the doctrine's generalization rule exists to prevent. The
fourth whole-engine audit (2026-09-13, §3.1) counted three: `roll-mode.save`,
`SpellCheck.dc`, and `'end-casting'` as a `save.repeats.onSuccess` value. Each
was written for a spell blocked on something else.

The guard already existed one vocabulary over — `spell-honesty.test.ts` asserts
that no entry in `MISSING_SHAPES` sits unclaimed — so this is that sweep,
pointed at the format. **It is derived rather than listed**, for the reason
every sweep here is: the members are read out of the declarations in
`spell-definitions.ts` and the users are read out of `SPELL_DEFINITIONS`, so a
member added to a type and not to a list is a case that cannot arise.

**It reports names, never a count.** A count would need maintaining by whoever
next changed the format, and would pass for the wrong reason the moment two
changes cancelled.

**An exemption is the only alternative to a user, and inventing a user is
forbidden.** Four members are exempt, each with the pinned fact that would end
the exemption — the move `spell-honesty.test.ts` makes for Sunburst's dispel
clause:

| Member | Why it stays | What ends it |
|---|---|---|
| `SpellDefinition.anchoring` | SRD mandates no footprint convention; the field exists so a geometry pass or non-SRD content says it in data | a spell declaring one |
| `SpellCheck.dc` | SRD Maze prints "a DC 20 Intelligence (Investigation) check"; Maze is blocked on a demiplane | a `maze` definition |
| `save.repeats.onSuccess: 'end-casting'` | **not speculative** — `RepeatSave` and `PendingSave` carry the value, the reducer branches on it, and `turn-hooks.test.ts` drives that branch | the engine ceasing to resolve it |
| `roll-mode.save` | a handover, not a decision: it really has no user, and removing it is IE-010's, which owns the union | the field's removal |

The last is the interesting shape. A task that may not change the format cannot
*fix* a zero-user member; what it can do is refuse to let one pass unrecorded.
So the exemption names the task that removes it, and the rule that **an
exemption must name a member the format still declares** is what turns that
removal into a one-line deletion rather than a search.

**The probe is coarser than the member, and that is the sound choice.** A
member is looked up by field name and value, not by the type that declared it,
because the usage walk reads *values* and values carry no types. The arm-aware
alternative was written and measured and is worse: a `DiceScaling` nested
inside an `attack` effect inherits the effect's arm, so `DiceScaling.flat?`
comes back unwritten while False Life writes it — four false positives, which
is the one thing a guard must not have. What the coarseness costs is pinned
rather than hidden: the collisions are asserted as a list, and the one that
genuinely masks something is named in it. `AreaTrigger.at` and a repeat save's
`at` share two values, Web writes `start-of-turn` as an area boundary, and no
definition repeats a save at the start of a turn — so that combination is
unwritten and this sweep cannot see it. A limit of the instrument, not a
decision about the format.

### Two rules the validator did not have

**`grant_without_lifetime` is a guard with no fix attached.** A `buff`, a
granted `roll-mode` and an `armor-class` are all removed by `releaseCasting` or
`releaseOnTarget` when the casting ends, and a condition rider that says
neither `lasts` nor `outlivesCasting` "lasts as long as the casting does". An
**Instantaneous** casting is over the moment it resolves, so each of those on
such a spell is a grant with no moment that could ever end it. No definition
violates it — all of them were driven through before it was written, as every
rule here was — which means the only way to know it is a guard at all is a
hand-built definition that fails it, and that is what its test does.

The two escapes are the two the SRD writes and the rider already carries: Color
Spray is Instantaneous and blinds "until the end of your next turn", and
Grease's Prone outlives the Grease. So the rule reads the **rider**, not the
effect kind.

**A `SpellCheck` had no field checked at all**, which is how a check naming a
skill of the wrong ability compiled and validated. What the existing vocabulary
can answer is now answered and nothing more: the ability and the skill are
closed sets the engine holds, a printed DC is a whole number worth beating, and
the outcome is one of the two values the type declares. The pairing is the rule
worth having — SRD always prints "Intelligence (Investigation)", the ability
the skill belongs to in front of the skill, and a pair that disagrees rolls one
ability's modifier against the other's proficiency. Nothing downstream would
notice: `rollAbilityCheck` reads `ability` for the modifier and `skill` for
proficiency and is right to trust both.

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

### A Resistance a spell grants, and the third input to `defensesOf`

SRD Stoneskin, whole: "Until the spell ends, one willing creature you touch has
Resistance to Bludgeoning, Piercing, and Slashing damage." `CreatureState.defenses`
was written when a creature entered the game and nothing added to it
afterwards, so every spell that hands one out was a sentence in `unmodelled`
saying so — Protection from Poison's said it in those words for as long as the
definition existed.

**`defensesOf` was already the gatherer, and this is its third input.** The
stat block's entries, the ones a feature grants while its requirement holds
(Rage, Elemental Affinity), and now the ones a *running effect* has hung on the
creature. The third is the one with a lifetime: it is keyed by `source`, so
`releaseCasting`, `releaseOnTarget` and a `grants` deadline can take it away
again, where the other two are derived afresh on every read.

`GrantedDefense` therefore lives on `CreatureState` beside `bonuses`,
`armorClasses` and `rollModifiers` — the fourth member of that family, ended
through the door the other three already use, needing no lifecycle of its own.

Three readings that are the SRD rather than the shape:

- **The answers union; they never override.** "Multiple instances of Resistance
  to the same damage type count as only one", so there is no arithmetic a
  second copy could do and no reading under which a grant could *weaken* what
  is already there. A creature Immune to Fire who is then granted Resistance to
  Fire still takes nothing, because `applyDefenses` reads Immunity first and
  stops; one who is Vulnerable takes the SRD's own worked order, halved and
  then doubled. Two castings of Stoneskin on one fighter halve the sword once,
  and each ends on its own.
- **A list of types and one answer**, because the SRD writes one clause about
  however many types it names. No sentence in the book grants Resistance to one
  type and Immunity to another, and a spell that did would be two effects.
- **A qualified entry stays qualified.** A grant is unconditional by
  construction; `adaptMonster` keeps "Charmed (except from its vampire master)"
  out of the automatic table and `conditionApplicability` goes on answering
  three ways. Merging a grant into `defenses` would have been the tempting
  implementation and would have put an unconditional answer in the one table
  that exists to hold only unconditional answers.

**Not a `buff`.** A bonus is arithmetic that adds and stacks; Resistance is a
boolean the SRD refuses to let stack, and it is applied in its own step of
`applyDefenses` — after the adjustments, before Vulnerability. Folding it into
a number would put it in the wrong step *and* let two castings quarter the
damage.

**The second spell to state its damage type at the casting, for the opposite
reason to the first.** Spirit Guardians states a fact the *SRD* decides about
the caster and the engine does not hold; Protection from Energy states a
*choice* — "Resistance to one damage type of your choice: Acid, Cold, Fire,
Lightning, or Thunder". `damageTypeStated`'s own docstring said a second user
would be the evidence that anything about it should generalise, and this is it:
the mechanism generalises and the *reason* stays each spell's own. What had to
change is that `statedDamageType` now reads the plural spelling too, and is
applied to the casting's **own** effects rather than only to an area trigger's
— Spirit Guardians' effect list is empty, so nothing had ever needed that.

Three spells execute on it, and the third is the one that shows the shape was a
gap rather than a want: Protection from Poison's own `unmodelled` clause said
"defences are set when a creature enters the game and no effect grants one".
Building it also made that casting's `on` non-empty, which the definition's
docstring had predicted in those words — a removal owns nothing, and a
Resistance is something the casting owns and keeps.

### An Outcome That Varies By What The Target Is

SRD's glossary states the rule and then declines to give any: "The types don't
have rules themselves, but **some rules in the game affect creatures of certain
types in different ways.**" The engine has held the fact authoritatively since
`declareCreatureType` landed — a species gives it, a stat block prints it, a
declaration establishes it, and a contradiction is refused — and exactly one
thing read it: `TargetRule.mustBeType`, which gates *targeting*. This is the
second reader, at the outcome.

**Five sentences in the book are about a target's type; three are built and
the two that are not are blocked on something else.** Every *other* type clause
in the book is about the **attacker's** — Protection from Evil and Good, Dispel
Evil and Good, Magic Circle — which this file already names as a different
missing piece and which this does not touch.

| Spell | SRD | |
|---|---|---|
| Blight | "A Plant creature automatically fails the save." | `save-damage.againstType` |
| Shatter | "A Construct has Disadvantage on the save." | the same |
| Divine Smite | "The damage increases by 1d8 if the target is a Fiend or an Undead." | `attack-damage.againstType` |
| Flesh to Stone | "Constructs **automatically succeed** on the save." | a third outcome, and see below |
| Banishment | "If the target is an Aberration, a Celestial, an Elemental, a Fey, or a Fiend, the target doesn't return..." | not this shape at all — see below |

**It is not a rider, and the distinction is the one `OutcomeRiders` already
draws from the other side.** A rider hangs off an outcome that has *settled*;
this decides how the roll comes out. So the slot sits on the host beside
`ability` and is read before the die rather than after it.

**Two slots, one question, one gatherer.** The payloads differ because the
sentences differ — a saving throw's outcome against extra damage dice — so
`creatureTypesRead` is the one thing that asks "does this effect have to know
what the target is", the move `modifierRidersOf` already makes on the other
axis. A third host is one case there and nothing anywhere else.

**An automatic failure is `autoFailed`, which the engine already means by the
phrase.** A Stunned creature's Strength save has worked this way since
conditions closed the loop: the die is thrown and recorded, because other
effects can care what it showed, and the total is overridden so no bonus
applied afterwards rescues it. Building a second mechanism that skipped the
roll would have had to explain why Shatter's Construct still rolls, and would
have put an SRD phrase in two places. `D20TestOptions.autoFail` is how the
caller supplies it — for exactly the reason `modes` and `bonuses` are supplied:
whether the target is a Plant and whether this spell singles Plants out are
questions the layer above holds the answers to, and the engine applies the rule.

**Two save outcomes, and the two that are absent are absent for different
reasons.** An **automatic success** is a sentence the book really prints —
Flesh to Stone's "Constructs automatically succeed on the save" — and the
member is still not there, because its only writer cannot be written down:
that spell's other clauses are a rider on the *success* branch, a repeat save
counted to three of a kind, and a Petrified outliving the count, all three of
which this file already names as missing. A member no definition could use is
what the format's own unused-member sweep exists to catch, so it arrives with
the spell. **Advantage** is absent for the opposite reason — no SRD sentence
gives a named *type* Advantage on a save at all. The five that hand a save
Advantage (Charm Person, Charm Monster, the three Dominates) key it on "if you
or your allies are fighting it", a declared fact about the casting rather than
a property of the creature, and that is a task of its own.

**The extra die is a bare notation, not a `DiceScaling`.** Divine Smite's
*base* grows per slot level and the type sentence does not, so a
`perSlotLevelAbove` here would be a field no SRD spell writes — and it is a
second damage **component** rather than a bigger notation, so the log shows two
contributions and says why the second is there. Same damage type, so the two
meet the target's defences as one pool and a Critical Hit doubles both.

**Divine Smite is a spell, and the brief that asked for this said it was a
class feature.** SRD 5.2.1 prints "_Level 1 Evocation (Paladin)_" with a Bonus
Action casting time, which is why `resolveAttackDamage` casts it through
`resolveCastWith` and why its clause reaches this vocabulary as data with no
widening at all.

#### The unknown case is a request, and it is asked before anything is spent

A creature nobody has typed is a **thin record**, not a creature of some other
type. Taking the default branch quietly is the failure the whole three-valued
discipline exists to prevent and the easiest thing in this rule to get wrong:
nothing downstream would ever look different, and a Plant that rolled its save
is a wrong number with no symptom.

So `creatureTypeNeeds` raises the `creature-type` request targeting has always
raised — no new `ContextRequest` kind, no change to `declareCreatureType` or to
`type_established` — and it is asked in **two** places, which is one more than
it looks:

| | Why it is there |
|---|---|
| `castOrRelease`, with the targets settled | before the slot, the action and the first die — and it joins the same list the position and sight requests use, so a caller repairing a thin record is told everything that is thin at once |
| `resolveEffects`, before the loop | every other path in: an area trigger settling a minute later, a **declared** casting being settled, an activation |

**The declaration is the case that makes the first one load-bearing.**
`resolveSpell` with `hold` spends the action, drops the Concentration the
caster held, writes `spell-declared` and stops — the effects do not run until
the casting settles. SRD Counterspell says that action "is wasted" whatever
follows, so a declaration that cannot settle has spent it for nothing, and
without the pre-flight the caster would find out at settlement. And the second
is load-bearing for the generator: asking mid-loop would leave it advanced for
the targets already resolved, which is a refused operation that moved the
world.

#### Type matching is the SRD's, never a substring

`isCreatureType` is the one comparison and **targeting's three call sites go
through it**, so there is not a second answer to one question — which is worth
stating as a change rather than as a property, because the three inline
`toLowerCase()` comparisons it replaced agreed with it exactly, and two
implementations that agree today are the shape this file records going wrong
every time. A Goblin Warrior is "Small **Fey**
(Goblinoid)": the type changed in 2024 and Goblinoid is a subtype **tag**, to
which the book gives no rules at all. Matching by containment gets that wrong
in both directions at once — a rule naming Goblinoid would reach a goblin, and
the looseness that allows it is the same looseness by which every 2014 instinct
about who is a Humanoid goes on being wrong. `CREATURE_TYPES` is the glossary's
closed fourteen and the validator holds a clause against it, so a definition
naming a tag is refused at authoring rather than silently matching nobody.

**The parser already strips the tag**, so no monster in the bestiary carries
one — which is why the matcher does not try to parse a parenthesis out of a
declared string. A guard for a shape nothing can produce is not a rule; the
exactness is the rule.

#### What this closed, and the one that turned out not to be this shape

Blight, Shatter and Divine Smite leave `PARTIAL_SPELLS`, and
`an-outcome-that-varies-by-creature-type` leaves `MISSING_SHAPES` altogether —
no **executed** definition is blocked on it any more, and
`spell-honesty.test.ts` keeps no shape nothing claims. That is the honest
scope of the claim: Flesh to Stone's automatic success is not carried, and
Flesh to Stone is not an executed definition, so it has no clause in that map
to claim a shape with. The day it becomes one, the shape comes back with it —
which is what a derived list is for.

**Banishment is honestly refused rather than fitted.** "If the target
is an Aberration, a Celestial, an Elemental, a Fey, or a Fiend, the target
doesn't return if the spell lasts for 1 minute. The target is instead
transported to a random location on a plane (GM's choice)." The type is no
longer the blocker; neither half of what is left is about it. Nobody was
transported to a demiplane in the first place — there is one scene — so there
is nothing to fail to return *from*, and the plane it would go to instead is a
second place the engine has nowhere to put anybody. Its clause is re-filed to
`a-second-place-to-put-a-creature`, which its *other* clause already claimed. A
field with one user would have been the wrong answer to that, and this
repository has just spent a whole audit finding members nobody uses.

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

**Outcome-scoped child effects are not deferred any more; they turned out not
to exist.** See "A Settled Outcome Carries Riders, And A Rider Is A Leaf"
below — the restricted child vocabulary this paragraph was waiting for is not a
vocabulary of effects at all.

**`SpellEffect.damageType` stays `string`.** Narrowing it to `DamageType`
ripples through `damageTypeStated`, `applyDamage`'s keys and the monster
adapter, which is a typing pass rather than a definitions pass. The validator
checks the value instead, at the same place a homebrew definition would get it
wrong.

## A Settled Outcome Carries Riders, And A Rider Is A Leaf

The definition format needed a restricted child vocabulary — something that
could say what the SRD says after "On a failed save," without becoming a small
untyped program with a saving throw nested inside a saving throw. The answer,
measured rather than designed, is that **there are no child effects in those
sentences**:

> Hideous Laughter: "On a failed save, it has the **Prone and Incapacitated**
> conditions for the duration."
> Phantasmal Killer: "the target takes 4d10 Psychic damage **and has
> Disadvantage on ability checks and attack rolls** for the duration."
> Sunburst: "a creature takes 12d6 Radiant damage and has the Blinded
> condition **for 1 minute**."

What follows the comma is a **conjunction of consequences sharing one roll** —
one target, one DC, one casting link, one lifetime — and every consequence in
that position is a **leaf**: it rolls no d20, names no target of its own, opens
no window, and spends nothing. The engine already had three of them and called
them riders; what it lacked was the observation that being a leaf is what makes
them riders. So `onFail: SpellEffect[]` is rejected on evidence rather than on
taste — **a child that rolls is a parent** — and the two SRD spells that look
as though they need one turn out to be different mechanisms: Ice Knife is two
sequenced rolls with an area centred on a target, and Chromatic Orb is a
chained attack on a dice-face trigger.

`OutcomeRiders` is the whole vocabulary, in three named slots:

| Slot | Is | Consumers |
|---|---|---|
| `conditions` | a list of `ConditionRider` | Hideous Laughter, Hypnotic Pattern, Sunburst, Sunbeam, Ray of Sickness, Contagion, Black Tentacles, Weird |
| `modifiers` | `ModifierRider`: `buff` and `roll-mode` **minus their own saving throw** | Phantasmal Killer |
| `delayed` | `DelayedDamage`, unchanged | Acid Arrow, Vitriolic Sphere |

**Named slots rather than a `riders: Rider[]` union.** The type system can then
say which host may carry which rider — `plus` and `delayed` on a `save` are
impossible rather than validated — and the SRD writes one slot per sentence
shape. The cost is one `applyRiders` with three loops, which is smaller than a
dispatch.

### The branch is the host's, which is why the slot name *is* the branch

Three kinds produce an outcome and therefore host riders: `attack` on a hit,
`save-damage` and `save` on a failure. There is no success-branch slot and no
miss-branch slot, so an author cannot write one — which is the invariant, made
structural rather than validated. `applyRiders` is reached only once the
affirmative outcome has been decided, so it contains no branch at all.

`condition` is **not** a host: it has no roll, so its rider *is* the effect, and
`conditionRiderOf` types that as a non-empty list so the single element is not a
guess. The other eight kinds host nothing because no consumer writes a rider
after any of them.

**The two outcome selectors govern the host's own damage and nothing else.**
`save-damage.onSuccess` was already that; `attack.onMiss: 'half'` is Acid
Arrow's "On a miss, the arrow splashes the target ... for half as much of the
initial damage **only**". *Only* is the word that makes it a branch on the
damage rather than a second set of riders: the later 2d4 is a rider and a miss
owes it nothing. One consumer, transcribed as the mirror of `onSuccess` in the
tradition of `healsCasterForHalf` and `outlivesCasting`.

### `repeats` moved onto the rider, and its ability is the host's

SRD writes "the target repeats **the** save" — the one the spell already asked
for — so a repeat save is a property of a condition rather than of the `save`
kind, and Sunburst proves it by hanging one on a `save-damage`. The rider
carries the moment and what a success does; the ability and the DC come from
the host, because a rider naming its own would be a second place for one
sentence to go wrong.

`save` keeps its **flat** `repeats` beside its flat `condition`, exactly as
IE-001 kept `lasts` and `check` flat, and `conditionRiderOf` folds it onto the
first rider. Onto the *first* and not onto each: one boundary owes one save,
whatever the failure imposed.

**A host that rolled no saving throw has none to repeat**, and the type cannot
say so, because one `ConditionRider` is shared by all four hosts — which is the
point of it. `checkSpellDefinition` refuses `repeats` on a rider hosted by an
`attack` or a `condition`, which is the argument the `condition` kind's own
docstring had been making in prose since that kind arrived.

### Three places enforce that a rider is a leaf, because one is not enough

| Where | What |
|---|---|
| the type system | `ConditionRider`, `ModifierRider` and `DelayedDamage` are closed interfaces over primitives; none references `SpellEffect`, `targets` or `area` |
| `checkShape` | a **denylist**: nothing below an effect may carry `effects`, `targets`, `targetsWithin`, `area`, or a `kind` in `EFFECT_KINDS`, and the nesting is depth-bounded |
| `spell-schema.test.ts` | a sweep walks every catalogue effect as JSON — the spell's own list, an area trigger's, an activation's — and asserts the same of all of them |

A denylist rather than an allowlist, which is the reading `checkShape` takes
everywhere else: **a field the engine does not know is not an error.** And
`RIDER_KINDS ∩ EFFECT_KINDS = ∅` is one assertion, because a kind that were
both would be the recursion arriving through a name collision instead of
through a type.

### A rider the casting owns needs something to end it

`releaseCasting` ends a rider when the casting ends — and a definition with no
`durationSeconds`, no `durationUntil`, no `concentration` and no
`untilDispelled` **never becomes an ongoing casting**, so nothing would ever
end it. So a casting-owned `conditions` rider on such a definition must say
`lasts`, or say `outlivesCasting`; a `modifiers` rider on one is refused
outright, because it cannot say either. Fable asked whether the catalogue
already held a latent never-released condition; it did not, which is what makes
this a missing guard rather than an unreported defect.

**It is `checkGrantLifetimes`, and it is one rule over four things.** Two tasks
wrote it independently in the same tranche — once over the standalone grant
kinds, once over the riders — and what survived is the union: a `buff`, a
granted `roll-mode`, an `armor-class` and a rider are all `grantCarried`'s
answer, all one `grant_without_lifetime`, reported at the effect. Two codes for
one defect would have been the second place to get one sentence wrong, which is
the failure this file names about every duplicated rule. `grantCarried` walks
**every** condition rider rather than the first, because a plural slot is
exactly where a second offender hides behind a first that is fine.

**That is why `RiderDuration` gained a span of seconds.** Sunburst's Blinded
lasts "for 1 minute" on an **Instantaneous** spell: there is no casting
deadline to borrow and no turn in the order that means a minute.
`durationSeconds: 60` on the definition was the tempting answer and the wrong
one — it would make a flash of light an ongoing, dispellable spell.

**And a modifier rider carries no `lasts` at all.** `EffectTarget` ends a
condition instance, a casting or a feature, and **nothing ends a grant before
its casting does** — so a rider shorter than its casting is not expressible and
the type does not pretend otherwise. Phantasmal Killer's "for the duration"
fits; a future "for 1 minute" on an Instantaneous host needs a fourth
`EffectTarget` member, which is the gap this file already names for Superior
Hunter's Defense.

### `roll-mode.save` is gone, and it is what a speculative field looks like

It had **zero** users in the catalogue from the day it was written — Blur and
Beacon of Hope are the only `roll-mode` effects and neither spell asks anybody
to resist. The rider vocabulary made it redundant rather than merely unused: a
spell whose mode is imposed by a failed save writes the save as its *host* and
hangs the mode as a `modifiers` rider, which is one roll shared rather than two
spellings of one sentence. `buff.ability` stays, because Bane uses it; folding
Bane into a `save` plus a rider would need `save` to permit no condition at
all, which is a change with no rules gain.

### Order is fixed in one place, and no test can hold it there yet

Conditions, then modifiers, then delayed — decided once in `applyRiders` rather
than by whichever host branch a reader happens to be looking at. Nothing in the
engine can see the difference; the audit trail can.

**And no fixture pins the cross-slot half, which is worth saying rather than
implying.** No castable definition carries two slots at once, so a mutation
swapping the two loops changes no event anybody can produce — and a homebrew
definition carrying both would validate and still not be castable, because
`definitionFor` reads the catalogue rather than state. What *is* driven is the
order **within** a slot: Phantasmal Killer's two grants and Hideous Laughter's
two conditions each land in the order their SRD sentence names them.

### What a settled outcome still may not carry

Each is a named missing piece rather than a vague edge, and none of them is
excluded for being large:

| Missing | Wanted by |
|---|---|
| A rider on the outcome of the host's **damage** — a third axis, save → damage → 0 Hit Points | Disintegrate, alone |
| A rider that names targets or an area | Ice Knife, Chromatic Orb — both different mechanisms |
| A rider on the **success** or the **miss** branch | Flesh to Stone's "its Speed is 0", Ray of Enfeeblement |
| Ending another casting, or breaking somebody's Concentration | Sleet Storm |
| Forbidding or compelling an action | Shocking Grasp, Slow |
| A granted Speed or a push | Ray of Frost, Hypnotic Pattern, Thunderwave |
| A granted **Resistance** as a rider — the effect kind exists and rides no outcome | no SRD spell; Stoneskin needed the effect and not the rider |

**The rule for admitting a future rider is stated rather than a slot being
reserved.** A primitive may become a rider member **iff** it is a leaf — rolls
no d20, names no target, spends nothing, opens no window, touches no state it
did not create — and its lifetime is the casting's or a `lasts`. A closed union
reserves nothing: do not add a member ahead of its primitive; add it *with* the
primitive and its validator line.

### `OngoingSpell.on` has one rule, and the caster branch was a second one

**A casting is on a creature while it has a live effect there that the casting
owns.** `alsoOn` has applied that since persistent areas landed, and
`expireEffects` reads it in reverse. The record's own write applied a *different*
rule in one branch: a Range: Self casting was recorded as `[casterId]` and
`held` — every creature the casting had just put something on — was thrown
away.

SRD Sunbeam is the spell that meets it. The beam comes out of the caster, so
the casting is on them; it also blinds whoever the Line catches, and that
Blinded is a condition the casting owns and will take away again. A Dispel
Magic aimed at the blinded creature found nothing to end. One rule now: **the
caster, and whoever the casting is holding something on.**

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

### A Condition With No Saving Throw Is The `save` Shape Minus The Roll

SRD Greater Invisibility, whole: "A creature you touch has the Invisible
condition until the spell ends." No save, no attack, nothing to throw — so the
`condition` effect throws nothing. No die, no `roll-recorded`, no
`rolls-issued`, and the generator does not move, because a spell that asked for
no roll must not consume one.

**There is deliberately no `repeats`.** A repeat save is the SRD's "the target
repeats the save", and a spell that offered no save has none to repeat. No
candidate writes the sentence, and a field with no user is a guess — the
argument `RiderDuration` already makes in the other direction. What the shape
*does* keep is `check`, because "a creature can take an action to make a
Strength (Athletics) check" is a different sentence and a real one.

That argument is now a **validator rule** rather than a docstring. `repeats`
moved onto `ConditionRider`, which all four hosts share, so the type can no
longer say it — and `checkSpellDefinition` refuses it on a rider hosted by a
`condition` or an `attack`, both of which roll no saving throw. See "A Settled
Outcome Carries Riders, And A Rider Is A Leaf".

**It is the fourth consumer of one `ConditionRider`, not a fourth spelling of
one.** `attack`, `save-damage` and `save` each imposed a condition through a
near-identical block, and the subsets they read were an accident of the order
the spells were written in: an escape check reached two of the three,
`outlivesCasting` reached one. One rider type, one option-building helper
(`riderOptions`), one schema reader, and a field now works wherever a rider
does. `save` keeps its **flat** layout — changing it would rewrite thirty
definitions for no rules gain — and `conditionRiderOf` is the one place that
knows, so the vocabulary is shared even though the layouts are not.

**Two spells, and they differ by one sentence.** Greater Invisibility is
verified; Invisibility adds "The spell ends early immediately after the target
makes an attack roll, deals damage, or casts a spell", which is
`a-casting-ended-by-a-trigger` — the same debt Animal Friendship and Mage Armor
already carry — so it is **partial**, derived rather than declared.

**And that is the whole population**, which is worth writing down because it is
the second measured finding in a row that the existing shapes are drained. A
pass over all 211 undefined SRD spells — every one whose prose names any of the
fifteen conditions and offers no saving throw anywhere, twenty-seven of them —
leaves only these two. The rest are blocked, and never on this shape:

| Blocked on | Spells |
|---|---|
| A thing with its own state | Conjure Fey, Mirror Image, Mislead's illusory double, Arcane Eye, Clairvoyance, Unseen Servant, Instant Summons |
| Condition **removal** — its own effect kind, now **built**, and Lesser Restoration executes on it | Power Word Heal, Heal, Mass Heal, Greater Restoration, each still blocked on the *other* half of its sentence |
| Condition *immunity* or prevention | Mind Blank, Heroism, Freedom of Movement, Heroes' Feast, Hallow |
| A casting ended by a trigger | Sequester, and Mislead again |
| A condition that ends when its holder leaves an area | Silence's "Deafened **while entirely inside it**" — the gap Web's Restrained already records |
| A long casting time | Astral Projection, Awaken, Wind Walk, Hallow, Heroes' Feast, Clairvoyance, Instant Summons |
| Reading a condition rather than imposing one | Find Steed, Shining Smite, Mirror Image |
| A world the engine does not model | Meld into Stone's Prone on being expelled from the rock |

Silence and Mislead are the two the brief named that no prose scan for "has
the X condition" catches, because the SRD writes them as "creatures **have**
the Deafened condition" and "you **gain** the Invisible condition" — which is
why the census above is by condition name rather than by that phrase.

### And A Spell That Takes A Condition Away Is Not That Shape Inverted

Condition **removal** is the line that census names first, and it was a missing
shape for the reason this file has now recorded fourteen times: **the
arithmetic existed and nothing could reach it.** `removeConditionInstance` has
been correct since conditions remembered why, and `useHealingTouch` has removed
a named condition wholesale for Lay On Hands since pools learned to buy things
— and no spell could touch either. `end-condition` is the effect kind that
does, and the removal beneath it is `endConditionsOn`: **one function, two
callers**, so the reading the SRD insists on is preserved by being shared
rather than by being remembered twice.

**The SRD removes *the condition*, not a cause of it.** "You touch a creature
and end the Poisoned condition on it" names a condition and says nothing
whatever about what caused it, so an ally poisoned by a serpent *and* by a bad
oyster is not half-cured. Omitting the source is how the reducer is told:
`removeCondition` lifts every instance of the name, and each instance takes the
conditions it implied along with it. That was already Lay On Hands' reading,
and it is a *shared implementation* rather than a shared sentence — the
mutation that proves it is replacing the extracted call with a fresh removal
that names a source, which fails Lay On Hands' own tests as well as the
spell's. Both sides go red, which is the only thing that distinguishes one
implementation from two that happen to agree today.

**It is not `condition` with a sign on it**, and folding the two together would
have been the mistake. A condition imposed carries a `ConditionRider` — a
deadline, an escape check, a repeat save, a casting link — and every one of
those is a fact about something still running. A removal has no duration to
give, nothing to escape from, and nothing for the casting to own, so it carries
no rider and cannot host one. That is also why it is the effect kind
`grant_without_lifetime` has nothing to say about: it grants nothing.

**Nothing to cure is an outcome, not an error and not an event.** The casting
happened and the slot went; what the log must not carry is a
`condition-removed` for a condition that was never there, because that is a
record of something that did not happen. So the branch asks `reasonsFor` —
what there is to remove, of the instances `removeCondition` actually acts on —
and reports `affected: false` with no events at all. The derived name list
agrees with that today and `hasCondition` does not: it special-cases Exhaustion
as a *level* rather than an instance, so it would report a removal that
`removeCondition` could never make. No registered spell ends Exhaustion, which
is a reason to ask the direct question rather than to lean on the agreement.
`SpellTargetOutcome.ended` is a field of its own rather than a sign on
`conditions`: a reader asking whether a spell made somebody Poisoned must not
be told yes by a Lesser Restoration.

**And the casting a removal leaves behind is on nobody.** A casting is on a
creature while it has a live effect there that it owns, and a removal owns
nothing — so Protection from Poison's hour is an ongoing record with an empty
`on`, and a Dispel Magic aimed at the target finds nothing to end. That is the
engine's answer rather than the book's, and the two unmodelled clauses are what
make it so: build either and the casting will own something there, and `on`
will say so with nothing in the definition changing. It is asserted rather than
described, because the definition's own docstring claimed the opposite until a
review read the code.

**Two spells, and the pair is what makes the shape a shape.** Protection from
Poison names its own condition, so a list of one is the whole sentence and
nothing is chosen; Lesser Restoration names four and lets the caster pick.
**That "one" is not executed** — a choice made at the casting is a named
missing shape, the same one Blindness/Deafness carries from the other side — so
the engine ends every one of the four it finds, and the definition's own clause
says so where `spell-honesty.test.ts` can hold it. The fixture that discovers
the difference is the one where the ally has **two** of the four: with one in
play, "every condition" and "the first one" are the same events, which is how a
mutation ending only the first survived a whole file.

Protection from Poison's other two sentences are debt with names, and both
shapes are new entries in the adjudication map: a **save keyed to a named
condition** rather than to an ability — `RollModifier` selects a save by
ability and by nothing else, and CLAUDE.md has listed this exact spell under
that gap since the roll vocabulary landed — and a **Resistance a spell grants**,
since `defenses` is written when a creature enters the game and no effect adds
to it for a while.

**Heal is the third consumer and is deferred**, measured rather than assumed.
It ends three conditions at once, which this kind already expresses, and
restores a flat 70 — and `DiceScaling.dice` is required, with `parseNotation`
refusing a count below one, so `0d6` cannot stand in for "no dice". Making it
optional is not a one-line format question: `scaledDiceFor` splits it
unconditionally and six resolution paths hand its result to `rollSpellDice`,
and the same change would make flat-only *damage* expressible with no consumer
— which is the speculative-member failure the format's own sweep exists to
catch.

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

### A Feature Definition Is Validated Data Too

`feature-schema.ts` is `spell-schema.ts` pointed at the twelve class files, and
it exists for the reason that one does: a class file is pure declarative data,
the compiler was the only guard on it, and **every claim a definition made
about itself was believed**. The nine features that said "declared as a pool"
and declared none are the record of what that costs.

`checkFeatureDefinition` returns every problem with a path on each,
`parseFeatureDefinition` takes `unknown` and is the `Result` half, and the two
guards stay apart on purpose: `class-pools.test.ts` asks whether a feature's
**note** is honest, this asks whether its **declaration** is coherent, and
`creation.ts` asks whether *this character* may take it. Every rule was run
against the whole population before it was written and none of them fires —
the seven caught no defect, and the three things they *found* are below.

**Rule 4 is the one with teeth, and it is derived rather than listed.** The
question is whether an `engine` feature declares anything the engine reads, and
the readable set is computed from `standing.ts`, `creation.ts` and
`commands/features.ts` themselves — comments stripped, because
`progression.ts` names every grant kind in prose several times and a probe that
counted a docstring would report that everything is read and check nothing. A
hand-written list is the claim this repository has had falsified four times,
and rule 4 is *about* a claim nobody checked.

**Its blind spot is stated rather than exempted away.** Ten `engine` features
declare nothing on themselves and are executed anyway, through a declaration on
their **class**: the eight spellcasting features, which `ClassSpellcasting`
carries — derived from that block rather than typed out, so a thirteenth
casting class needs no edit — and the two "Improved X" features, which are a
step in an earlier feature's dice table. The second pair is what would end when
`FeatureGrant` gains a member for a later feature restating an earlier one's
column, which is `progression.ts`'s owner's to add. The exemptions are held in
**both** directions, so a rule that stopped firing fails rather than sitting
there.

**The shape check covers what the rules dereference, and the first version did
not — which is this task's own subject arriving in the task.** It checked the
five scalar fields, so `parseFeatureDefinition` answered a JSON blob with a
`TypeError` three ways over: `grants: null` reading `.kind`, a string `fixed`
on `.forEach`, a numeric `usesByLevel` on `.findIndex`. A docstring claimed "a
caller handing over a JSON blob gets the same answers as one handing over a
compiled constant" and nothing checked the claim, which is precisely the
failure the module exists to prevent. `checkFeatureShape` now reads every field
a rule touches and stops there — an unknown extra field is still data a later
engine understands rather than data that is wrong — and **rules-legal refusals
are values, not exceptions** is what makes that a defect rather than a nicety.

**A probe coarser than the thing it reads must pin its collisions, and two of
them were real.** `FeatureGrant`'s `recovery` arm carries a *nested* union —
`restores: { kind: 'pool' } | { kind: 'pact-slots' }` — so reading every
`readonly kind:` in the declaration invents `pact-slots` as a member nobody
could ever write, which is the one thing a guard must not do; the arms are
split on their own indentation instead. And `grantsFeat` declares an inline
optional `spellList` **on the same line**, so indentation cannot separate those
two and the field probe anchors to the start of a line. Both are driven over a
synthetic declaration they must read exactly.

### Three things the validator found, none of them a rule it enforces

**`grantsSubclass` has twelve writers and no reader at all.** Every class sets
it `true` on the feature that opens its subclass, and nothing in any reader
dereferences it: `creation.ts` decides a subclass is due from
`ClassDefinition.subclassLevel` and asks for it through the feature's own
`choice: { kind: 'subclass' }`. So it is a third place recording what two other
declarations already say — the "two answers to one question" failure this file
keeps naming, arriving in the feature format. Removing it belongs to
`progression.ts`'s owner, so the sweep **reports** it, in both directions, and
the twelve writers stand: deleting a field's only writers while the field
itself remains is worse than leaving them.

**A fixed spell grant is deliberately off the class's own list, and a rule
requiring otherwise would have deleted SRD content.** SRD Fiend Spells: "when
you reach a Warlock level specified in the Fiend Spells table, you thereafter
always have the listed spells prepared", level 3 — "Burning Hands, Command,
Scorching Ray, Suggestion". Three of those four are on no Warlock list, and
Draconic Spells does the same with Command: handing you spells the class does
not otherwise get is the *entire point* of a subclass spell grant. Four of the
engine's fifteen fixed grants are off-list and all four are correct. So the
rule checks **existence in the parsed book** — which is what catches a typo in
an id nothing else validates, because a fixed grant is the feature's own answer
and never meets a character's choices — and the counterexamples are asserted
rather than described, so a future rule meets them. The class-list check that
*is* right is the one `checkEvocationSavant` already makes, on a grant the
player **chooses** from.

**A subclass feature's namespace is not a class id, and that is a live wrong
number.** `classLevelFor` derives the class from `featureId.split(':')[0]` and
falls back to `choices.level` — the *starting* class's level — when no class
has that id. A subclass id never does. Its own docstring names the case it gets
wrong: "a multiclassed Bard's inspiration does not grow with their Fighter
levels", which is true of `bard:bardic-inspiration` and false of
`college-of-lore:cutting-words`. A **Fighter 5 / Bard 3** of the College of
Lore is handed a **1d8** Cutting Words die; SRD gives a Bard 3 a d6, and d8
arrives at Bard level 5. The direction matters: a Bard 3 / Fighter 5 is
accidentally right, because the fallback reads the starting class — which is
the same discriminating fixture this file already records for "half your
*Sorcerer* level", met a second time from the other side.

Two subclass features size a pool today and both do it from an ability
modifier, so no *pool* is wrong yet; `open-hand:` and `berserker:` are the two
namespaces that do not even match their own subclass id. The rule that would
catch all of this is not in `feature-schema.ts`, because its only violators are
correct data whose fix is in `creation.ts`: a feature whose grant reads a class
level must be reachable from a class, and where that is read is the thing to
change.

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

**It is still a spell that is running, though, and for a while it was
invisible.** `persists()` asked for a Concentration or a deadline, so a spell
with neither looked exactly like an Instantaneous one and left no ongoing
record at all — which is the one thing that makes a casting findable, by Dispel
Magic or by anything else asking what is in the air. `untilDispelled` is the
bit that tells the two apart; the record it produces carries no timer, because
there is no moment to schedule. The oracle holds the flag against the printed
duration in both directions, because the parsed book already distinguishes
`Instantaneous` from `Until dispelled` and a definition claiming the wrong one
is exactly the sort of thing nothing else would notice.

**A tracked spell's numbers are as easy to get wrong as an executed one's, and
less is watching.** `coverage.test.ts` checks name, level, school, casting time
and Concentration against the parsed book; the *duration* has no automatic
check, so every one is quoted from the SRD in its docstring and at least one is
driven past its deadline by a test.

### The same guard, pointed at the spells the engine executes

The tracked bucket was never where most of the `unmodelled` prose lived.
**Fifty-eight of the eighty-two executed definitions carry clauses and nothing
read one**, so a frozen statue and a puff of dust sat beside "the target cannot
regain Hit Points", "the save has Advantage if you or your allies are fighting
the target", a Hit Point maximum reduction and three Difficult Terrain areas —
every one a rule the engine owns, filed as narration. `spell-honesty.test.ts`
is the same guard reaching that population, and it differs in exactly one way
that matters: **the text scanned is the clause, not the SRD paragraph.** An
executed spell's paragraph is mostly executed, so scanning it would demand an
adjudication for the very dice the engine rolls; what is a *claim* is the
sentence the definition wrote about itself. The markers are correspondingly
wider — the book says "Advantage on" and a note about a gap says "has
Advantage if", and the narrow phrase let the audit's own examples through.

**Partial stopped being a list and became a consequence.** A spell is partial
because one of its clauses is adjudicated to a named missing shape rather than
to the table, and `PARTIAL_SPELLS` is asserted against that derived set in both
directions — one entry when it was kept by hand, fifty-three now. Two things fell
out of deriving it. **Partial and verified are different axes**: Web is driven
end to end *and* leaves its Difficult Terrain unbuilt, and the report used to
print only the tick. And each of the twenty-seven missing shapes an
adjudication may name has to say **where this repository already described
it** — this file, `PROGRESS.md`'s ranked map, the audit, or the definition's
own clause — because a shape invented in a note is an architecture decision
smuggled past review, which is the failure the guard exists to stop wearing its
other face. That is asserted rather than promised, and so is the other claim a
note can quietly get wrong: **where a note quotes the SRD it is held against
that spell's own paragraph**, because four of them quoted a sentence the book
does not print and one of those was a neighbouring spell's.

**And where a note quotes *this repository*, it is held against the document
it names.** That half was missing for a while and the gap was exactly the
shape of the other one: the guard resolved a citation by checking that a
source *name* appeared in the description, so a note could say `CLAUDE.md` and
then quote a sentence `CLAUDE.md` does not contain — which two of them did.
A citation now resolves by **naming**, through a small alias table, and the
quoted run is matched in that file after emphasis, smart quotes and wrapping
are normalised on both sides. Resolution by naming rather than by searching
the corpus is the load-bearing half, and the fixture that proves it is the
pair of sentences this repository writes two ways: a guard that checked every
known document would pass one and could never fail the other. What it caught
on its first run was three descriptions quoting a `PROGRESS.md` that had since
been re-derived — a count of 3 where the row now reads 0 / 4, and a row that no
longer exists in that form at all.

### A Consumer Count Is A Query, Because Three Documents Gave Three Answers

`PROGRESS.md`'s ranked map said a granted Resistance was **17** open spells;
the leverage audit said **4**; Fable's re-derivation from the SRD text found
**2 whole and 1 partial**. Three documents, one family, and **none of the three
was derived** — so every tranche planned from any of them inherited the error,
which is the fourth whole-engine audit's fourth finding.

`PARTIAL_SPELLS` stopped being a hand list when it became a consequence of the
adjudication map. `packages/engine/scripts/missing-shapes.ts` is the other half
of that derivation, and it is one file because the question is one question:

| Population | Map | An entry means |
|---|---|---|
| executed | `ADJUDICATED` | a definition the engine drives, carrying a clause it does not finish |
| tracked | `TRACKED_ADJUDICATED` | a definition the engine casts and resolves nothing of |
| undefined | `BLOCKED_ON` | a parsed spell with no definition at all — every one read against its own SRD paragraph |

**One vocabulary, three populations, and that is a correction.** The executed
and tracked lists were separate, with `speed-and-movement-modes` deliberately
spelled twice, and the docstring that apologised for it was right about the
hazard and wrong about the fix: kept apart, that shape counted **three spells
short**, which is the same class of wrong number the whole file exists to end.
The guards stay per-population — each still asks its own map its own
questions — and the one guard that cannot be asked per population, *no shape
sits unclaimed*, moved to `blocked-on.test.ts` where it can ask all three.
Asked of one map it would delete every shape only the others name.

**Two numbers, not one, and the difference is the finding.** `blocks` is every
spell a shape touches; `unblocks` is the spells it is the **only** blocker
for — the ones building it would finish. Reporting only the first is how 17, 4
and 2 came to be three answers to one question. **Neither figure is written
down here**, and that is deliberate: a per-shape count in prose that nothing
regenerates is the thing this section is about. `COVERAGE.md`'s "What blocks
the rest" prints both for every shape.

### The query predicted a build, and the build corrected the query

Before IE-017 existed, this map said a granted defence was the only blocker for
exactly two spells — **Stoneskin and Mind Blank** — which is Fable's "2 whole,
1 partial" reproduced from data rather than quoted. IE-017 then built that
shape, independently. The result is the strongest evidence the derivation is
worth trusting and the sharpest correction in it:

| Predicted | What happened |
|---|---|
| Stoneskin finished | **defined and verified** — right |
| Mind Blank finished | still undefined — *wrong* |
| Protection from Energy partial | **defined and verified** — also wrong |

**Both misses are one mistake, and it is a bundle in this very vocabulary.**
`a-defence-a-spell-grants` claimed condition Immunity was "the same storage and
the same sentence shape"; IE-017 built `CreatureState.defenses` a third input
and touched `conditionApplicability` not at all — the line this file already
draws everywhere else, where a stat block "prints damage types and conditions
in one run ... which the engine treats completely differently". So Mind Blank's
"Immunity to Psychic damage **and the Charmed condition**" kept half a blocker,
and the half is now `a-condition-immunity-a-spell-grants`. And Protection from
Energy's chosen damage type turned out to be expressible already, because
IE-017 gave `damageTypeStated` the second user its own docstring had asked for.

A count is only as good as the shape it counts, and the way to find out which
shapes are bundles is to build one. That is the same lesson the audit drew from
three rankings disagreeing, arriving from the other direction.

**A shape being built is content work on this map, not a merge.** Three
landed in one tranche and every one needed the entries re-read rather than
find-and-replaced:

| Built | What it reached | What was left |
|---|---|---|
| IE-014's `end-condition` | a printed list of condition names | Greater Restoration's "1 Exhaustion level" — a level is not a condition, so `an-exhaustion-level-a-spell-changes` |
| IE-017's `damage-defense` | damage Resistance, Immunity, Vulnerability | condition Immunity, which is a different table |
| IE-019's `againstType` | a save's automatic failure or Disadvantage, and extra attack dice | an automatic **success**, a filter on the *attacker's* type, and a type predicate an area reads |

Each retired its bundle id and left a narrower one behind, and in each case the
narrower id is the honest residue rather than a rename: the guards name the
entries, and reading them is the hour that separates the two.

**Where the prose and the SRD disagreed, the SRD won.** Three claims in this
file did not survive reading the paragraph, and the largest is a whole row.

**No 2024 Conjure spell prints a stat block.** This file's "A stat block
created mid-fight" row said "the four Conjures" — and there are six of them,
Animals, Celestial, Elemental, Fey, Minor Elementals and Woodland Beings, not
one of which prints an Armour Class, Hit Points or a turn. 2024 rewrote the family
as *spirits*: a pack, a pillar of light, an Emanation, a point you strike
from. So the row is wrong about all six, and **Conjure Fey is blocked on
nothing at all** — it appears at a point, makes one melee spell attack from
it, and moves thirty feet on a later Bonus Action, which is Spiritual Weapon's
shape exactly. It is the only undefined spell in the book the existing kinds
fully express. The other five are blocked, but never on a stat block: Conjure
Animals and Conjure Celestial want an area that comes along when the caster
walks, Conjure Elemental a save the trigger gates on the spell's own state,
Conjure Minor Elementals a rider on the caster's attacks, and Conjure Woodland
Beings an action a spell grants. The row is right about Unseen Servant, Arcane
Hand, Phantom Steed, Summon Dragon and Giant Insect, every one of which prints
an Armour Class and Hit Points.

**Faithful Hound is in that row too, and is also a point** — "intangible and
invulnerable"; what blocks it is the bite at the start of each of the
*caster's* turns and the ending when the two drift 300 feet apart.

**And the ranked map's smallest entry is one short.** "Reads the target's
current Hit Points | 3" comes out at **four**: Aura of Life is the fourth,
and it is in that map's own population. A three-spell family counted by hand
was still wrong.

**The largest blocker in the book is a casting time**, and it is also the shape
that **finishes** the most — more than any other, by a wide margin. A casting
of a minute or more is refused, so those spells cannot be cast at all, and for
a good many of them that is the only thing standing in the way. None of the
three rankings had that, and none of them would have predicted it. The two
figures are in `COVERAGE.md`'s table and not here, for the reason the section
opened with; `blocked-on.test.ts` pins the *rank*, which is the claim this
paragraph is actually making.

**Three bundle ids are gone.** The audit found that
`outcome-scoped-child-effects`, `a-mode-on-the-save-a-spell-forces` and
`a-repeat-save-beyond-the-turn-hook` were not shapes but bundles. IE-010
removed the first when the rider vocabulary it named was built — and **removed
it rather than renaming it**, because re-filing its last claimant left a shape
nothing was blocked on, which the guard deletes. The other two are split here:

| Bundle | Became |
|---|---|
| `a-repeat-save-beyond-the-turn-hook` (11 adjudications over 9 spells) | a save on the clock, a save counted to a tally, a save whose **failure** branch acts, and a save raised by a trigger |
| `a-mode-on-the-save-a-spell-forces` (6) | five clauses to `a-fact-only-the-table-can-declare`, one to `an-outcome-that-varies-by-creature-type`, and the id kept for the clause that genuinely needs a save to remember its provenance |

**The split is checked as arithmetic, because the complaint was arithmetic.**
`SPLIT_BUNDLES` records the exact `[spellId, clause, wentTo]` triples each
bundle held, and a test looks every one up in the map as it stands and asserts
it is still filed where the split put it. A re-filing that lost one, or that
quietly re-worded a clause to duck the question, fails. The audit called the
first bundle "a shape with eight"; it is **nine** spells, and that one-off is
the finding in miniature.

**A held clause may leave the map, and there is exactly one honest reason.**
IE-019 built `an-outcome-that-varies-by-creature-type` and executed Shatter
with it, so that clause is no longer an adjudication at all — which is not a
lost fact but the destination having been *built*. The test takes that branch
only when the shape is gone from the vocabulary: a clause that vanished while
its shape still stands is a silent loss and fails. Recording where each clause
*went* rather than a list of destinations beside them is what makes that
checkable, and is the same rule as everywhere else here — a second list is a
second place for one fact to be wrong.

**`a-mode-on-the-save-a-spell-forces` survived with zero executed claimants**,
and would have been deleted by the guard if the undefined population had not
claimed it. Protection from Evil and Good is what keeps it: "the target has
Advantage on any new saving throw against the relevant effect" needs a save
that remembers what it was against, which is the sentence that has blocked
Countercharm since it was written. The five Charm and Dominate clauses that
used to sit there want a *fact* instead — "if you or your allies are fighting
it" — which is exactly why the audit found C2 made zero consumers whole.

**An empty list is an answer.** A spell blocked on nothing the engine owns is
recorded as `[]` rather than omitted: it says the engine could take that spell
today, tracked at least, and nobody has written it down. `blocked-on.test.ts`
pins that set **by name rather than by size**, because a count in prose is what
this section is about — and because the names are what a reader wants:
Conjure Fey, Create or Destroy Water, Dancing Lights, Darkness, Daylight,
Druidcraft, Elementalism, Fog Cloud, Programmed Illusion, Purify Food and
Drink, and Zone of Truth. Light, obscurement and a fiction trigger are why
most of them are there — all three are clauses the guard's own marker list
already leaves alone by name.

**A spell offering a choice of branches is in that set only while every branch
is fiction**, and the pair that draws the line is Druidcraft against
Thaumaturgy. Both pick one of several minor wonders; not one of Druidcraft's
is arithmetic, so the choice decides nothing the engine would have to record.
Thaumaturgy's *Booming Voice* grants Advantage on Charisma (Intimidation)
checks, which `roll-modifiers.ts` expresses exactly — so **its** choice does
decide something, and the spell is not in the set. That was got wrong once and
is written down for it.

**The completeness guard is driven by a synthetic case.** `coverageGaps` takes
the parsed list and the defined set as arguments rather than reading them, so
the test can hand it a catalogue containing a spell nobody has read and assert
it is reported. A guard that can only be run against the data it already agrees
with is not a guard — the lesson `animals.md` taught the parsers and
`invariants.test.ts` applies to every sweep.

### What a cast refuses, and what it admits it cannot check

Refused: a spell with no executable definition, a spell the caster has not
prepared and knows from nothing else, no targets, a duplicate target, a
stranger, more targets than the slot allows, a target out of range, a target
behind Total Cover, a target of the wrong creature type, no action left, no
slot left, no free casting left, and casting at all while a turn-boundary save
is outstanding.

**The creature type a spell demands is checked, and a type nobody has stated is
asked for.** This list said the opposite for a long time — that `CreatureState`
carried a sheet and no type, so Hold Person's "Choose a Humanoid" came back in
`unverified` — and that stopped being true when the type became authoritative.
It is now read at the outcome as well as at the target; see "An Outcome That
Varies By What The Target Is".

Reported rather than refused, in `unverified`:

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
- **Healing restores hit points only.** Revivify raises the dead and Aid raises
  the maximum — two more shapes, neither of them here. Ending a condition is no
  longer among them: it turned out not to be a *healing* shape at all but its
  own effect kind, which is why Lesser Restoration executes and Heal, which
  does both in one sentence, is still blocked — on the flat-only healing half
  rather than on the removal.
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

A `ContextRequest` says what is missing, which rule wanted it, and the
**command** that would establish it. It is addressed to the orchestrator, never
to a player: "sorry, that creature has no position" is the engine's problem leaking
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

**That paragraph was a rule this file stated and the code did not keep**, and
what closed the gap was a sweep rather than the six fixes. Seventeen requests
named an *event* — "a scene-set event", "a creature-placed event for …", "a
sight-declared event from … to …", a bare `'creature-placed'`, and one that
said `'placeCreature'`, which is the **pure function** rather than the command
(`placeCreatureInScene`) and is exactly the trap a reader copying the nearest
string falls into. A tool surface branching on `satisfyWith` was being told to append an
event, which is the one thing the layer above the engine must never do:
appending one is the model asserting a mechanical fact directly. It was not a
hole in the rules but a hole between the rules and anything that could reach
them, and it had already closed without anybody noticing — IE-012 built the
eight scene commands and IE-016 the nine declarations, so every fact named
here has had a command for two tranches, and the prose went on naming the
event.

So `invariants.test.ts` reads every `satisfyWith` in `commands/` and fails
unless it names something the `commands.ts` barrel publishes — the same list
the action-economy and idempotency sweeps read, for the same reason: a helper
`export`ed so a sibling may call it is not a command. Driven over a synthetic
`satisfyWith: 'a scene-set event'` it has to catch, like every other sweep in
that file.

**The match is on a word boundary, and the reason is not the tempting one.**
The question the sweep asks is **directional**: does this request's *text*
contain a published command name? `'placeCreature'` is caught because that text
contains none — `placeCreatureInScene` is the only published name in its
family. The containment running the other way is real and irrelevant:
`placeCreatureInScene` *does* contain `placeCreature`, and nothing ever asks
that, because `placeCreature` is not a command to be looked for. So the
boundary does nothing whatever in that pair, and the first draft of this sweep
claimed it did. Review caught it twice — once for crediting the boundary, and
again for justifying the correction with a symmetry that is itself false —
which is the second and third time in this file a guard has been explained by a
mechanism that was not the one doing the work. What the
boundary really stops is a longer identifier that merely *contains* a command's
name passing as that command, and the collision is live rather than
hypothetical: three barrel names are strict substrings of other barrel names —
`equipItem` inside `unequipItem`, `resolveAttack` inside `resolveAttackDamage`,
`endFeature` inside `extendFeature`. So the fixture is `'an unequipItem
command'` held against `equipItem`, which only the boundary rejects, and the
nesting is **measured off the barrel in the same test** rather than asserted,
so the case cannot quietly stop being a real one.

**`route` passes on the rule rather than on an exception**, which is what makes
it safe to have the odd kind at all: it is satisfied by re-sending the same
command, and it *names* that command, so the ordinary check accepts it. A
special case for it would be a hole shaped like an exemption — anything
whatever could then be written in a `route` request — so the test pins the
other direction too, with a route-shaped string that names no command and is
caught.

**One request names an event on purpose, and inventing a command would have
been worse than leaving it.** `unknownCreature` says "a creature-added event
for …" because adding a creature has no command: `createCharacter` in
`creation.ts` emits it, predates the command layer, takes no `CommandIdentity`
and reaches the outside through `index.ts` rather than through the barrel. It
is a written exemption in the shape the five event-type exemptions beside it
already use — naming the fact that would end it, with the test checking the
claim rather than taking it on its word. **A barrel command that adds a
creature is what ends it.**

**And `resolveMove` answered `no_scene` with a bare refusal**, carrying no
request at all, while the `sceneFor` helper further down its own module had
one — and that helper's own docstring *documented* the gap rather than closing
it. (It said "four hundred lines below" until review measured it at 323, which
is a line count in prose that nothing regenerates, so it says neither now.) Mounting and dismounting were written after `commands/scene.ts` existed and
got the request; moving was written before and kept the verdict. Every caller
in the module goes through the helper now, and the docstring says that instead,
because a comment describing a gap that has been closed is the next reader's
wrong answer.

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

The command layer produces these as coherent batches: validation lives there,
the reducer stays pure replay. That split is deliberate — commands answer "may
this happen and what else follows", the reducer answers "what does the record
mean".

Healing lifts only the `ZERO_HIT_POINTS` cause, which is the whole reason
sources exist: a character put to Sleep *and* dropped to 0 wakes from the hit
points and stays asleep.

Death that is not hit-point loss gets its own event. Damage is the wrong
instrument — a healthy creature taking exactly its maximum in damage drops to
0, it does not die.

### The command layer is a directory, and `commands.ts` is its barrel

It was one 10,149-line module with thirteen regions by its own banners, and the
third whole-engine audit (2026-09-13, §3.2) measured what that cost: one region
was 28% of the file, fifteen helpers crossed regions, four were filed where
nothing called them, and **every task that touched a mechanism collided in this
one file** — which is what the workflow's one-owner-per-primitive rule
serialises. Two mechanism tasks in different domains can now run beside each
other.

**The modules form a DAG, and that was not obvious in advance.** The
declaration-level value graph inside the old file turned out to have no cycles
at all — 148 value declarations, 148 strongly connected components — so an
acyclic module layout existed; the work was finding boundaries that respect a
topological order rather than the banners, which do not. Three modules are
where the difference shows:

| | |
|---|---|
| `commands/command.ts` | the creature reader and the stranger refusal, called from all thirteen old regions — so leaving them in any domain would have made that domain a dependency of every other |
| `commands/holds.ts` | every engine debt — a declared move, a held attack, a damage roll or test awaiting Reactions, a pending casting, owed saves, owed area effects — with `mayAct` and `unsettledRefusal`, which read them. A debt is read by the commands that did **not** create it |
| `commands/damage.ts` | damage that has been rolled and not yet applied. A weapon attack and a spell both reach it, and both are above the Reactions that reduce it, so it sits under `attacks.ts` and `reactions.ts` and over `casting.ts` |

Two more are worth naming because the single file had hidden them:
`commands/activation.ts` sits at the *top* of the stack rather than beside the
ongoing-spell queries, because acting through a spell resolves effects *and*
settles what they owe; and `rollInitiativeFor` turned out to be filed at the end
of the spell region, where nothing about it belonged, and is now
`commands/initiative.ts`.

**The barrel enumerates rather than stars**, and that is the whole point of the
file. A helper is `export`ed in its own module so a sibling can call it, and is
*not* a command — before the split those were the same word, because there was
one file, and `export *` would have made `landDamage` and `castOrRelease` part
of `@ie/engine`. `commands.ts` is where the two are told apart, `index.ts`
exposes the same 118 names it exposed before, and **`invariants.test.ts` reads
that list** to know which of the modules' exports its sweeps are about.

**A sweep over several modules reads them as one string.** The action-economy
closure is transitive — `resolveAttack` spends through `damage.ts` and
`casting.ts` — so asking each module on its own stops the walk at the import
that carries it, and four spenders vanish for no better reason than which file
they came to live in. The module list itself is a directory listing rather than
an array, because a hand-maintained list of modules is the hand-maintained list
of commands these sweeps were written to replace, arriving one level up.

### One Resolver Per Effect Kind, Over One Named Context

`resolveEffects` was **1,008 lines** — a pre-flight, a loop over targets and
effects, and fourteen `if (effect.kind === …)` branches inside it — and it had
grown by 94 lines during the tranche in which the audit that named it was
recommending the opposite. Five more effect kinds were queued behind it. Each
would have added a branch to the same function, and each would have made every
other mechanism task wait on the same file, which is what the workflow's
one-owner-per-primitive rule serialises.

It is now the pre-flight, the loop and a dispatch — **214 lines, 63 of which
are the signature and its documentation** — plus thirteen resolvers, one per
kind, over an `EffectContext`. The sum of the parts is no smaller and was never
meant to be; what got smaller is the thing every future kind has to be added
to.

**The context names what was already closed over, and nothing else.** Every
branch reached the same dozen bindings out of the enclosing scope, so naming
them once is what lets each kind be its own function without any of them
growing a parameter list. The payoff was not obvious in advance: because a
resolver destructures exactly what its rule reads, **the difference between two
kinds is now visible in one line**. `resolveEndConditionEffect` reads `events`
and `outcomes` and nothing else; `resolveAttackEffect` reads sixteen bindings.
That is a fact about the rules that the single function could not state.

**`resolveDispelEffect` takes no `effect` at all**, and that is the sharpest
instance of it. This file has said since Dispel Magic landed that its
"definition therefore carries **no numbers at all**" — every one of them is a
fact the engine holds. The split is what turned that sentence into something
the compiler checks: `noUnusedParameters` refused the parameter, because there
is genuinely nothing on the effect to read.

**The world is deliberately not on the context.** Each resolver takes the state
its predecessors left and returns the state it leaves, because the order effects
are applied in is the loop's business, and a mutable `current` on a shared
object would hide it. `events`, `outcomes`, `held` and `unverified` *are* on
it and *are* mutable, because that is exactly what they were as closed-over
locals — the resolution's running record, read afterwards by the
`spell-ongoing` record and the return. A split that changed either would be a
behaviour change wearing a refactor's clothes.

**The dispatch is a `switch` and not a lookup table**, and the reason is the
`never` binding in its default: a record keyed by `kind` would be satisfied by
a partial one, where the switch makes a kind added to the union and not to the
dispatch a compile error rather than a wrong answer in a fight. That guarantee
is the whole of what the old fall-through chain bought, kept.

**The rider order did not move.** Conditions, then modifiers, then delayed, is
still decided in `applyRiders` and nowhere else — which is the point of that
function, and the one thing a split into thirteen pieces could most easily have
scattered.

#### The oracle was byte-identity, not the test suite alone

Every one of the thirteen bodies is the original text, and that is checked
rather than claimed. Exactly three transformations were applied, all
mechanical:

| | |
|---|---|
| six spaces of indentation | the branch body sat inside two `for`s and an `if` |
| `continue;` → `return ok(current);` | the effect loop's `continue` is a resolver's return |
| `context.from` → `from` | a field read off the enclosing parameter is a destructured binding |

Reverse those three and each resolver's body must equal the branch it came
from, line for line. It does, for all thirteen — 730 body lines in total. That
check is what a "no behaviour change" claim should rest on, because the suite
turns out **not** to be strong enough to carry it alone.

**Three mutations survive the whole suite**, and they are recorded here rather
than fixed, because a behaviour-preserving refactor whose diff also contains a
fix cannot be verified by its own oracle:

- **The one `continue` that was deliberately *not* rewritten.** Dispel Magic's
  resolver has an inner `for (const spell of running)`, and the `continue` in
  its failed-check branch belongs to *that* loop. Rewriting it the way the
  other twenty-two were would stop a Dispel Magic at the first spell whose
  check it failed, and no test says so — because no fixture aims one at a
  target carrying **two** ongoing spells and fails the first check. That line is
  now the most dangerous one in the file: it looks exactly like the lines
  around it and means something else.
- **The state threading.** Commenting out `current = done.value;` passes
  everything. Effects on one target are near-enough independent in every
  registered definition, so nothing yet reads the world a previous effect left.
- **The `from` wiring.** Never setting it passes everything: the Prone rule
  read from a casting's held point — Spiritual Weapon's seam — has no fixture
  with a prone target.

What the suite *does* cover is the context itself: a save DC wired one point
high fails three tests in three files, across both the atomic and the settled
path. So the shared context is guarded and three of the things it carries are
not, which is a more useful thing to know than "the suite passed".

### Setting The Stage Is A Command Like Any Other

**Nothing above the engine could start an encounter.** `placeCreature`,
`addLandmark`, `declareCover` and `declareSight` in `positioning.ts` and
`startCombat` in `combat.ts` were correct pure functions with exactly one
caller apiece — the **reducer**, folding an event no command wrote — and
`scene-set`, `time-advanced` and `spellcasting-declared` had no producer
outside a test fixture at all. So a caller who wanted a fight hand-wrote the
log, which is narration writing straight to truth. The twelfth recorded
instance of a rule implemented and reachable from nothing, and the largest.

`commands/scene.ts` is the eight commands, and the test that matters is the one
that was impossible before it: an encounter driven **from nothing** — three
characters created, a taproom, two landmarks, everybody placed, sight and cover
declared, the clock moved, Initiative rolled, the fight begun — with not one
event literal anywhere in it. That claim is read off the test's own source
rather than asserted, because a scenario that quietly writes one event proves
nothing about whether a caller could have got there.

Four decisions, stated rather than incidental, because **nine more DM-declared
events were the same shape** and did follow whatever this did — see "The Other
Nine Facts A DM Declares":

| | |
|---|---|
| **The command is its event's name as an imperative** | `scene-set` → `setScene`. Four are lengthened — `addSceneLandmark`, `placeCreatureInScene`, `declareSightBetween`, `declareCoverBetween` — because the pure function beneath owns the plain verb and `index.ts` exports both |
| **It refuses exactly what the reducer would call corrupt** | and nothing more |
| **A missing fact is homework, and it says which fact** | a `scene` request when there is no room, a `position` request when the *anchor* a placement is measured from is not standing anywhere — each naming a command rather than an event, and each naming a command that now exists |
| **`mayAct` is not consulted** | none of these is an action in the turn economy |

**The anchor is the half a pass-through would have lost.** "Beside the fighter"
needs the fighter to be standing somewhere, and `resolveAnchor` answers that
with a bare `unplaced` and no request — which is the right division of labour,
because a pure helper returns the kind and the command that knows which rule
wanted the fact attaches the request. Handing that refusal straight back left a
command-level `needs-context` with the "what" in a prose string, which is the
one thing a tool surface cannot branch on. The *decision* is still
`placeCreature`'s; the command only says what would settle it, and names the
anchor rather than the creature being placed — a distinction only a fixture
that places one creature relative to another can see.

**"The validation is the pure function's, not a second copy" is only a slogan
until it is made precise enough to test.** The precise form is the second row
above, and the test is that each refusal is paired with the event the command
declined to write, folded, and asserted to throw `CorruptLogError`. Two
consequences are deliberate rather than oversights. `setScene` refuses
*nothing*, because nothing about a scene can corrupt a log — a new room is a
new room, and the reducer has always unplaced everybody when one arrives. And
sight, cover and placement take creature ids and do **not** look them up,
because their reducer cases do not either; inventing the check would be the
second copy the rule exists to prevent. `declareSpellcasting` is the one that
does check, because its reducer case reads the creature and throws.

**`mayAct` had nowhere to be written down, and that is the shape of the
action-economy sweep rather than an omission.** `UNGUARDED_ON_PURPOSE` excuses
a command that *spends* something and consults nothing; these spend nothing, so
the sweep never classifies one as a spender and a name added there would have
failed its own "invents none" assertion. `DECLARED_NOT_ACTED` is the decision
in the shape the exemption lists use, derived from the module so a ninth
command fails it until somebody writes the sentence — and checked
behaviourally: every one of the eight **succeeds** against the world that
refuses every spender, which is what makes "these are not actions" a behaviour
rather than a claim.

**The stamp is declared on all eight events, and the compiler does not care.**
Excess-property checking on a union accepts a field *any* member declares, so
`{ type: 'scene-set', extent, command }` compiles whether or not `scene-set`
says it may carry one, and `recordCommand` is generic enough to remember it
either way — verified by mutation: deleting the declaration leaves
`npm run typecheck` completely silent. This file records that trap twice
already, once for a `command` stamp and once for a casting's `route`, and both
times the cost was the same: a field in the log that no reader of the type
could see. So `scene-commands.test.ts` reads the claim off both sources and
holds them against each other, which is the only thing that can.

**And `placeCreatureInScene` is where the duplicate-check trap would have been
sprung a ninth time.** Its own first run is what makes the world answer
`already_placed`, so a guard above the duplicate check tells a retry its
command was impossible when it had in fact succeeded. `once` is why there is
nowhere to write one, and the test was written before the command was.

### The Other Nine Facts A DM Declares

The other nine event types no command produced, and with them the class is
closed: **every one of the declared types is emitted by engine
code**, and `invariants.test.ts` asserts that as a derived sweep rather than
this file asserting it as a number.

They were a second family with the same shape as the scene-setup eight and a
weaker claim — none of them blocks starting a fight — so they were a task of
their own rather than a widening of that one. What they blocked is a tool
surface reaching them at all, which is the whole of why it mattered before M2
rather than during it: a tool surface calls commands and never folds events
itself, so on the day it is assembled there was no tool that could declare
allegiance, mount, dismount, spend the free object interaction, swap Initiative
for Alert, stabilise a creature, kill one other than by damage, take an item
away, or remove a bonus no casting hung.

**Six declare and three spend, and that is why they are in three modules
rather than one.**

| | Command | Lives in |
|---|---|---|
| allegiance | `declareCreatureSide` | `commands/declarations.ts` |
| Alert's Initiative swap | `swapInitiativeBetween` | " |
| a stabilisation | `stabiliseCreature` | " |
| death that is not hit-point loss | `declareCreatureDead` | " |
| an item the DM took away | `loseItems` | " |
| a bonus whose source was no casting | `removeBonusFrom` | " |
| mounting | `mountCreature` | `commands/movement.ts` |
| dismounting | `dismountRider` | " |
| the free object interaction | `useFreeObjectInteraction` | `commands/actions.ts` |

The split is not tidiness. `DECLARED_NOT_ACTED` claims that **every** public
command in the modules it names spends nothing, and checks it against the code
rather than against the sentence — so one spender filed beside the six would
have forced that list to be filtered by the spender analysis, and the filter
would have made the claim true by construction instead of by test. The three
that spend live where the budgets they draw on live, and the action-economy
sweep finds them by the closure rather than by being told.

**`mayAct` is decided per command on the rule.** Mounting and dismounting cost
"an amount of movement equal to half your Speed (round down)", and object
interactions are capped at "one free interaction per turn", so all three draw
on the turn budget and all three are guarded. A stabilisation is the *payout*
of somebody else's Help action or Healer's Kit use and that cost was spent
through its own command; a death by fiat, an allegiance, a confiscation and a
lapsed bonus cost nobody anything on anybody's turn.

**Three more pure functions nothing called, which is now the thirteenth
recorded instance.** `mountingCost` has computed half a Speed since positioning
landed and had two callers, both of them assertions in its own test.
`useFreeInteraction` and `swapInitiative` each had one: the reducer, folding an
event nothing wrote. And `swapInitiative` was worse than unreachable — it takes
both creatures' conditions so that SRD Alert's "you can't make this swap if you
or the ally has the Incapacitated condition" can fire, and the reducer passes
**neither**, so that clause could not fire at all. The command reads them off
the creatures it was given.

**The event a DM declares is not the feat's offer.** Alert's swap stays
unmodelled: nothing checks that either creature has the feat, that the moment is
immediately after the Initiative roll, or that the ally is willing. The first
two need a feature offering a choice at a moment the engine does not hold, and
willingness is fiction. What the engine owns is the arithmetic, and that is what
the command reaches.

**Two of the nine refuse more than the reducer would, and each is a rule rather
than a second copy of a check.** SRD stabilises "a creature with 0 Hit Points",
so `stabiliseCreature` refuses a creature who is not dying and refuses a corpse
— the rule `healCreature` already takes for hit points. And `loseItems` refuses
taking more than is carried, because `removeItems` folds a loss in as a
*negative quantity* and drops any line that reaches zero: five rations taken
from two silently succeeds and leaves none, which is the class of wrong number
this file calls its worst. It also refuses taking something that is **worn**,
because `items-lost` does not touch `equipped` — confiscating a chain shirt
would leave it equipped and still adding its Armour Class, which is the "chain
mail in a backpack" bug inverted. Taking it off is a decision and
`unequipItem` is where it looks like one.

**Allegiance is the fact that is deliberately *not* durable**, which is the
whole contrast with a creature's type. A type is established once and a
contradiction is refused, because Hold Person may already have been cast on the
strength of it. `creature-side-declared` exists precisely because allegiance
changes in play — a bandit is bribed, a charmed ally turns — and the reducer
overwrites rather than throwing, so refusing a second declaration would be the
command refusing something the log permits.

**A fact already true is not restated.** `declareCreatureDead` for a creature
already dead and `removeBonusFrom` for a bonus nobody is carrying both emit
nothing: neither is a thing that happened, and a log should not carry an event
saying it did. Same reading `declareCreatureType` takes for a type that already
matches.

**The stamp rides on the event that always happens.** Mounting emits a
`movement-spent` beside its `mounted` — but only in combat, where there is a
budget to spend from — so the command stamp is declared on `mounted` and
`dismounted` rather than on the cost. Fourth instance of that lesson in this
file.

### The sweeps that make the class closed rather than the instances fixed

Three derived sweeps in `invariants.test.ts` carry this, and the point of each
is that it fails when somebody *adds* something rather than when somebody
remembers to look.

**Every declared event type is emitted somewhere.** The declared types are the
`readonly type: '<x>'` literals in the union; the emitted ones are those
literals **in a `type:` position** in any runtime module under `src/` other
than `events.ts`, which declares them and whose reducer `case` labels are not
emissions. The `type:` position is load-bearing rather than pedantic: a
`ContextRequest`'s `satisfyWith` *names* an event it does not write, and under
the looser reading `creature-placed` came out emitted while nothing emitted it.
Both halves are driven over synthetic sources they must catch.

**Where the command layer is drawn changes the answer, so the sweep names it
rather than assuming it.** Read as the other sweeps read it — every module
under `commands/`, plus `rest.ts` — five types come back: `creature-added`,
`character-created`, `character-advanced`, `hit-point-maximum-raised` and
`resource-pool-resized`. Every one is emitted by `creation.ts`, which predates
the command layer, takes no `CommandIdentity` and is not published through the
`commands.ts` barrel — so it is a question about where a command lives rather
than about whether one exists. Each carries a written exemption, and the test
checks the exemption's *claim* rather than taking it on its word: `creation.ts`
really does emit all five.

**Every event a command stamps declares that it may carry one — and it reads
the stamp rather than the module.** That is what let the sweep become a
directory listing over every module under `commands/`. Scoping it by module was
fine while every event a module wrote carried a stamp, which was true of
`commands/scene.ts` alone; `commands/movement.ts` writes `movement-spent`
without one. So each `...(stamp === null` spread is attributed to the nearest
`type:` literal above it, and a module whose stamps that cannot read **fails**
rather than going quiet — one does, `commands/reactions.ts`, which spreads a
stamp onto `recordD20Test(...)` whose `type` is written inside the helper, and
it has a written exemption naming the event and asserting that event declares a
stamp anyway.

That sweep also moved: it lived in `scene-commands.test.ts`, scoped by a
hard-coded path, and a sweep about the whole command layer filed under one
family's name is the same fragility wearing different clothes. The mutation is
still the one worth repeating — **deleting a `readonly command?: CommandStamp`
from `events.ts` leaves `npm run typecheck` completely silent**, because
excess-property checking on a union accepts a field any member declares, and
`recordCommand` is generic enough to remember it either way.

### Every Refusal The Engine Can Return Is One A Test Has Seen

A rules-legal refusal is a **value** so that the layer above can read it —
"you're out of third-level slots" is something a DM narrates around. A code
nothing has ever asserted is a sentence nobody has read: its branch may not be
reachable, its spelling is pinned by nothing, and the rule it carries lives in
a string and nowhere else.

Three whole-engine audits measured that gap and got the same proportion every
time — the third 46 of 162, the fourth 41 of 112 — which is what made it a
standing gap rather than a backlog. `refusal-sweep.test.ts` is the derived
sweep that closes it, in the shape `invariants.test.ts` established: read the
source, compute a set, hold an allowlist in **both** directions so a stale
exemption fails. `refusals.test.ts` is the other half, and the more important
one — a sweep reporting forty unasserted codes and carrying forty exemptions
would satisfy every line of the first file and none of its purpose.

**The population is bigger than the audits saw, and the reason is a newline.**
`err(` and its code are routinely on two lines, because prettier breaks the
call the moment the reason is long — which is most of the interesting ones. A
line-based `grep` sees 113 codes where there are **170**, and every one of the
57 it misses is missed for no better reason than a wordy reason string. That is
the `animals.md` failure again, so the sweep matches whole files. Re-derived:
**36 unasserted, now one.**

**"Asserted" is the loose net deliberately, and the tight one was tried and
measured.** Requiring the literal to sit inside a matcher call marks ten codes
unasserted that are asserted perfectly well through a table (`code: 'no_scene'`
in `scene-commands.test.ts`, read by a loop below it) or through a helper
parameter (`reject(request, 'duplicate_target')`), and a sweep that demands a
second test for a rule already pinned teaches people to write redundant tests.
The loose net's own risk was measured rather than assumed: no code in this
repository is quoted in a test *only* as an argument to a constructed `err`.
**The sweep excludes its own file**, because an exemption whose written reason
mentioned another code would otherwise assert it, and a sweep that can satisfy
itself is not a sweep.

**A code the string net calls unasserted is not a rule nothing tests**, and
conflating those two would overstate what this bought. Two mutations say where
the line falls: dropping the cantrip-takes-no-slot guard already failed
`casting.test.ts`, which asserted the behaviour without naming the code — so
the new case pins the *code* a tool surface branches on. Dropping the
duplicate-designation guard failed **nothing in the entire suite** but the new
case. Both kinds were in the 36, and only the second kind was a hole.

**What the codes turned out to be worth** is the argument for having done it at
all: `forged_provenance` is where the Inviolable Rule is actually enforced —
only `rolls.ts` may stamp `engine` — and nothing named it. Neither did the
nine slot levels, the `#` that forges a casting link, the `NaN` amount that
makes a creature neither alive nor dead, or the fight that may not lose its
last combatant.

**Every case goes through the public API**, never the helper that contains the
`err`: a command off `commands.ts`'s barrel, or a function `index.ts`
re-exports. Calling the function that returns a code proves the string exists;
it does not prove the rule holds.

**One exemption, and it is the shape an exemption should be.**
`nothing_to_interrupt` is a defensive re-read of the Counterspell window inside
the resolution, and nothing can reach it: `triggerRefusal` answers `no_trigger`
first, the one path that skips that check is a **readied** spell, and SRD
requires a readied spell's casting time to be an action while Counterspell's is
a Reaction. Both halves are asserted in `refusals.test.ts`, so the exemption
names facts a test holds rather than an opinion. A reason must also *say*
something — the sweep refuses a bare or placeholder entry, the move
`spell-honesty.test.ts` already makes for an adjudication.

### `once` makes "the duplicate check comes first" structural

This file records **eight** occasions on which a guard was written above the
duplicate check and a retry was told about the world its own first run made:
`triggerRefusal`, six unstamped commands, the `casting_pending` guard, the
`damage_pending`/`test_pending` pair, `resolveSpell`'s half-dozen refusals, and
the `not_ongoing` refusal a route that ended its own casting met. Every one is
the same shape, and every one was caught by review rather than by the code.

`once(state, kind, inputs, replayed, run)` closes it: the body is a callback,
so there is nowhere above the duplicate check to write a guard. Every command
that called `identify` first now goes through it — forty-six of them, and
`beginRest`.

**It lives in `idempotency.ts`, not in `commands/`**, for the reason that
module exists at all: `rest.ts` needs it, and `rest.ts` reaching up into the
command layer is the one upward edge IE-003 removed. `once` is not a rule about
any particular operation, so it sits beside `identify` and everybody imports
downwards — which `invariants.test.ts` still asserts.

**Both callbacks are `NoInfer`**, so `R` comes from the command's own declared
return type. Inferring from the arguments instead would let the replay answer
and the resolved answer settle on two different shapes and check each against
itself, which is the opposite of what a command's signature is for: the two
answers a caller may receive are the same type, or the command is lying about
one of them.

`replayed` is a thunk rather than a value because two commands recover their
replay answer from `commandOutcome` — the casting id a retry still needs.

### Retry-safety has two halves, and only one is free

A pure command gives identical events from identical state. That is worth
having and it is **not** the guarantee a retrying caller needs, because a
caller retrying after its first batch was already applied is looking at
*updated* state: the slot is gone, the casting happened, the generator has
moved on. Casting again there is a genuine second casting, and the engine is
right to treat it as one.

So commands take an optional `commandId`, the event that results carries it,
and the fold remembers it. A retry with an id that has already landed returns
an empty batch.

**`idempotency.ts` holds the machinery, below the command layer**, because
none of it is a rule about any particular operation. `rest.ts` needed
`identify` and reached *upwards* into `commands.ts` for it — the one import
that spoiled an otherwise acyclic value graph, and the kind of edge that turns
into a real cycle the first time the command layer wants something a rest
knows. Everybody imports downwards now, and a test says so.

Three details make it actually work:

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
optional the way it is for the engine's own callers.

**The sweep in `invariants.test.ts` is authoritative because it is derived.**
It reads the declared return type of every command `commands.ts` publishes and
every export of `rest.ts`, and classifies it: `Result<GameEvent[]>`, or a
`Result<X>` whose `X` carries an `events` field, hands the caller events. Every
one of those must be run twice under one id — the second run emitting nothing at
all — or carry a written reason for taking no id. A **union** payload is
reported rather than classified, because one arm may carry events and another
may not. A named return type the classifier cannot
resolve is reported rather than skipped, because a classifier that silently
answers "no" to a shape it does not understand reports no problems and checks
nothing.

It was a hand-maintained array until the third whole-engine audit
(2026-09-13), and silent in both directions: five commands called `identify`
and were absent from it — `resolveAttackDamage`, `activateFeature`,
`castSpell`, `resolveDamage`, `beginRest` — and two event-returning exports
took no id at all. Both now have one: **`resolvePendingSaves`**, whose stamp
rides on `rolls-issued` because that is the only event it always emits, and
**`removeCreatureEverywhere`**, whose stamp rides on `creature-removed` for the
same reason. The DM-facing four that were unguarded — `applyConditionTo`,
`endConcentration`, `setExhaustionLevel`, `grantTemporaryHpTo` — were guarded
earlier.

**A third was exempted with a sentence that was not true**, which is the
failure a derived sweep is most exposed to: the list is only as good as its
reasons. `restoreResourcesOn` was excused as "idempotent by construction — a
pool restored twice is a pool restored", and that is the *whole refill* branch.
SRD's partial rule is the other one: "you regain **one** expended use when you
finish a Short Rest" subtracts from `spent`, so a retried restoration hands
back two uses of Rage, Second Wind, Channel Divinity, Wild Shape or Bardic
Inspiration. It has an id now, and the fixture that pins it is a pool with that
rule and two uses gone — a pool declared by hand, because every class carrying
the rule is also tagged `long-rest` and takes the whole-refill branch first.

`endRest` is the one exemption that is a debt rather than a decision: a retry
finds nobody resting and is refused, so no Hit Die is rolled twice, but the
caller cannot tell that from never having rested.

A model-driven loop retries for reasons that have nothing to do with the game —
a `pause_turn` resume, a dropped connection, a tool re-invocation after a
stream error — and an unidentified retry is a second casting that spends a
second slot and rolls a second save. The id is what makes "did that go
through?" answerable rather than a guess. The engine keeps it optional because
a test fixture or a scripted scenario has no such problem; the tool surface has
no such excuse.

### Whoever *is* the command owns the identity

`resolveSpell` was the engine's one command that established its identity
*after* half a dozen refusals — the caster's record, the definition, the
targets, the free casting its own first run had already spent. So a retry was
told about the world instead of about its own command, and a retry sent after
the caster left the game came back `unknown_creature` for a casting that had
succeeded. The eighth instance of that trap in this file, and the first in a
wrapper.

The fix is not an extra check but a single owner. `castOrRelease` calls
`identify` first, over the `CastSpellRequest` the caller actually sent, and
carries the resulting stamp down to the event that records the casting;
`castSpellWith` and `resolveCastWith` are the halves that take an identity
already established. **Two `identify` calls under one id would be two
fingerprints of two different objects** — the request, and the `CastCommand`
derived from it — and would refuse every honest retry.

Fingerprinting the request rather than the derived command is the stricter
half: a retry naming different targets is now caught, which the derived form
could not see. It needs one normalisation, and it is a rule the engine already
had: **`space` is the absence**, so a casting that spells the default out is
the same command as one that says nothing, exactly as the ongoing record
already treats it. Field order was the first instance of that idea; this is the
second.

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
  Temporary Hit Points and cover on a saving throw were the named gaps, each
  with the reason it was still open; the first two are built, and ending a
  condition — filed here as "condition-lifting healing", which is where it was
  misfiled — turned out to be its own effect kind rather than a healing one.
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
- M1 spells: how many are executable and how many tracked lives in
  `COVERAGE.md`, which is regenerated and diffed in the gauntlet rather than
  restated here; the shapes that block the rest are counted there and ranked in
  `PROGRESS.md`. The utility
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
  **And a spell can grant a Resistance** — see "A Resistance a spell grants,
  and the third input to `defensesOf`": Stoneskin, Protection from Energy and
  Protection from Poison all hand one out, it ends with the casting, and
  `EffectTarget` gained the member that lets a grant end *before* whatever made
  it — which is the half SRD Superior Hunter's Defense was missing.
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
- **The existing shapes are drained, and that is a measured finding rather than
  a feeling.** "Keep pouring spells into the working shapes" was written when
  roughly ninety parsed spells were thought to fit one; a spell-by-spell pass
  over all 211 undefined spells found **two** whose entire printed content the
  existing effect kinds express — Arcane Sword and Produce Flame, both of them
  second users of shapes that already had one. Every other candidate is blocked
  on a *named* mechanic rather than on a definition: three attack rolls from one
  casting (Scorching Ray), damage with neither an attack roll nor a save (Magic
  Missile), an outcome-scoped child effect (Ice Knife's explosion, Hideous
  Laughter's two conditions, Sleet Storm's broken Concentration), a damage type
  chosen at the casting (Chromatic Orb, Dragon's Breath — *not* Protection from
  Energy, whose choice is one of a printed list and is `damageTypeStated`'s
  second user), flat-only healing (Heal's 70, which is the *whole* of what now
  blocks it — its condition removal is built and Lesser Restoration executes on
  it), a rider on every weapon
  attack (Divine Favor, Hex, Hunter's Mark), an area that is several templates
  or a wall (Fire Storm, every Wall), and a Temporary Hit Point payout that
  repeats each turn (Heroism). **So the next spell coverage is bought by a
  mechanism, not by transcription** — which is the opposite of what the "cheapest
  coverage there is" note assumed, and is worth knowing before the next content
  task is briefed.

  **That list is now data, and four of its rows have since been built.** Every
  blocker above is a shape id in `missing-shapes.ts` and every spell above is an
  entry in `BLOCKED_ON`, so the count is a query rather than this paragraph —
  see "A Consumer Count Is A Query". The re-reading found **Conjure Fey** needs
  no mechanism at all, which makes it three spells the existing kinds express
  rather than two; and one tranche later **condition removal**, **a granted
  Resistance**, **a damage type chosen at the casting** and **an outcome that
  varies by creature type** are all built, so Lesser Restoration, Protection
  from Poison, Stoneskin, Protection from Energy, Blight, Shatter and Divine
  Smite have all left the undefined and partial populations. Do not count from
  this bullet at all; it is the prose the map replaced, kept because several
  shape descriptions still cite it.
- **Every one of the event types the union declares is now emitted by a command**, so a
  Maestro tool surface can reach all of them. It was seventeen with no producer,
  in two families: the eight that set up a world for the rules to run in — see
  "Setting The Stage Is A Command Like Any Other" — and the nine a DM declares
  mid-play, see "The Other Nine Facts A DM Declares". Neither was a hole in the
  rules; both were a hole between the rules and anything that could reach them,
  which is exactly the thing to close before M2 rather than during it.

  **The question that was deferred to M2 is answered, and the answer is the
  first of the three it was put as.** They were: a declaration command per fact,
  one general declare-a-fact command, or a tool surface permitted to append
  these events directly. The third is the one to be careful of, because
  appending an event is how the model asserts a mechanical fact. The first is
  what shipped, and the reason it did not have to wait for M2 is that a tool
  surface calls commands and never folds events itself, so these are engine
  commands whatever M2 turns out to look like. The distinction the nine were
  mixed on held all the way through: allegiance is a pure declaration and
  `creature-died`, `stabilised`, `mounted`, `dismounted` and
  `free-interaction-used` are outcomes with rules attached — three of which
  spend from the turn economy and are guarded like any other spender.

  **The claim is a derived sweep, not a number in this file.** The declared
  types are the `readonly type: '<x>'` literals in the `GameEvent` union — the
  same reading `persistence.test.ts`'s `declaredEventTypes()` uses — and the
  emitted ones are those literals **in a `type:` position** (`/type: '<x>'/`)
  in any runtime module under `packages/engine/src` other than `events.ts`,
  which declares them and whose reducer `case` labels are not emissions. Tests
  and the two golden-log generators are excluded, because hand-writing events is
  the thing being measured. `invariants.test.ts` runs it and fails naming
  anything it finds, driven over a synthetic source it must catch.

  **The `type:` position is the load-bearing half of that sentence, not
  pedantry.** It is what tells an emission from a context request *naming* the
  event that would satisfy it — `satisfyWith: 'creature-placed'` — and under the
  looser reading `creature-placed` came out already emitted, which it was not.
  That case is moot now that a command emits it for real, and the distinction is
  not: a `satisfyWith` still names an event nobody wrote, and the sweep is
  driven over a synthetic one of those too.

  Two caveats the method carries. It reads literals, so an event type assembled
  from a computed string would be invisible — there are none today, the thirteen
  non-literal `type:` sites in the engine being three damage types read off a
  value, the seven `type: string` annotations and parameters those travel in,
  and three fragments of prose. And the answer moves with where the command
  layer is drawn, so the boundary is **named rather than assumed and asserted
  rather than described**: taking it as the other sweeps do — every module under
  `commands/`, **plus `rest.ts`** — five types come back, every one of them
  emitted by `creation.ts`, whose two entry points predate the command layer,
  take no `CommandIdentity` and are not published through the `commands.ts`
  barrel. Each carries a written exemption and the test checks its claim.
  Dropping `rest.ts` from that reading adds three more — `rest-begun`,
  `rest-ended` and `temporary-hp-cleared` — which is why that is the wrong line
  to draw.

  **The count went nine, seventeen, nine, zero, and every move is an argument
  for stating a number with its method.** The first nine named only the
  DM-declared family and missed the eight setup facts; the derivation is what
  found that; the eight were built, giving nine again for a completely
  different reason; and the nine were built. The number is now a test rather
  than a sentence, which is where it should have been three counts ago.
- M2–M5: tools, DM loop, CLI harness, persistence, web app, persona
