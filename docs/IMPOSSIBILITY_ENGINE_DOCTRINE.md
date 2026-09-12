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

## How the invariants are kept, in this codebase

Each of these is enforced by something that fails, not by a paragraph.

| Invariant | What keeps it |
|---|---|
| 1, 2 | `GameState` is `fold(events)`; nothing else writes it. Every declaration the engine *asks* for has a command that supplies it, so the layer above never assembles an event by hand. |
| 3 | `roll-recorded` and every damage event carry the number rolled. `scenario.test.ts` replays a four-round fight byte-for-byte from the log alone; a second seed folds it identically. |
| 4 | ESLint forbids `Math.random`, `Date.now`, `crypto.randomUUID` and I/O in `packages/engine`; the package imports only `@ie/shared` and `@ie/srd`. |
| 5 | `Err.kind` is `'refusal' \| 'needs-context'`; `isNeedsContext` is the predicate a tool surface branches on. `invariants.test.ts` sweeps commands aimed at things nobody has declared and asserts every one asks rather than refuses — **and names what it is missing**. |
| 6 | Durable facts refuse contradiction (`declareCreatureType` → `type_established`), and the reducer treats a contradicting log as corrupt. Momentary facts (sight, cover) are updates and re-declare freely. |
| 7 | Damage takes a `RollId` the engine issued; only `rolls.ts` stamps `engine`; `recordExternal*` refuses to forge it and is not on Maestro's surface. |
| 8 | `identify()` fingerprints a command's kind and inputs; the stamp lands on an emitted event; the fold records it; a retry returns `[]` and a reused id for different work is refused. The sweep in `invariants.test.ts` is the list of commands this covers — a command missing from it is unguarded. |
| 9 | `pendingAttack`, `pendingMove`, `pendingSaves`, `scheduledDamage`, `readied` all live in `GameState`, derived from events, and the turn refuses to advance past a debt it cannot settle. |
| 10 | Every event that a command produced carries `command: { id, fingerprint }`; every roll names its sources and signs. See the debt below. |
| 11 | Nothing in the engine renders; positions are a lattice Maestro never speaks in. |
| 12 | The tool surface (M2) is the only door; the engine does not know an LLM exists. |

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

### What is a reusable simulation primitive today, and what is deliberately D&D

Audited rather than guessed. The first column is what would survive a change of
rules system with nothing but its D&D *data* swapped out; the second is what
should not be asked to.

| Reusable as it stands | Deliberately D&D-specific |
|---|---|
| Event-sourced state with a pure fold, an exhaustive reducer and a loud corrupt-log error | The `GameEvent` vocabulary itself — `spell-cast`, `death-save-recorded`, `rest-ended` |
| Seeded, snapshot-able dice with per-die provenance (`DieRoll`) | Advantage/Disadvantage, criticals, the natural-20 rules |
| `Result` with `refusal` / `needs-context` and structured `ContextRequest`s | Which facts a rule can request (position, sight, type, scene) |
| Command identity: `identify()`, fingerprints, stamps, `appliedCommands` | Every command that uses it |
| Durable debts in state, raised by a boundary and settled by a command (`pendingSaves`, `scheduledDamage`) | The turn boundary itself, the action economy, Reactions |
| The clock in seconds; `Duration` → `Deadline` with a conversion that can refuse | Rounds of six seconds, "until the end of your next turn" |
| Declared-not-derived facts with three values (yes / no / nobody has said) | Cover degrees, the Chebyshev lattice, creature footprints |
| Named pools with a recovery rule (`resources.ts`) | Spell slots, Pact Magic, Hit Dice |
| Conditions as a set of *reasons*, with implication closure | The fifteen SRD conditions and what each does |

The reusable column is reusable **because it was needed twice in D&D**, not
because it was designed to be. `scheduledDamage` copied `pendingSaves`' shape
only after Acid Arrow demonstrated the same debt with a different payload.
That is the order the doctrine requires.

## Missing Facts

`needs-context` is a first-class resolution state.

When the Engine needs information that is part of fiction or environment rather
than rules arithmetic, it should:

1. identify the missing fact,
2. identify why the rule requires it,
3. identify how authoritative context can satisfy it,
4. perform no irreversible resolution before that fact exists.

**Do not silently default consequential unknown facts.**

### The request loop, as it stands

The pattern — action attempted → rules inspect known state → a missing factual
requirement is identified → an authoritative provider supplies it → resolution
continues — exists today for one domain, and it is worth stating exactly what
is and is not general about it.

- **`ContextRequest.kind` is the machine-readable half.** A tool surface
  branches on it. `need`, `because` and `satisfyWith` are prose for whoever is
  reading, and `satisfyWith` names the *command* that supplies the fact, never
  a raw event to hand-write.
- **Commands attach requests; pure helpers do not.** `positioning.ts` and
  `combat.ts` return the bare `needs-context` kind, and the command that knows
  which rule wanted the fact adds the request. `invariants.test.ts` asserts
  every command-level `needs-context` carries at least one.
- **Every request kind has an authoritative provider.** `creature` →
  `creature-added`; `position` → placement; `visibility` → sight; `scene` →
  `scene-set`; `creature-type` → `declareCreatureType`. A kind with no provider
  is the "DOOR NOT CREATED" failure wearing a nicer shape, and `declared-facts.
  test.ts` walks the loop end to end for one D&D case so it cannot regress
  silently.
- **A refusal is not a request.** A creature *declared* unseen is a refusal; one
  whose sight line nobody has mentioned is a request. A creature *established*
  as a Fey is a refusal to Hold Person; one nobody has typed is a request.
  Collapsing either pair would invent a rule or hide a gap.

What is deliberately **not** built: a structured `satisfyWith`, a registry of
fact providers, or a generic "fact" type. Five kinds with five providers is a
table, not a framework; it becomes one when a sixth kind arrives that does not
fit the table.

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

## FUTURE SEAMS — NOT CURRENT SCOPE

Architectural considerations only. None of these is an implementation plan and
none is to be started on the strength of this section. Each names the seam
that exists today, what would strain it, and the one decision worth not making
wrongly in the meantime.

**Non-creature persistent world objects.** Today the only persistent things
are creatures and landmarks; a door, a chandelier, a lever exist in narration
and are attacked or moved by being *declared* into a creature-shaped record. The
seam is `ContextRequest.kind: 'creature'` — the request for "a thing with this
id" — and `creature-added` as its provider. Do not widen `CreatureState` into a
property bag to accommodate objects; when a second concrete mechanic needs an
object (a door with hit points *and* a lock DC is the likely first), give it
its own precise record and its own request kind.

**Multiple scenes / locations.** `state.scene` is a single `PositionState |
null`. Every positional query takes the scene explicitly rather than reaching
for a global, which is the seam. The decision not to make wrongly: nothing
should ever assume that "off the scene" means "does not exist" — the
three-valued `null` position already keeps that distinction and must keep it.

**Graphical fact providers.** Positions, sight and cover are declared, and the
engine does not care whether the declaration came from a language model, a
human at a keyboard, or a renderer computing line-of-sight from a mesh. That is
already the seam: a fact provider is anything that emits the establishing event
through the command that validates it. The only rule is that the provider does
not get to skip the command.

**Actor-specific knowledge.** Sight is declared pairwise and directional today
(`sight[from|to]`), which is the beginning of "what does this actor know".
Nothing else is per-actor; `GameState` is omniscient. Keep it so until a rule
demands otherwise — the first candidate is probably a hidden creature whose
position the engine knows and a player character does not, and that is a
*query-side* projection over an omniscient state, not a change to the state.

**Multiplayer concurrency.** The fold is single-writer and events are totally
ordered by position in the log. Command ids and fingerprints are the seam:
optimistic concurrency is "this command was issued against event *n*", and the
`appliedCommands` record plus `eventCount` are already the two facts such a
check would read. Do not add a version field until a second writer exists.

**Autonomous controllers.** An NPC "brain" is a client of the engine exactly as
Maestro is; invariant 12 already covers it. The seam to protect: no command
takes a controller identity, and none should until something needs to know
*who asked* for reasons the fingerprint does not cover.

**Richer event provenance.** Events carry *who asked* (`command`) and rolls
carry *why this number*. What they do not carry is *what caused this event* —
an Opportunity Attack does not point at the move that provoked it, and derived
changes (an effect expiring, a Concentration breaking) write nothing at all.
`CLAUDE.md` documents that trade for the derived cases. The seam is that every
event is a plain object in a totally ordered log, so a `cause: eventIndex` or a
derived-change event could be appended without disturbing the fold. Wait for a
debugging session that actually needed it.

## Product Priority

The current product goal remains:

**Build the most mechanically trustworthy, persistent AI D&D experience
possible.**

The future vision must improve today's architecture discipline without
expanding today's scope.
