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

Early. `packages/engine/src/dice.ts` (seeded, replayable dice) is the first
piece. See `CLAUDE.md` for architecture and conventions.

## Getting started

```bash
pnpm install
pnpm test
```

Requires Node 22+. Postgres is not needed until persistence lands.

## Licence and attribution

This work includes material from the System Reference Document 5.2.1 under
CC-BY-4.0. See [ATTRIBUTION.md](./ATTRIBUTION.md) — the notice must remain in
any distributed build. Not affiliated with or endorsed by Wizards of the Coast.
