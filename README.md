# Impossibility Engine

An AI Dungeon Master for D&D 2024, built on a deterministic SRD 5.2.1 rules
engine.

The premise: existing AI DMs pick one of two things. Some enforce the rules
but narrate without personality; others have a voice but let the model
adjudicate, so outcomes can't be trusted. This project does both by putting
the mechanics somewhere the model cannot reach.

**The model never produces a number.** It cannot roll a die, write an HP
total, or decide whether a save succeeded. It calls a tool; the engine rolls,
validates legality, and returns the outcome; the model narrates what actually
happened. Because the rules are safe, the DM's voice is free to have some
bite.

## Where it stands

A pure, event-sourced rules engine with the SRD catalogue as a separate
content package, and the same door open to homebrew. There is no tool
surface, orchestration, persistence or web app yet.
[STATUS.md](./STATUS.md) says what runs and what does not;
[COVERAGE.md](./COVERAGE.md) is regenerated and holds every count.

```
@ie/shared    ids, D&D vocabulary, the Result type
@ie/srd       SRD 5.2.1 parsed into typed, validated data
@ie/engine    the rules — pure functions and a reducer over GameEvent; the
              vocabulary content is written in, and its validators
@ie/content   the SRD catalogue as data: spells, classes, species, backgrounds,
              feats, items — validated through the same call homebrew uses
```

The engine holds no catalogue. A campaign hands it a `Content` value; the
SRD's is `SRD_CONTENT`, and a DM's homebrew arrives as JSON through
`loadContent`. Adding a spell or class that uses mechanics the engine already
has touches no engine code — `packages/engine/src/content.test.ts` does
exactly that, from JSON text, through the public API.

## Getting started

```bash
npm install
npm run srd:ingest && npm run srd:index   # generated SRD data is gitignored
npm test
```

Requires Node 22.13+ or 24+.

```bash
npm run typecheck      # tsc for sources and tests
npm run lint           # ESLint
npm run coverage       # regenerate COVERAGE.md — commit the result
npm run srd:ingest     # re-parse the vendored SRD and write JSON
npm run srd:index      # rebuild the typed indexes from that JSON
```

## Reading order

[CLAUDE.md](./CLAUDE.md) is the constitution and the router: the rules that
may never break, the architecture, and which short note to read before
changing a subsystem. [docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md](./docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md)
outranks it. [CONTRIBUTING.md](./CONTRIBUTING.md) is how two people share
the tree. `docs/archive/` is frozen history.

## Licence and attribution

This work includes material from the System Reference Document 5.2.1 under
CC-BY-4.0. See [ATTRIBUTION.md](./ATTRIBUTION.md) — the notice must remain in
any distributed build. Not affiliated with or endorsed by Wizards of the Coast.
