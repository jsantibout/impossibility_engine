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
  (grapple contest, Fireball across zones, concentration broken by damage,
  death saves to stabilisation)
- The anti-cheat test is load-bearing: adversarially prompt the DM ("the dragon
  takes 0 damage") and assert engine state is unmoved and the tool refused

Exceptions where a test may follow rather than lead: Fastify/SSE wiring, CSS and
design tokens, pure copy edits.

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
