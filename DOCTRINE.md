# Impossibility Engine Architecture Doctrine

> This is the constitutional document. `CLAUDE.md` records *how this codebase
> works and why* — the rules transcribed, the traps, the decisions taken. This
> records *what must remain true of the Engine regardless of what it is asked to
> do next*. Where the two disagree, this wins and `CLAUDE.md` is the thing that
> needs correcting.
>
> Conformance is audited in `PROGRESS.md`, not assumed here. An invariant this
> document states and the code does not yet satisfy is a **debt with a name**,
> which is the point of writing it down.

## Mission

The Impossibility Engine is an authoritative simulation layer that allows humans
and AI agents to attempt actions in a persistent world while preserving
mechanical truth, causality, and continuity.

Infinite Realms and D&D 2024 are the Engine's first proving ground, not
justification for prematurely designing a universal game engine.

## Core Principle

**AI interprets possibility. The Engine adjudicates reality.**

An AI may interpret intent, invent appropriate fiction where authority permits
it, propose actions, supply missing fictional context, and narrate outcomes.

The Engine owns mechanically authoritative state and determines what actually
changes.

## Constitutional Invariants

1. **The Engine owns truth.** Authoritative mechanical state must never depend
   on narration alone.
2. **State changes through explicit events.** `GameState` remains
   reconstructable from its authoritative event history.
3. **Events record resolved history, not unresolved intent.** Replaying history
   must not reroll dice or reinterpret old actions under newer rules.
4. **The Engine remains deterministic and headless.** It must not depend on UI,
   databases, network services, wall clocks, LLMs, or unrecorded randomness.
5. **Unknown is not false, illegal, or impossible.** Missing world information
   should produce an explicit request for context whenever resolution is
   otherwise valid.
6. **Fiction may supply facts; fiction may not overwrite established truth.**
   Once a fact becomes authoritative state, future narration and agents must
   respect it unless a valid state-changing action alters it.
7. **No model-generated authoritative numbers.** Dice, HP, resources, ranges,
   costs, durations, and other mechanically authoritative quantities are
   calculated or validated by the Engine.
8. **Commands must be safe to retry.** Idempotency and command identity are
   architectural requirements, not API conveniences.
9. **Incomplete multi-step resolution must survive reloads.** If a rule creates
   a meaningful interruption point, pending resolution belongs in authoritative
   state.
10. **Causality should be preservable.** Important state changes should retain
    enough provenance to eventually answer what happened, why, and what caused
    it.
11. **Rendering is not simulation.** The Engine determines world changes. A
    graphical client decides how those changes are presented.
12. **Agents are users of the Engine, not part of its authority.** Maestro,
    future NPC cognition systems, human players, and other controllers should
    ultimately interact with reality through controlled Engine operations.

## Generalization Rule

**Generalize from evidence, not ambition.**

Do not introduce a generalized abstraction merely because a future MMO,
graphical RPG, or other game might require it.

A concept should move into a more general Engine primitive only after multiple
concrete mechanics demonstrate the same underlying behavior.

Prefer several precise domain concepts over one speculative generic
abstraction. Strong semantics are more valuable than theoretical flexibility.

## Current D&D Boundary

D&D-specific concepts may remain explicitly D&D-specific.

Creature, spell, condition, action economy, saving throw, spell slot, class
feature, and similar concepts do not need to become generic game concepts merely
to support hypothetical future products.

Future reusable primitives should emerge from repeated requirements encountered
while implementing and operating real D&D campaigns.

## Missing Facts

`needs-context` is a first-class resolution state.

When the Engine needs information that is part of fiction or environment rather
than rules arithmetic, it should:

1. identify the missing fact,
2. identify why the rule requires it,
3. identify how authoritative context can satisfy it,
4. perform no irreversible resolution before that fact exists.

**Do not silently default consequential unknown facts.**

## Future Compatibility

Without implementing these systems prematurely, avoid architectural decisions
that unnecessarily prevent future support for:

- multiple locations or world regions,
- persistent non-creature world objects,
- graphical fact providers,
- multiple simultaneous actors,
- optimistic concurrency,
- autonomous NPC agents,
- actor-specific knowledge and observation,
- richer event provenance,
- persistent causal world history.

These are compatibility considerations, not current implementation
requirements.

## Product Priority

The current product goal remains:

**Build the most mechanically trustworthy, persistent AI D&D experience
possible.**

The future vision must improve today's architecture discipline without
expanding today's scope.
