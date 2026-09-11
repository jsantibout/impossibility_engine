# InfiniteRealms

An AI Dungeon Master for D&D 2024, built on a deterministic SRD 5.2.1 rules engine.

The premise: existing AI DMs pick one of two things. Some enforce the rules but
narrate without personality; others have a voice but let the model adjudicate,
so outcomes can't be trusted. InfiniteRealms does both by putting the mechanics
somewhere the model cannot reach.

**The model never produces a number.** It cannot roll a die, write an HP total,
or decide whether a save succeeded. It calls a tool; the engine rolls, validates
legality, and returns the outcome; the model narrates what actually happened.
Because the rules are safe, the DM's voice is free to have some bite.

## Status

Early, and honest about it: this is a **rules engine**, not yet a game.

**What runs today** — all of it pure, deterministic and tested:

| | |
|---|---|
| Dice | Seeded and replayable, with per-die effects (Great Weapon Fighting, Sorcerous Burst, rerolls) |
| Rolls | Provenance on every roll: engine, physical dice, or a DM's override |
| Characters | Derived AC, saves, skills, proficiency, spell save DC |
| D20 Tests | Checks, saves, attacks, with named bonuses and attributed advantage |
| Interventions | Bardic Inspiration, Cutting Words, Indomitable — effects used *after* a roll |
| Damage | Typed components, resistance per type, criticals, Cutting Words reductions |
| Conditions | All fifteen, source-aware, feeding back into every roll |
| Vitals | Hit points, temporary HP, death saves, stabilisation, death |
| Combat | Initiative, turn economy, reactions, the action budget |
| Positioning | A 5-foot cube lattice, Chebyshev distance, all six area shapes, cover, mounting |
| Monsters | 235 stat blocks adapted into fightable creatures |
| Resources | Generic limited-use pools — spell slots, Ki, charges — declared, not derived |
| Casting | Slots, upcasting, slot-free casting, one slot per turn, the action it costs |
| Concentration | Started, replaced, dismissed, broken by damage, Incapacitation or death |
| Commands | Engine-owned batches, with idempotency keys so a retry is a no-op |
| Rests | Short and Long, Hit Dice, recharges, and the interruptions the engine can see |
| The clock | Seconds since the campaign began; a combat round costs six of them |
| Durations | Elapsed deadlines and turn-anchored ones, expiring by effect instance |
| Turn hooks | Repeat saves raised by the turn itself, rolled by the engine, never forgotten |
| Progression | Class tables, features by level, and what the engine does or does not run |
| Creation | A validated level 1–3 Wizard: origin, scores, skills, feats, spells, kit |
| Determinism | A scripted four-round fight, replayed byte-identically from its seed |
| Spell data | 339 SRD spells indexed by id, class list, level and school |
| Event log | `GameState` as a fold; replay is a pure function of the record |

**Parsed from the SRD** — 339 spells, 330 creatures, 38 weapons, 13 armour.
Parsing a spell's text is not the same as *executing* it: the engine tracks what
a casting costs and what it keeps alive, but no spell's own effects are scripted
— a spell that imposes a condition is applied by the caller, linked to the
casting that caused it.

**Not built yet**: the other eleven classes, feats, multiclassing, the tool
surface Claude would call, the DM orchestration, persistence, and the web app.
One character path — Human Sage Wizard through level 3 — is complete; the rest
is transcription onto the same structures. There is no frontend and no database. Casting times of a minute or
more are refused rather than approximated, a rest cannot be resumed after an
interruption, and Reaction timing is recorded rather than enforced — see
[CLAUDE.md](./CLAUDE.md) for the full list, each with the reason it is still
open.

## Getting started

```bash
pnpm install
pnpm test
```

Requires Node 22+. Postgres is not needed until persistence lands.

Other commands:

```bash
pnpm run typecheck      # tsc for sources and tests
pnpm run lint           # ESLint 9
pnpm run srd:ingest     # re-parse the vendored SRD and write JSON
```

`srd:ingest` asserts counts rather than only the absence of errors — a parser
that silently skips everything reports no problems at all.

## Architecture

See [CLAUDE.md](./CLAUDE.md) for the design decisions and the rules that are
easy to get wrong. In short:

```
@ie/shared   ids, D&D vocabulary, the Result type
@ie/srd      SRD 5.2.1 parsed into typed, validated data
@ie/engine   the rules — pure functions plus a reducer over GameEvent
```

Nothing below the (not yet built) tool boundary knows an LLM exists, which is
what lets the same engine serve a human DM as readily as an AI one.

## Licence and attribution

This work includes material from the System Reference Document 5.2.1 under
CC-BY-4.0. See [ATTRIBUTION.md](./ATTRIBUTION.md) — the notice must remain in
any distributed build. Not affiliated with or endorsed by Wizards of the Coast.
