# The event log, the fold, and how state is owned

How a `GameEvent` log becomes a `GameState`, what the reducer may and may not do, and the conditions and transitions the engine owns end to end. **Read this before changing persistence, state ownership, the fold, or anything under `packages/engine/src/fold/`.**

> **Authority.** This document is authoritative for its subject. It was
> extracted verbatim from `CLAUDE.md` when that file became the
> constitution and router; the sentences below are the repository's own
> reasoning, unchanged. `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` outranks it,
> and `CLAUDE.md` outranks it on anything it still states directly.

---
## The Event Log

`GameState` is a fold over a list of `GameEvent`s; nothing mutates state by any
other route. `events.ts` owns the union; `state.ts` owns what a fold adds up
to, and `fold/` owns the fold itself — see "The fold is a directory, and
`events.ts` is its schema and its barrel".

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

**That ledger has three entries, and how they got there is the interesting
part.** `damage-defense-granted`, `speed-modifier-granted` and
`attack-rider-granted` each arrived after both logs were frozen, and neither
log can be regenerated: rewriting a fixture whose whole value is that nobody
rewrites it turns a compatibility test into a rubber stamp. So a *new* event
type is uncovered by construction until the next frozen log is written, and the
honest record is a named entry saying which and why rather than a number that
quietly drops. All three are driven end to end elsewhere — the first through
Stoneskin, the second through Longstrider, Ray of Frost and Hypnotic Pattern,
the third through Divine Favor and Hunter's Mark; what is missing is
specifically the compatibility fixture. **The count is written here and derived
there**, which is why the entry is a name: this sentence goes stale and the
test does not — and it has, three times now.

Neither is ever regenerated, and the second is not a replacement for the
first: three types live only in the older log, which a test names so nobody
concludes it has been superseded. The generators —
`scripts/make-golden-log.ts` and `make-golden-log-2.ts` — exist so each log is
readable rather than magic, and are not steps in the build.

**A compatibility test that needs a timeout is usually asking the same
question too many times.** The second log was folded at *every* prefix by
re-folding each one from the beginning — 551 events, 552 prefixes, some
150,000 event applications — which was five seconds of the suite's file time
on its own and was measured at 2.2 seconds inside a full parallel run, against
Vitest's default five. That is not margin: it made the suite's only
fold-at-every-prefix assertion fail intermittently whenever anything else in
the suite grew, and a red build that says nothing about compatibility teaches
everyone to re-run it. It was given 30 seconds; what it wanted was the
quadratic taken out.

`fold` is `events.reduce(applyEvent, …)` and `applyEvent` is a pure function of
the state and the event, so **carrying two accumulators forward computes the
same 552 pairs of states in 1,102 applications** — and a JSON round trip of a
list is the list of its round-tripped members, so round-tripping each event is
round-tripping the prefix it ends. The two are compared after every event, so
the first prefix at which anything diverges is still the one that fails. The
timeout went with the quadratic, and the file now runs in well under a second.

The rule worth carrying: **a property asserted at every prefix is a property
asserted at every step**, and the second spelling is linear. The first task to
meet this wrote a bigger number beside it; the number was never the problem.

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
character sheet. **A command emits it now as well** — `addCreature`, which is
how a monster enters a game — and that is a different claim from the one the
seventeen were about: what the sweep below measures is whether anything writes
a type, and a second writer changes no answer.

**The claim is a derived sweep rather than a count in this file.**
`invariants.test.ts` reads the union and every runtime module under `src/`, and
fails naming any declared type nothing writes — driven over a synthetic type it
must catch, so the analysis cannot quietly stop seeing anything. It asserts the
narrower reading too: taken as *the command layer* — every module under
`commands/`, plus `rest.ts` — four types come back, and each carries a written
exemption naming `creation.ts` as its emitter, which the test then checks. See
"Known Pending Work" for why that mattered before M2 rather than during it.

Condition sets are sorted on the way in, so a replay compares byte for byte
regardless of the order effects were applied.

### The fold is a directory, and `events.ts` is its schema and its barrel

It was one 5,432-line module holding the state types, the event union and every
part of the reducer, and it is the file that serialised tranche 5: seven of ten
mechanism tasks touched it — IE-020 → 028 → 030 → 032 → 033 → 034 → 035 — and
that chain *was* the critical path. Read by domain those seven touched four
different regions, so under a split three of them would have been concurrent.
Same shape as `commands/`, one layer down, and for the same reason: the
workflow's one-owner-per-primitive rule serialises tasks on a *file*, so a file
that is four subsystems serialises four subsystems.

**The seams are where the fold's own declaration graph already cut.**
`scripts/fold-graph.ts` computes the declaration-level value graph, partitions
it by `fold-layout.json` and reports the module DAG — the `commands.ts` move's
precondition, kept as a committed script because it is the evidence for the
layout rather than a taste for smaller files. Run before any code moved it
found 88 declarations, 68 of them values, **no strongly connected component
larger than one**, and an acyclic module graph; run afterwards it reads the
nine files and answers the same. A cycle would have been `ARCHITECTURE_BLOCKED`.

| | |
|---|---|
| `state.ts` | `GameState` and the records it holds, plus `initialState` — the *shape* of the answer, knowing nothing about how it is computed |
| `events.ts` | the union, and the barrel |
| `fold/common.ts` | the corrupt-log backstop, the four accessors that throw it, the two sort helpers that keep a fold byte-identical |
| `fold/release.ts` | what a casting is on and what it hung there — the single door every ending converges on |
| `fold/areas.ts` | who a persistent area catches, at each of the three moments the SRD writes |
| `fold/turns.ts` | what a turn boundary owes, and why its two moments are a round apart |
| `fold/expiry.ts` | what runs out, and what a creature who leaves takes with them |
| `fold/endings.ts` | a casting ended by something that happens |
| `fold/apply.ts` | `applyOne`, the derived passes `applyEvent` runs, and `fold` |

**`applyOne` stayed one switch** through that split, with its `never` default,
because a move that did both at once would have had two things to blame. It is
dispatched by domain now — see "One seam per region of the state" below.

**The union stays put because five test files read it by that path**, and most
of the engine imports from it — so `events.ts` re-exports `state.ts` and
`fold/index.ts` and the public surface is the same twenty-five names, with not
one importing module touched. (No count, deliberately: the figure moves with
whether tests and the sibling packages are in it, and a number in prose that
nothing regenerates is this file's own most-repeated finding.) Both of those
import the union `type`-only, so the edge back is
erased and the run-time graph is the DAG the script reports. `fold/index.ts`
enumerates rather than stars, for `commands.ts`'s reason: before the split
"exported" and "public" were the same word, and `export *` would have made
`releaseCasting` and `expireEffects` part of `@ie/engine`.

**The oracle was byte-identity, not the suite.** Every moved body is the
original text after two mechanical transformations — the import block
rewritten, and `export` added to the thirty-one declarations a sibling seam now
reads. Reverse those and **all 88 declarations match their source byte for
byte with comment lines removed on both sides**; run the check with an empty
transformation list and exactly the thirty-one differ, each by the seven
characters of its `export` prefix, which is what says nothing else moved. A
suite passing is the weaker claim: this is a fold, and both frozen logs would
have caught a behaviour change.

**The claim is stated with comments removed because a *comment-inclusive*
count is not reproducible, and an independent review proved it.** How many
declarations match byte for byte including their trivia depends entirely on
which declaration a comment block is attributed to — the builder's cut says
"the nearest block above", another segmenter says something else, and the two
answer 84 and 66 over an identical diff. Neither number is wrong and neither is
evidence. What is reproducible is the code, and that is what the sentence
claims.

**The other four are the interesting ones, and they are why "a comment landing
in the wrong function" is a named hazard rather than a hypothetical.** Two
docstrings were *already* orphaned on `main` — each sitting above an
intervening declaration's own docstring, several hundred lines from its
subject — so a cut that attaches the nearest comment block to the declaration
below it put them in a different **module** from the function they describe:
`dropOrphanedSaves`' explanation left in `common.ts` with nothing under it, and
`breakLostConcentration`'s stranded above `alsoOn` in `release.ts`, which then
appeared to carry two docstrings, the first about something else. Reuniting
them is a third transformation, confined to four declaration blocks and
declared as a defect fix rather than folded into the move. What says it is only
that is the stronger check the case forced: with **every comment line deleted
on both sides**, all 88 declarations are identical, so nothing but prose
changed.

The rule for the next split of this kind: **a body-level oracle cannot see
leading trivia, so check the trivia too.** An orphan comment is invisible while
one file holds everything and becomes a wrong answer the moment the file is
cut.

**Two derived sweeps had populations that had to follow the code**, which is
this repository's most-repeated failure arriving where it was predicted.
`invariants.test.ts`'s emitted-type sweep excluded `events.ts` by name and now
excludes `fold/` as well — not because a `case 'x':` matches a `type: 'x'`
position, which it does not, but because the question that sweep asks is "which
module *emits* this type" and the fold structurally emits none: it is handed
events and returns state. A population holding the consumer is one regex change
away from marking an unreachable event type reachable. And the `speedOf`
single-reader sweep — which gained `events.ts` in IE-031 for exactly this
reason, and which lives in `invariants.test.ts` rather than beside the Speed
tests, because it is built from that same map — gains the fold as a **directory
listing**, so an eighth seam joins it on the day it is written rather than when
somebody remembers. `speed.test.ts` needed no change: it reads the frozen
fixtures and no source path at all.

### One seam per region of the state

`applyOne` was one switch with a case for every type the union declares, in a
1,796-line file, and it is what forced a three-way serialisation in the tranche
that measured it: three tasks in three different subsystems — a monster
entering the game, a casting held to its turns, an ongoing record deriving what
it is on — all had to queue behind each other because the
one-owner-per-primitive rule names the **module**, and the module was every
subsystem at once. Same shape as `commands.ts`, and as `events.ts` before it,
one layer further down.

It is a dispatch now, over thirteen partial reducers, each in its own file
under `fold/`.

**A seam is a region of `GameState`, not a subject somebody grouped by eye.**
That is the whole discipline, and it is what stops the next split being
adjusted until the numbers come out right. Where a coarser grouping and the
rule disagree, the rule wins — which is why `roster.ts` and `vitals.ts` are two
rather than one "creatures", and `casting.ts` and `ongoing.ts` two rather than
one "spells". Both of those are cuts the layer above already made:
`commands/casting.ts` and `commands/ongoing.ts` are the same line drawn from
the other side.

| | |
|---|---|
| `fold/roster.ts` | the `creatures` keyspace, and the sheet behind a creature |
| `fold/vitals.ts` | hit points, death and conditions — what happens to a creature already in the game |
| `fold/upkeep.ts` | what a creature spends and recovers, and the clock it recovers against |
| `fold/casting.ts` | the casting being made: `pendingCastings`, and the sequence that names one |
| `fold/ongoing.ts` | the spell left running, what it holds, and the two ways it ends |
| `fold/timers.ts` | what a casting owes later: `timers`, `pendingSaves`, `scheduledDamage` |
| `fold/combat.ts` | the combat record — the order, the turn and the action economy |
| `fold/scene.ts` | where everything is, and every event that moves a creature in it |
| `fold/features.ts` | what a creature has switched on, and what it is holding |
| `fold/holds.ts` | what the engine is holding mid-resolution, and how each is settled |
| `fold/inventory.ts` | what a creature carries, wears and holds in coin |
| `fold/grants.ts` | the six families of granted modifier, and the one rule they share |
| `fold/rolls.ts` | the generator's own two events |

**The three tasks that could not run together now touch different files**,
which is the check that says this was not aesthetic: the monster's
`creature-added` is `roster.ts`; the long casting's turn boundary is
`combat.ts`, with its `casting-continued` in `casting.ts`; and the derived `on`
is `vitals.ts` at the `condition-applied` case and `ongoing.ts` at the record.
No pair of them changes a seam in common. **The third of them has since
landed** and touched exactly those two cases: `vitals.ts` lost the growth pass
and `ongoing.ts`'s `spell-ongoing` case gained the state read that reconstructs
a pre-version-3 record's stored subset — which is the one place in this seam
that reads the creatures to write the ongoing region, and is correct there
because the record is written last in every resolution path. One caveat, stated
because it is the place the answer turns: that third task also *reads* the
`withoutTarget` call site, which is in `roster.ts` — and `withoutTarget` is
kept, so it changed nothing there. Had the design deleted it as well, that task
and the monster would have queued behind each other again, in the one module a
creature entering and a creature leaving both have to be in.

Under the coarser six-way grouping the task was proposed with — casting,
creatures, combat/turns, effects-and-timers, world/scene, inventory — **two
pairs would still have collided**, on "creatures" and on "casting". That is the
measurement that chose the granularity; it was not chosen and then justified.

**The exhaustiveness guarantee did not get weaker; it is in three pieces
now.** The `never` default caught exactly one thing, a union member with no
case. Each
seam still carries one over its own narrowed union, so a type a seam *claims*
and has no case for is a compile error. `applyOne`'s `unhandledEvent` sees
whatever no guard matched, and that narrows to `never` only when the thirteen
cover the union, so a type **no** seam claims is a compile error too. What
neither can see is a type claimed **twice** — two seams listing it type-check,
the first guard wins, the second case is dead, and editing the dead one is
silent — so `fold-partition.test.ts` derives the union from `events.ts` and
asserts exactly-one, driven over synthetic input in both directions. Under a
real double claim the whole rest of the suite stays green and that one test
goes red, which is the claim worth making.

The seam's list is the single source and its type is `Extract`ed from it, so
the array and the union cannot drift; `seamOf` builds the guard from the same
array. And an event type nothing claims still **throws** — the case the `never`
was never about, since the real one arrives as JSON from Postgres carrying a
type somebody wrote down last season, past every compiler.

**The oracle was byte-identity again, and this time the transformation list is
empty.** A case block inside a seam's `switch` sits at exactly the depth it sat
at inside `applyOne`'s, so every one of them — its label, its leading comment
and its body — is the original text with nothing done to it at all; only the
blank lines *between* blocks were normalised, and those belong to no case. Four
declarations moved with the cases they serve, and each matches its source after
reversing the `export` that `roster.ts` now needs on `withEquipment`. The seams
take `{ state, next }` as one named parameter rather than two bare `GameState`s
a call site could swap, which is `resolveEffects`' `EffectContext` move for its
reason and is what lets the bodies be untouched.

**And `fold-graph.ts` is in the suite now.** It was the evidence for the seams
and then ran only when somebody remembered — and it carried a hand-kept
`SOURCES`, so it went on answering about eight modules while thirteen more were
written beside them, which is this repository's most-repeated failure arriving
inside the guard against it. The measurement moved into `fold-graph-data.ts`
with no top-level effect, the way `coverage-data.ts` split from `coverage.ts`
and for its reason; `SOURCES` is a directory listing; and `fold-graph.test.ts`
asks it for the cycles, the unplaced and the misplaced on every run. The seams
sit above `common`, `release`, `areas`, `turns` and `expiry`, and below
`apply`, and the graph is acyclic.

**None of the thirteen is a second authority.** `applyEvent` and `fold` are
unchanged, the derived passes run in the order they ran in, no seam is exported
from `fold/index.ts`, and nothing under `commands/` can reach one. A log
becomes a state by exactly the route it always did.

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
exposes the same names it exposed before, and **`invariants.test.ts` reads
that list** to know which of the modules' exports its sweeps are about. (It
said 118 and that was a digit in prose, which this file's own most-repeated
finding is about; the list is in the file and it moves.)

**And a name may leave that list, which is the same decision read the other
way.** `resolveCast` was published and called by nothing but tests — its one
production use, the Divine Smite inside `resolveAttackDamage`, goes through
`resolveCastWith` — while this file has said since Counterspell landed that
"the operation a tool surface exposes for a spell the engine has a definition
for is `resolveSpell`; `resolveCast` is what is left for a spell it has none
for." Being the low-level half is a *policy* about who calls it, and a policy
that lives only in prose is what the barrel exists to make structural, so it is
a module export now. **That is a public API change**, recorded here because the
eventual `index.ts` tiering will read this record: nothing in `@ie/engine`
exports it, and the callers that drive it import the module directly. Its
`mayAct` guard is unchanged and stays exercised — moved out of the derived
spender sweep, which is about *commands*, into a case of its own, because a
guard losing the only thing that ran it on the day it stopped being published
is exactly the silence that sweep was derived to end.

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

**Three mutations survived the whole suite**, and they were recorded here
rather than fixed, because a behaviour-preserving refactor whose diff also
contains a fix cannot be verified by its own oracle. **All three have a fixture
now**, and each is caught by exactly one test — measured by running the whole
suite under each mutation in turn, which is the claim worth making rather than
"the new test goes red":

- **The one `continue` that was deliberately *not* rewritten.** Dispel Magic's
  resolver has an inner `for (const spell of running)`, and the `continue` in
  its failed-check branch belongs to *that* loop. Rewriting it the way the
  other twenty-two were stops a Dispel Magic at the first spell whose check it
  failed, and nothing said so — because no fixture aimed one at a target
  carrying **two** ongoing spells and failed the first check. The fixture is
  True Seeing and Stoneskin on one creature, both above a level 3 slot, so the
  Dispel has to roll for each; the seed is chosen so the first check misses its
  DC 16 and the second makes its DC 14. That line is still the most dangerous
  one in the file — it looks exactly like the lines around it and means
  something else — and it is no longer unguarded.
- **The state threading.** Commenting out `current = done.value;` passed
  everything, because effects on one target are near-enough independent in
  **every registered definition**: no catalogue spell asks a question the
  effect before it answered. So the fixture is a *definition* rather than a
  spell — `resolveEffects` is pure over the definition it is handed and never
  consults the catalogue, which is the move `restoreOn`'s dawn-recovering pool
  and Alarm's 660 seconds already make. Two effects, a condition imposed and
  then ended, with **no die thrown on either side**, so the assertion turns on
  the threading and nothing else.
- **The `from` wiring.** Never setting it passed everything, and the reason is
  worth stating: the Spiritual Weapon seam *was* pinned — by the **range**
  check, which is answered before the effects run and by another path
  altogether. What nothing reached was the Prone rule. SRD Prone is asymmetric,
  so a creature five feet from the force and sixty-five from the Cleric gets
  Advantage under one reading and Disadvantage under the other, on the same
  swing; a mode is decided by the geometry rather than by the dice, so the
  fixture is deterministic.

The lesson the three share is the one the split already knew and could not
act on: **a guard that is reachable by two paths is only tested on the path a
fixture happens to take.** Each of these was a second path nobody had a case
for, and each case is one prone target, one extra spell, or one pair of
effects.

What the suite already covered is the context itself: a save DC wired one point
high fails three tests in three files, across both the atomic and the settled
path.

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
than `events.ts`, which declares them, and `fold/`, which consumes them and
emits none. The `type:` position is load-bearing rather than pedantic: a
`ContextRequest`'s `satisfyWith` *names* an event it does not write, and under
the looser reading `creature-placed` came out emitted while nothing emitted it.
Both halves are driven over synthetic sources they must catch.

**Where the command layer is drawn changes the answer, so the sweep names it
rather than assuming it.** Read as the other sweeps read it — every module
under `commands/`, plus `rest.ts` — four types come back: `character-created`,
`character-advanced`, `hit-point-maximum-raised` and `resource-pool-resized`.
Every one is emitted by `creation.ts`, which predates
the command layer, takes no `CommandIdentity` and is not published through the
`commands.ts` barrel — so it is a question about where a command lives rather
than about whether one exists. Each carries a written exemption, and the test
checks the exemption's *claim* rather than taking it on its word: `creation.ts`
really does emit all four.

**It was five, and `creature-added` left**, which is the shape an exemption is
written to have: `addCreature` emits it from `commands/creatures.ts`, so the
entry fell rather than being reworded. `createCharacter` still emits one too,
and that changes nothing — a type is emitted once something writes it.

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

### A code a caller can receive, and a code that never arrives

The sweep asks whether a code is *asserted*; it cannot ask whether a caller can
**reach** it. IE-018 found and correctly reported seven that were unreachable,
shadowed or rewritten, because a refusal code is observable behaviour and a
caller may branch on one. The four outside the casting path are settled here,
and the four answers are deliberately not the same answer.

**A refusal from the turn economy is passed through under its own code.**
`resolveMove` asked `spendMovement` for the feet and then **rewrote whatever
came back** unless it was already about movement, and `spendMounting` copied
that verbatim. Exactly one other refusal is reachable at either site —
`not_their_turn`, because SRD gives a creature its movement on its own turn and
nowhere else — so **mounting, dismounting or moving out of turn reported
`not_enough_movement` under a reason that said "it is not b's turn".** The code
and the reason were two different answers to one question, which is precisely
what a refusal being a value exists to prevent. Both rewrites are gone. They
also compared against `no_movement`, a code **no site in the engine returns**:
it lived only in those two comparisons, which is how a dead branch hides inside
a live one.

**A blank pool key is a value now rather than a thrown corrupt log.**
`declarePool` has refused one since pools landed, and `declareResourcePool`
asked only whether the creature already *had* the key — which an empty string
never is — so the event went out and the fold threw. A corrupt log is the
backstop for a log claiming something happened, not the answer to a caller's
bad argument; the command already mirrored `bad_max` for that reason and now
mirrors both.

**A second site of a rule its own first site settled is deleted, not
exempted.** `endRest` validates every Hit Die key before rolling any, and the
rolling loop below it looked each one up again and carried a `bad_hit_die` that
could not fire. The validated sizes are carried forward instead. Two sites for
one rule is two places to get it wrong, and the dead one is the one nobody
would notice changing.

**And two are exempted, because the rule above each is genuinely stricter.**
`dash`'s `not_a_combatant` and `rollAttackDamage`'s `no_damage` are both
reachable — each is a function `index.ts` re-exports — and neither can be
reached through a **command**. Reordering a guard to make the narrower code
arrive would be a worse answer rather than a fix, so the exemption is the honest
one, written in the shape `nothing_to_interrupt` already uses: **facts a test
holds, not an opinion.**

| | The stricter rule above it | The fact that keeps it unreachable |
|---|---|---|
| `not_a_combatant` | `spendAction` answers `unknown_combatant` first — a `needs-context` naming a fact to go and get, which is the *better* answer | `order` and `budgets` are kept in exact step by every operation that changes either, so nothing that gets past `spendAction` is outside the order |
| `no_damage` | a command names its weapon by catalogue id and refuses `unknown_item` for anything else | no weapon the SRD prints lacks both its dice and its flat amount — the Blowgun has only the second |

Both rows are **swept rather than described**. The budgets-and-order agreement
is asserted when the fight begins, after a turn and after a removal, and a
mutation that stops `removeCombatant` deleting the budget fails it. The weapon
sweep reads `WEAPONS` and holds it against `itemFor`, so the day a row arrives
in the catalogue without damage is the day that exemption falls.

**`dash`'s guard is the type system's, not a rule's**, which is why deleting it
was never the option: `.find()` returns `T | undefined`, and the printed Speed a
Dash doubles lives on the Initiative order rather than on the budget beside it.

**One site of this shape is still open and is named rather than fixed.**
`bad_partial_recovery` is `bad_key`'s twin — `declarePool` refuses a
non-positive `regainsOnShortRest` and `declareResourcePool` does not ask, so it
too reaches the reducer and throws. It was not in IE-018's report and is not
fixed here; it is the next one.

### A Script That Writes Must Not Write When It Is Imported

`COVERAGE.md` is this repository's answer to every number that matters — the
reason no count of spells, definitions or features is written down in prose —
and the gauntlet ends with `npm run coverage && git diff --exit-code
COVERAGE.md`, which is what makes the committed report trustworthy.

**It was asserting that the suite had run.** `coverage.ts` called
`writeFileSync('COVERAGE.md', …)` at module top level, and two test files
imported that module for its data — so `npm test` regenerated the file the
gauntlet then diffed, and the diff was empty no matter what the committed file
said. Proved by experiment rather than by reading: append a line to the tracked
file, run one test file, read an empty diff. **Every merge record saying
"`COVERAGE.md` byte-clean" was true for the wrong reason.** Nothing downstream
was wrong when it was found, which is the point — the check that would have
said so was not running.

The fix is the split, not the guard. `coverage-data.ts` holds the measurement —
`VERIFIED_SPELLS`, the derivation of `PARTIAL_SPELLS`, `isExecuted`, the
audits — and has no top-level effect at
all, so a test wanting `PARTIAL_SPELLS` never reaches the renderer;
`coverage.ts` keeps the renderer and the write. A guard alone would have left a
writing module on two test files' import graphs, one `import` away from the
same failure.

**The write sits inside the guard block, not in a `main()` the guard calls.**
A block is not callable and a function is, so lexical containment is a claim a
source sweep can make and a reader can check — which is what
`coverage-script.test.ts` asserts across the whole of `scripts/`, reading the
compiler's own AST rather than matching text, so a write nested in a function,
a branch or a callback is seen exactly as written. Driven over synthetic
sources in **both** directions — several it must catch, including the `main()`
shape, because a sweep that can only be run against data it already agrees with
is not a sweep, and one it must **pass**, because a sweep satisfied by
reporting everything is not one either. No count is written here: the cases are
in the file, and a number in prose is the thing this section is about.

**The population is every script Node can run, not every `.ts`.** The directory
holds only TypeScript today, so a `.ts` filter would have been the files that
happen to be there rather than the rule — and `packages/srd/scripts` carries a
`.mjs`, which makes that a file type this repository uses rather than a
hypothetical. The filter is pinned by its own case, because the directory
cannot demonstrate a reach it does not yet exercise.

**A test beside a script is an entry point, not a library, and the rule is not
about it.** IE-023 put two tests in that directory and the sweep reported one
of them: `check-queue.test.ts` writes throwaway `docs/dev` fixtures so it can
drive the real validator. The rule was right and its population was wrong.
Vitest runs a test the way Node runs a script — nothing imports it for its
exports, and **this sweep's own file** writes a synthetic module into a temp
directory — so a test is the *second* kind of entry point rather than a
module something imports for its data, which is the only thing that can be
imported into writing.

Three things make that an exclusion rather than a hole. The reason is
**checked**: a test in that directory is something vitest collects, which is a
glob in `vitest.config.ts`, and the sweep holds the glob against its own
predicate — delete the glob and the sentence stops being true and the test
fails. The failure direction is **safe**: if the predicate stopped matching,
tests would rejoin the population and the sweep would go red rather than
quiet, because tests write. And the exclusion is **exercised by the real
directory**, so a predicate nothing reaches says so.

**What replaced the inventory is a floor, and the difference is the finding.**
The listing pinned every file in the directory, which a reviewer had praised as
the guard against a population that silently empties — and it was then the only
thing that failed when somebody added two files the rule has nothing to say
about, costing a full review round. A hand-kept list of files is the shape this
repository keeps finding wrong. What a vacuity guard actually has to do is fail
when the population *empties*, so it names the three scripts that **write**: a
wrong directory, a filter too narrow and an exclusion too broad all take those
out of it, and none of them is disturbed by a file arriving. A new script with
an unguarded write still fails the sweep itself; a new script without one
should fail nothing, which is exactly what an inventory got wrong. **And a new
script whose write *is* guarded fails until it is named in the floor** — which
is the third case and the right one: a script that writes belongs in front of a
reviewer, and the floor is where saying so costs one line. Two cases read as
complete here until the builder said otherwise, and an enumeration that reads
complete and is not is the shape this file records going wrong in IE-008's two
lists of pool kinds.

**One idiom, spelled one way, and executed rather than read.** The sweep holds
every guarding script to the same line byte for byte, because the looser
reading — "the condition mentions `import.meta.url`" — accepts
`const isMainModule = true`, which passes every source check and breaks nothing
until the report silently stops being written. A synthetic module carrying that
exact line is run by Node twice, as the entry point and as an import, and
writes in the first case and not the second. The real script's positive control
is the gauntlet itself, which regenerates the file on every run.

**The two golden-log generators were in the same population and are guarded
too.** Nothing imports them today — which is exactly what was true of
`coverage.ts` until two tests did, so an exemption reading "nobody imports it
yet" is the reasoning that failed here rather than an alternative to fixing it.
They are also the two files this repository is loudest about never running by
accident. Both produce byte-identical output to the version before the guard,
which is how that was checked.

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
