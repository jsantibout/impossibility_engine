# InfiniteRealms — CLAUDE.md

> **This file is the constitution and the router.** It holds what an agent
> needs on essentially every task: what this project is, the invariants that
> may never be broken, who may decide what, how work is validated, and
> **which document to read before touching a given subsystem**. The
> subsystem architecture itself lives under `docs/design/` and
> `docs/rules/`, extracted verbatim from this file — see the router below.

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

## Determinism

Same seed plus the same event log must fold to a byte-identical `GameState`.
This is what makes a campaign replayable, auditable ("show me exactly why the
goblin died"), and testable at all.

`dice.ts` uses sfc32 seeded through xmur3. Its whole state is four integers, so
`snapshot()` / `restoreRng()` can persist a generator mid-combat and resume it.
Do not reach for `Math.random` — the lint rule will stop you, correctly.

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

## Where the deeper truth lives, and when to read it

CLAUDE.md is the constitution and the router. **It does not hold the
subsystem architecture any more**; that was extracted verbatim into the
documents below when this file passed nine thousand lines. Each is
authoritative for its subject, and each states the repository's own reasoning
unchanged.

**Read the document for the subsystem you are about to change. Do not work
from this file alone.**

| If you are changing … | Read first |
|---|---|
| casting, pending castings, ongoing spells, Concentration, rituals, long castings, the per-kind effect resolvers — `commands/casting.ts`, `commands/spell-resolution.ts`, `commands/spell-effect-*.ts` | `docs/design/casting.md` |
| the definition format, an effect kind, the rider vocabulary, the validator or its SRD oracle, or any spell definition | `docs/design/spell-definitions.md` |
| the event log, the reducer, the fold, state ownership, conditions, engine-owned transitions — anything under `packages/engine/src/fold/` | `docs/design/event-log.md` |
| positioning, distance, creature volume, areas of effect, persistent or carried areas, teleportation, the combat model | `docs/design/space-and-areas.md` |
| durations, deadlines, turn boundaries, turn-hook saves, rests, the clock | `docs/design/time-and-turns.md` |
| the D20 pipeline, named modifiers, advantage, individual dice, typed damage, reaction windows | `docs/design/rolls-and-damage.md` |
| character creation, advancement, class features, multiclassing, pools, inventory, monster adaptation | `docs/design/characters-and-equipment.md` |
| a rules adjudication, or the SRD parsers under `packages/srd/` | `docs/rules/srd-policy.md` |
| the orchestration layer above the engine | `docs/design/claude-integration.md` |

## Sources of truth, highest first

1. **`docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md`** — the constitutional document.
   It outranks this file. Where they disagree, the doctrine wins and this file
   is the thing that needs correcting.
2. **This file** — the invariants, the authority boundaries, and the router.
3. **The design documents above** — authoritative for their subsystems.
4. **`CONTRIBUTING.md`** — authoritative on file ownership between the two
   people who work here, and on the per-file conflict playbook.
5. **`PROGRESS.md`** — what has landed, and the known pending work.
6. **`docs/dev/WORKFLOW.md`** and **`docs/dev/QUEUE.md`** — the development
   procedure and the live queue. A task's state lives on the `state:` line of
   its own file under `docs/dev/tasks/`.
7. **`COVERAGE.md`** — regenerated, never hand-edited, and the authority on
   **every count**. No number about spells, definitions, features or blockers
   belongs in prose anywhere in this repository.
8. **`docs/architecture/`** — dated architecture and audit records. These stay
   authoritative for the decisions they record; do not duplicate them.

**A number in prose is a claim nothing checks.** Where you need one, run
`npm run coverage` and cite the report.

## Repository map

```
CLAUDE.md                  this file — constitution and router
CONTRIBUTING.md            ownership between the two maintainers
PROGRESS.md                what landed, and what is pending
COVERAGE.md                generated; the authority on every count
ATTRIBUTION.md             SRD attribution, ships with every build
docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md   outranks this file
docs/design/               subsystem architecture (see the router above)
docs/rules/                SRD interpretation policy
docs/architecture/         dated architecture and audit records
docs/dev/                  WORKFLOW.md, QUEUE.md, tasks/
packages/shared            branded ids, D&D vocabulary, the Result type
packages/srd               SRD 5.2.1 ingested into typed, validated data
packages/engine            the rules: pure functions and a reducer over GameEvent
packages/tools             the Zod-validated tool surface (M2)
packages/maestro           prompt assembly, persona, the DM loop (M2)
```

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

## Two people work on this repo

**`CONTRIBUTING.md` is the full picture — ownership, the daily loop, and a
per-file conflict playbook. This is the part that must not be broken by an agent
that has not read it.**

Work is split by file, not by feature, because files are what git resolves.
**A owns content** — spell definitions, the registry, `VERIFIED_SPELLS`, the
spell tests. **B owns mechanism** — `commands/`, `fold/`, `events.ts`,
`state.ts`, the timing and positioning modules, and the *type declarations* at
the top of
`spell-definitions.ts`. Stay in your lane; if a change genuinely needs the other
lane, say so rather than reaching across.

Four rules that a session will otherwise break, all of them learned here:

- **Never regenerate `packages/engine/fixtures/golden-log.json`** — nor
  `golden-log-2.json`. Both are frozen on purpose. Regenerating either to make
  `persistence.test.ts` or `persistence-2.test.ts` pass converts a
  compatibility test into a rubber stamp, which is worse than deleting it.
- **Always run `npm run coverage`** after touching a spell definition, and
  commit the result. CI fails on a stale `COVERAGE.md` — which it did not, for
  as long as the suite was quietly regenerating the file first. See "A Script
  That Writes Must Not Write When It Is Imported".
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
- **One owner per primitive.** Two tasks that both change the same module under
  `commands/` or under `fold/`, the `GameEvent` union, `state.ts`, the types at
  the top of `spell-definitions.ts` or any other foundational primitive run one
  after the other, never concurrently. Two that change *different* command
  domains, or different seams of the fold, may run beside each other, which is
  what splitting those two files bought.
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
