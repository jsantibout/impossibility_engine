# Impossibility Engine Architecture Doctrine

> This is the constitutional document. `CLAUDE.md` records *how this codebase
> works and why* — the rules transcribed, the traps, the decisions taken. This
> records *what must remain true of the Engine regardless of what it is asked to
> do next*. Where the two disagree, this wins and `CLAUDE.md` is the thing that
> needs correcting.
>
> Conformance is recorded in `STATUS.md`, not assumed here. An invariant this
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

## North Star: Authority Without Rigidity

The Impossibility Engine exists to make mechanically reliable play possible
**without constraining what players or DMs can imagine**.

A safer or more deterministic architecture that makes creative D&D
substantially harder is **not** a successful architecture. That sentence is the
whole of this section; everything below is how to apply it.

### The division of authority

| | Owns |
|---|---|
| **The Engine** | Established mechanical truth: rules, deterministic resolution, resources, modifiers, positions, conditions, timing, and authoritative state. |
| **The DM** | Authorship and judgment: world creation, NPC behaviour, interpretation of player intent, DCs and rulings where the rules do not determine an answer, and adjudication of novel actions. |
| **Both, collaborating** | An action only partially modelled: the DM decides how the situation should be adjudicated, and the Engine deterministically executes the mechanical pieces it knows. |

### The Engine must not require a bespoke command for every imaginable action

A player says *"I swing from the chandelier."* The desired response is **not**

> Unsupported action.

It is: the DM determines an appropriate ruling — say Acrobatics, DC 14 — and
the Engine resolves the check using authoritative character state and
deterministic mechanics. The DM chooses the skill and the DC. The Engine
supplies the modifier, throws the die, and decides the outcome. Neither does
the other's job.

**The Engine should prevent contradictions of established mechanical truth
without preventing legitimate DM invention.** Those are different things and
the difference is the design. Refusing a Hold Person on a creature the SRD
prints as Fey protects truth. Refusing a chandelier because no
`SWING_FROM_CHANDELIER` command exists protects nothing.

The goal is not to constrain the DM until the system becomes correct. **The
goal is to make the rules trustworthy enough that the DM is free to be
creative.**

### The tie-breaker

When two implementations are mechanically correct, prefer the one that, in
order:

1. preserves greater player freedom,
2. preserves greater legitimate DM authorship,
3. requires fewer model round trips,
4. exposes fewer Engine implementation details to the DM,
5. still preserves authoritative mechanical truth and deterministic resolution.

Any proposal that increases rigidity, refusals, required bespoke commands, or
orchestration burden **must justify that cost against this North Star**. The
question to ask before adding a refusal, a hard constraint, a required command
or an extra round trip is: *does this protect established mechanical truth, or
is it compensating for an inflexible interface?* Only the first is worth
paying for.

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
13. **The Engine holds no catalogue.** Spells, classes, features, species,
    backgrounds, feats and items are content, supplied to the Engine as a
    validated value. The SRD's catalogue and a table's homebrew enter through
    the same door and the same checks; content that uses mechanics the Engine
    already has never requires changing the Engine; and what a command reads
    from content is pinned into the events it emits, so replay never depends
    on the catalogue loaded today.

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
| 13 | `createContent` / `loadContent` are the only way content reaches the engine; `SRD_CONTENT` is built through them; the sweep in `spell-schema.test.ts` fails on any catalogue id, class name or fixed grant under `packages/engine`; `content.test.ts` adds a spell and a class from JSON and drives both through the public API. |

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

**Non-creature persistent world objects.** The persistent placed things are
creatures, landmarks, and **a point an ongoing casting holds**; a door, a
chandelier, a lever exist in narration and are attacked or moved by being
*declared* into a creature-shaped record. The seam is
`ContextRequest.kind: 'creature'` — the request for "a thing with this id" —
and `creature-added` as its provider. Do not widen `CreatureState` into a
property bag to accommodate objects; when a second concrete mechanic needs an
object (a door with hit points *and* a lock DC is the likely first), give it
its own precise record and its own request kind.

Spiritual Weapon's force was the first thing to test that instruction and it
answered by *not* needing an object at all: the SRD prints it no Armour Class,
no Hit Points, no occupancy and no action of its own, so it is a `Point` on the
casting rather than a record with an identity. The rule that generalises is
**a point is a point until a mechanic proves it needs to be more** — and the
mechanic that will prove it is the one that lets something attack the thing,
which is the summons seam, not this one.

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
