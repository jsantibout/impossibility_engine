# Post-tranche-5 simplification and optimisation audit, and the next cycle

> A **non-semantic simplification and optimisation audit**, not a fifth
> whole-engine retrospective. Measured on `main` at `eab142d`, 2026-09-14, by
> the architect (Fable) in a main session with write access, after tranche 5
> shipped seventeen of eighteen tasks. The fourth whole-engine audit is the
> baseline and the post-tranche-4 delta audit covered what changed up to
> tranche 5; nothing either of them measured and tranche 5 left alone was
> re-read. What was read: every reader of the pending-casting slot and of a
> creature's Concentration, the command-module topology, the fold pipeline,
> the sourced-grant enumerator, the split `resolveEffects`, the three
> adjudication maps and their guards, the coverage scripts, the test
> population and its cost, and the tranche's own records. Three claims were
> tested by experiment rather than by reading: the full suite was run under a
> JSON reporter to measure per-file cost (7,812 passing, tree clean after);
> two derivation candidates were checked against both frozen logs at every
> prefix; and the blocker map was queried for every family the cycle weighs.
> Nothing was implemented.

## 0. The verdict in one paragraph

The engine is correct where the two prior audits said it was, and tranche 5
paid down the two largest structural costs they named: `resolveEffects` is 214
lines over thirteen per-kind resolvers, and the six sourced-grant families go
through one enumerator that the compiler forces a seventh to join. What the
tranche exposed instead are **two state representations that were accidents of
their first user** — a movement remainder that could not rise, repaired in
IE-031, and a single global `pendingCasting` slot, decided in IE-034 and not
yet built — and one file that serialised the whole tranche: `events.ts`, now
5,363 lines, touched by seven of the ten mechanism tasks in a chain seven deep
that *was* the critical path. The keyed pending-casting record is the first
task of the next cycle and every single-pending assumption is enumerated below
(sixteen sites in seven modules, four tests that pin the wrong behaviour, one
exemption whose written reason depends on the slot). Beside it, two
correctness gaps outrank capability: **no command puts a monster into a
game** (`adaptMonster` has no caller outside its own module), and **a stat
block's printed condition immunities never reach state** — `creature-added`
carries damage defences only, so a Zombie is Poisoned like anybody. The
highest-leverage simplification is the `events.ts` split, which the delta
audit deferred because it would stall a running tranche and which is cheap at a
tranche boundary; three more are deletions or derivations with measured
evidence (a second, staler blocker table in the coverage report; an
`OngoingSpell.on` that is maintained by two passes and equals its derivation at
869 of 869 checkpoints; sixty repeated stamp declarations guarded by a sweep
the type system could carry). On adjudication completeness the answer is
**yes, for one population**: the undefined map's entries are bare shape lists
with no clause and no quote, which is exactly where all five wrong "finishes"
predictions came from; the executed map already has the right primitive, and
pointing it at the SRD paragraph closes the gap without a new hand list.

## 1. The engine now

| | delta audit (`0ecc84e`) | now (`eab142d`) | note |
|---|---|---|---|
| tests | 6,696 / 103 files | **7,812 / 116 files** | re-run here under a JSON reporter: 7,812 passing, 0 failed; `git status` clean afterwards, which is IE-021's payoff observed |
| executed / partial / verified / tracked | 91 / 52 / 69 / 46 | **96 / 47 / 74 / 45** | `COVERAGE.md` |
| event types declared | 91 | **94** | `speed-modifier-granted`, `attack-rider-granted`, plus IE-017's; three are outside both frozen logs by construction |
| `commands/` modules | 23 | **24** (`teleport.ts`) | value-level import graph is a DAG; three back-edges are `import type` only |
| `SpellEffect` kinds | 14 | **17** | `speed`, `attack-rider`, `teleport` |
| sourced grants on `CreatureState` | 4, five hand walks | **6, one enumerator** | the fifth and sixth each cost one line |
| `resolveEffects` | 1,008 lines | **214** (file 2,919) | thirteen resolvers over `EffectContext` |
| `events.ts` / `applyOne` | 4,794 / 1,135 | **5,363 / 1,190** | 2,364 comment lines, 2,718 code; 108 reducer cases; 57 corrupt-log guards |
| `spell-definitions.ts` | 7,005 | **7,667** | 4,069 comment lines; types and readers at the top, catalogue beneath |
| missing-shape ids | 83 | **83** | membership changed: three retired, several narrower ones added |
| `EffectTarget.grants` production writers | 0 | **1** (Ray of Frost) | |
| unasserted refusal codes | 1 of 170 | **1** (`nothing_to_interrupt`) | its written reason depends on the single slot — §2.5 |
| suite cost | — | 23.9 s summed file time | `persistence-2.test.ts` is 5.06 s of it, for sixteen tests — §3, S6 |

**The tranche's own timeline**, from the commit log, because §6 sizes the next
cycle from it: the audit was recorded at 21:45, wave 1 launched at 22:09, the
parallel pool was empty by 23:33, and the serial mechanism chain ran from
23:18 (wave 3) to 03:48 — seven slots in four and a half hours, about 39
minutes each. The two slots with a YELLOW took 62 and 50 minutes; the one with
three review rounds and a confirming review took 54; the three clean ones took
25, 27 and 43. That is the shape of the overrun: the chain, not the pool, and
escalations and review rounds inside the chain rather than implementation.

## 2. The pending-casting representation

### 2.1 The correct representation, and why the decided direction needs no refinement

`GameState.pendingCasting: PendingCasting | null` (`events.ts:962`) becomes
`pendingCastings: Readonly<Record<string, PendingCasting>>`, keyed by casting
id and iterated in casting-number order — the ordering `castingsEnded` already
uses, so serialisation stays byte-identical whatever order two castings were
declared in. The **record shape does not change**: `PendingCasting` is the
value, and it already carries every fact a settlement reads back (targets,
origin, area, the four stated facts, the deadline, `completesAt`,
`lastsSeconds`, the check). `spell-declared` already carries the whole record
as `event.casting` (`events.ts:1583`), so **neither frozen log needs
regenerating** — `golden-log-2.json` has two declarations and one interruption
and they fold into the keyed record exactly as they folded into the slot. The
one persistence-visible change is the state field's name and shape, and no
state snapshot is persisted anywhere yet; the log is.

Every invariant the owner listed holds under this representation without a
second mechanism, and the evidence that no refinement is needed is that
**every reader that already addresses a casting by id keeps working
unchanged**: `releaseCasting` clears the record whose id matches
(`events.ts:2451`), the settling branch of `spell-cast` matches on id
(`events.ts:4572`), `spell-interrupted` names its id (`events.ts:4535`), and
every Concentration reader (§2.3) compares `castingId`. The slot was never the
identity; it was the storage. Fable's IE-034 decision — keyed by casting id,
**one open casting per caster** enforced by the reducer — stands, and the one
clarification worth writing down is why one-per-caster is a safe backstop
rather than a rule that could bite: a Counterspell resolves in one breath and
is never pending unless it is *held*, a Bonus Action spell resolves in one
breath, and a long casting is a creature's one Concentration — so the only way
a caster comes to have two open castings is holding a second window open
beside their own, which is the nesting case §2.6 keeps as an explicit limit.

### 2.2 Every single-pending assumption, and what each becomes

Sixteen sites in seven runtime modules read the slot. Classified by what they
assume, because the fix differs by class:

| Class | Site | Assumes | Becomes |
|---|---|---|---|
| **Global refusal — known wrong** | `commands/spell-resolution.ts:358` `castOrRelease` | "a casting is open, therefore any other casting is refused" (`casting_pending`, exempting only a `casting-a-spell` trigger) | **deleted.** Replaced by the per-caster rule: the caster of an open casting may not begin a casting that spends the Magic action; a Reaction and a Bonus Action are permitted (IE-034's decision). Another creature's casting is simply legal |
| | `commands/activation.ts:133` | the same, copied for activations, with no exemption at all | **deleted**; the per-caster rule keyed on the action the activation spends |
| | `commands/turns.ts:740` `resolveTurn` | "a pending casting exists, so the turn may not advance" | **kept, reading the record's size** — in combat today every pending casting is an instant window, so it is engine debt exactly as a held attack is. It becomes per-casting when the in-combat long casting lands (§6, T6): a casting with `completesAt` set does not block the turn, and its caster's turn boundary derives the obligation |
| **Reads "the" casting** | `commands/spell-resolution.ts:177` `resolveDeclaredCast` | takes **no casting id**; settles whatever is open | takes `castingId`; refuses `no_casting_pending` naming it. **Public API change** — `index.ts` re-exports it |
| | `commands/spell-resolution.ts:2393` `resolveInterruptCastingEffect` | Counterspell interrupts THE open casting | interrupts the pending casting **whose caster is the target** — the forced target is the caster, so the lookup is by caster; `nothing_to_interrupt` if none |
| | `commands/casting.ts:168` `triggerRefusal`, `casting-a-spell` | the forced target is `open.caster` | the named target must be the caster of *a* pending casting; `no_trigger` when none is open; `forced_target` naming the casters who are, when the request named somebody else — which preserves what IE-034 split the two codes to mean: wait, versus re-send |
| | `commands/reactions.ts:892` `reactionOpportunities` | one casting yields offers | every pending casting yields offers to every creature other than its caster |
| | `commands/holds.ts:59` `settleHoldsInvolving` | at most one casting to interrupt for a departing caster | interrupt every pending casting by the departing caster (at most one under the reducer invariant) |
| | `commands/holds.ts:219` `pendingCastingOf` | returns the slot | `pendingCastingsOf(state)` (sorted list) and `pendingCastingBy(state, caster)`; the barrel and `index.ts` change with it |
| **Reducer invariant** | `events.ts:4422` `spell-declared` | throws if any casting is pending | throws if **this caster** already has one — the corrupt-log backstop for the per-caster rule; the sequential-id check stays |
| | `events.ts:4535` `spell-interrupted` | reads the slot, then checks the id | looks the id up; throws if absent |
| | `events.ts:4572` `spell-cast` | `settling = waiting?.castingId === event.castingId` | a lookup by id; already the right shape |
| | `events.ts:2451` `releaseCasting` | clears if the slot's id matches | deletes the key; already the right shape |
| | `events.ts:1052` `initialState` | `pendingCasting: null` | `pendingCastings: {}` |
| **Idempotency** | `commands/spell-resolution.ts:172` `once(state, 'settle-cast', command, …)` | one settlement kind for the whole engine | `settle-cast:${castingId}`, and the id in the fingerprinted inputs, so two settlements under one command id are two commands and a recycled id is refused as it is everywhere else. The replayed answer still recovers the casting id through `commandOutcome` |
| **Prose** | `spell-definitions.ts:177`; `CLAUDE.md` "A Casting Can Be Interrupted" ("one pending casting, no stack") and the paragraph "A casting in process is one engine-wide" | | rewritten by the task; the sentence "the reducer branches on the id, not on 'is anything pending'" was already right and stays |

The command-layer sites that hold the wrong behaviour are all in the second
column's first block; the reducer sites are already id-shaped or one line
from it. This is why the task is bounded: the representation is wrong in one
field and the *readers* are mostly right.

### 2.3 Concentration, and the identity relationship

`creature.concentration` is `{ castingId, spell, level }` (`spells.ts:107`),
and since IE-034 it may name a **pending** casting (a rite) as well as an
ongoing one. Every reader was checked and every one compares on `castingId`
or reads only what a pending casting can honestly answer:

- `breakLostConcentration` (`events.ts:2690`), the `concentration-ended`
  case (`events.ts:4623`), `expireEffects`' `casting` target
  (`events.ts:3696`), `creature-removed` (`events.ts:4199`) and
  `dropLapsedReady` (`events.ts:4087`) all route to `releaseCasting`, which
  drops the pending record by id — the single door IE-034 made single.
- `holdsNothingOf` (`events.ts:3751`), `ongoingSpellsBy`, `ongoingSpellOf`
  and the Dispel readers read `state.ongoing` and never `concentration`, so a
  rite is invisible to them — correct, because a casting that has not taken
  effect owns nothing and there is nothing to dispel.
- `concentrationSaveAfterDamage` and `resolveDamage`'s `already-lost` branch
  (`casting.ts:1108`, `:1205`) read the id and the display name only.
- `castSpellWith` breaks a prior Concentration before a new one
  (`casting.ts:601`), which is what ends a rite when its caster starts
  another Concentration spell — SRD's own rule, arriving through the id.

So **the identity relationship is already right**: a Concentration names a
casting, a casting is pending or ongoing, and nothing assumes the id is in
`ongoing`. The keyed record changes none of it. One reader *does* conflate
"the casting" with "whatever the caster is concentrating on", and it is not a
pending-casting reader at all: `endSpellEffectOn` (`casting.ts:1005`) finds
the casting to release through `caster.concentration`, so it cannot address a
non-Concentration ongoing spell and has **no production caller** (the Dispel
resolver writes `spell-ended` directly). It is the last place a casting is
addressed by whoever holds it rather than by id — §3, S7 replaces it.

### 2.4 Persistence and replay

Two declarations and one interruption in `golden-log-2.json` fold through the
slot today and will fold through the record tomorrow without a fixture change,
because the reducer decides storage and the events carry the value. What
changes in the fixture's *test* is one line: `persistence-2.test.ts:174`
asserts `state.pendingCasting` is null at the end and will assert the record
is empty. `scenario.test.ts`'s re-run determinism is untouched: casting ids
are sequential from `castingsBegun`, which the keyed record does not move.

### 2.5 The tests that pin the debt, and the one exemption that reasons from the slot

Four tests assert the known-wrong behaviour and are **inverted**, not
preserved; two more assert the turn refusal and stay:

| Test | Pins | Becomes |
|---|---|---|
| `long-casting.test.ts:815` | a second creature refused `casting_pending` for the whole rite | inverted: the cleric casts Cure Wounds while the wizard's Ritual runs, and both castings stand |
| `long-casting.test.ts:848` | the same, nine minutes in | inverted |
| `counterspell.test.ts:641` | another creature refused while Hold Person is held open | inverted: both pending, each settled by its own id |
| `ongoing-spells.test.ts:1235` | an activation refused while somebody else's casting is open | inverted |
| `long-casting.test.ts:404`, `counterspell.test.ts:215` | `resolveTurn` refuses while a casting is open | **kept** — still debt in combat (§2.2), and the reason string changes to name the casting |

Three neighbouring assertions are about the caster's *own* open casting and
the nesting limit (`counterspell.test.ts:668`, `:726`; `long-casting.test.ts`'s
"lets a creature who is not casting act") and stay, under the codes §2.6
names. Ten other test files read `state.pendingCasting` by name — mechanical
renames.

The **`nothing_to_interrupt` exemption** in `refusal-sweep.test.ts:127` argues
its unreachability from the slot in so many words — "its `spell-cast`
allocates a fresh casting id rather than settling the open one, so
`pendingCasting` still stands". Under the keyed record the resolver looks the
casting up by the forced target's caster, so the re-read agrees with the
trigger by construction rather than by the window being unique; the code stays
unreachable and the reason has to be rewritten to say why. A written exemption
that reasons from a representation the task removes is the kind of stale
source the sweep exists to catch, and the task should treat the rewrite as
part of the acceptance criteria rather than as prose.

### 2.6 What deliberately stays, and what is named rather than built

- **Counterspell answering a Counterspell stays refused, as an explicit
  per-casting limit under its own code** — not as a consequence of the record
  having one slot. SRD 2024 permits it (a creature casting Counterspell is "in
  the process of casting a spell"), so this is a legal play the engine refuses,
  and lifting it needs one rule the engine does not have: a casting whose own
  answer is pending may not settle first — a settle-order rule over the keyed
  record. That is a bounded design question and a semantic change, so it is
  **named for the cycle after this one** (§6.7) rather than smuggled into a
  representation task. `casting_pending` today carries three rules (another
  creature's casting; the caster's own; nesting) — the shape `no_trigger` was
  split for in IE-034 — and the task leaves it carrying one, with the nesting
  refusal under a distinct code.
- **`resolveTurn`'s refusal stays global** until the in-combat long casting
  gives a pending casting a turn to be pending across (§2.2).
- **The per-caster Magic-action refusal is a policy the engine already
  applies**, kept as-is. The SRD-literal alternative — a second Magic action
  *fails* the rite rather than being refused — is a semantic choice for the
  in-combat half, where "each of your turns" gives it a moment to happen.

## 3. Simplification findings, ranked by leverage over regression risk

Each carries what exists, why it is unnecessary now, the evidence, the
invariant that must survive, the risk, and the leverage — compressed, because
the six-point structure is the same for all of them. Prefer deletion, then
derivation, then consolidation, then a new abstraction; none of these needs
the fourth.

### S1 — Split `events.ts` along the fold's own seams (consolidation; the largest leverage)

**Exists:** one 5,363-line module holding the state types (1–1,061), the
`GameEvent` union (1,062–2,130, 94 declarations with their docstrings),
`CorruptLogError`, the release and cleanup machinery (2,335–2,680), the area
detectors and turn-boundary raising (2,882–3,570), expiry and the triggered
endings (3,641–3,970), the derived-pass pipeline (`applyEvent`, 3,974), and
`applyOne` (4,151–5,341, a 1,190-line switch over 108 cases).

**Why unnecessary now:** the single file is what the one-owner-per-primitive
rule serialises. Seven of tranche 5's ten mechanism tasks touched it —
IE-020 → 028 → 030 → 032 → 033 → 034 → 035 — and that chain *was* the tranche's
critical path (§1). Read by domain, those seven touched four different regions:
a record field (020, 030), a grant family and its reducer case (028, 033, 035),
a derived pass (032), the casting cases (034). Under a split by those seams,
IE-030 ∥ IE-032 ∥ IE-033 would have been concurrent, and the next cycle has
the same shape: T1 (casting cases), T2 (creature entry), T6 (turn passes and
casting), T9 (a grant family) — §6. The delta audit deferred the split because
"a 4,800-line split would stall every mechanism task behind it"; at a tranche
boundary with nothing running, the stall is one wave.

**Evidence the consumers permit it:** `commands.ts` is the precedent — IE-005
found the old command file's value graph acyclic (148 declarations, 148
components) and moved along a topological order with declaration-level
byte-identity as the oracle; IE-027 did the same inside `resolveEffects`.
Nothing outside `events.ts` reaches its private helpers; the public names
(`applyEvent`, `fold`, `historyOf`, `castingIdFor`, `grantSourcesOf`,
`withoutGrants`, `allyOfCaster`, `wearsHeavyArmor`, `mergeItems`,
`initialState`, the types) can be re-exported from a barrel exactly as
`commands.ts` does.

**Shape** (the foreman verifies the value graph first — a ten-minute script in
the shape of `invariants.test.ts`'s `DECLARATION` walk; a cycle is a YELLOW,
and none is expected because every helper is called from `applyOne` or a pass
and calls downward): `state.ts` (the types and `initialState`); `events.ts`
kept as the **union only** — the schema, which is what five test files read by
path; and a `fold/` directory: `release.ts` (the enumerator, `releaseCasting`,
`releaseOnTarget`, `releaseGrants`, `withoutTarget`, `holdsNothingOf`),
`areas.ts`, `turns.ts` (`raiseTurnSaves`, `raiseTurnEnd`, `reachStartOfTurn`),
`expiry.ts` (`expireEffects`, `dropLapsedReady`, `endLostFeatures`),
`endings.ts` (`endTriggeredCastings`, `allyOfCaster`), and `apply.ts`
(`applyOne`, `applyEvent`, `fold`). `applyOne` itself can stay one switch —
the `never` default is the guarantee worth keeping — or be dispatched by domain
into partial switches each with a `never` default, which is IE-027's exact
move; the first is safer for a behaviour-preserving pass and the second can
follow.

**Invariant:** both frozen logs fold to the same state, `scenario.test.ts`'s
re-run determinism holds, and every moved body is byte-identical to its
source after the mechanical transformations the task declares — the IE-027
oracle. **Known blast radius:** five tests read `events.ts` by path —
`persistence.test.ts` and `persistence-2.test.ts` (`declaredEventTypes` reads
the union: unchanged if the union stays there), `invariants.test.ts` (the
emitted-type sweep excludes `events.ts` by name and must exclude the new
reducer files too, or it would count reducer `case` labels — it matches
`type: '` in a type position, so `case 'x':` does not match, but the sweep's
exclusion comment should say so), `speed.test.ts`'s single-reader sweep (its
population gained `events.ts` in IE-031 and must gain the new fold files),
`declared-fact-commands.test.ts` and `spell-schema.test.ts` (read the union).
**Risk:** low with the oracle; the one thing that can go wrong is a helper
that reads module-level state, and there is none — the file is pure. **Leverage:**
every future mechanism task; this is the item the delta audit named first.

### S2 — Delete the regex shape classifier and its hand-kept blocker column from the coverage report (deletion)

**Exists:** `coverage-data.ts:71` `SHAPES` — thirteen prose regexes filing
every parsed spell under "the hardest thing its text needs" — and
`coverage.ts`'s "By mechanical shape" table with a hand-written "Blocked on"
column. **Why unnecessary now:** `missing-shapes.ts` answers the same question
derived, over three populations, with two numbers. The two tables disagree in
the same report today: the classifier files 43 spells under "Casting time of a
minute or more" and says they are blocked on "a casting-in-progress state
machine with a per-turn obligation", while the derived table says 54 touched,
12 finished, and IE-034 built the out-of-combat half — the three-documents-
three-answers class, inside one file. **Evidence:** `coverage.test.ts` asserts
nothing about `byShape`; the classifier is report-only. **Invariant:** the five
top-line counts and the derived table are unchanged. **Risk:** none.
**Leverage:** one fewer instrument to drift on every mechanism.

In the same pass, **derive `PARTIAL_SPELLS`** (`coverage-data.ts:202`) from
`ADJUDICATED` — the spells with any entry whose `why` is not `'table'`. The
list was kept by hand only because the map lived in a test file; IE-015 moved
the map to `scripts/missing-shapes.ts`, so the reason is gone and the
both-directions assertion in `spell-honesty.test.ts` becomes a tautology to
delete. `VERIFIED_SPELLS` stays a hand list: it is a claim about which tests
drive which spell, and nothing derivable says that.

### S3 — Stop maintaining `OngoingSpell.on`; derive it (derivation, with measured evidence)

**Exists:** `on` is written at the cast (caster and `held`), **grown** by
`alsoOn` when a triggered effect lands (`events.ts:2946`), **shrunk** by
`expireEffects` when the last owned effect lapses (`events.ts:3641`), and
edited by `withoutTarget` on creature removal (`events.ts:2505`) — a stored
derivation kept in step by three passes, and CLAUDE.md records the bug that
shape produced (a stale name that let a creature dispel a spell no longer on
them). **Why unnecessary now:** the rule is one sentence — *a casting is on a
creature while it has a live effect there that the casting owns* — and
`holdsNothingOf` already computes exactly that from conditions and
`grantSourcesOf`. **Evidence:** folding `golden-log-2.json` at every prefix
and comparing the stored `on` of every ongoing record against "the caster
where the record says so, plus every creature holding an effect whose source
carries the casting id" gives **869 checkpoints, 0 mismatches**
(`golden-log.json` has no ongoing records). **Shape:** keep `on` on the record
and in `spell-ongoing` as written at the cast (the caster half is the one bit
the derivation cannot recover, and it is already there); delete the three
maintenance passes; make `ongoingSpellsOn` and the Dispel readers ask the
derived question. **Invariant:** every Dispel Magic, `withheldEndings` and
area-trigger answer is unchanged — a test asserting stored-equals-derived
after every event of both fixtures and of the ongoing-spells suite is the
gate, and it should be written **before** the passes are removed. **Risk:**
low-medium (a reader of `on` that wanted "on at the cast" rather than "on
now"; none found). **Leverage:** three passes and one class of bug gone.

### S4 — Make the command stamp a property of the event envelope (consolidation)

**Exists:** `readonly command?: CommandStamp` declared sixty times across the
union, and a sweep in `invariants.test.ts` ("every event a command stamps
declares that it carries one") that exists because the compiler cannot see
the omission — excess-property checking on a union accepts a field any member
declares, a trap CLAUDE.md records three times. **Why unnecessary now:** the
stamp means the same thing on every event and `recordCommand` reads it
generically; declaring it per member is repetition the type system can carry
as `GameEvent = Stamped<EventPayload>` with `Stamped<T> = T & { readonly
command?: CommandStamp }`. **Invariant:** the log shape is unchanged — the
field is optional and already present on those events; events that never
carry one still never do. **Risk:** low, type-level only; one sweep is deleted
because its claim becomes structural. **Leverage:** one line and one sweep
failure fewer per new command event, and the trap closed rather than swept
for.

### S5 — Move the definition format's types and readers out of `spell-definitions.ts` (consolidation)

**Exists:** one 7,667-line file holding the format's types (1–1,850), a dozen
readers (`onCaster`, `persists`, `conditionRiderOf`, …, 1,855–2,190) and the
catalogue with its registry. The workflow already treats it as two files (A
owns content, B owns "the type declarations at the top"), and every content
task collides with every union task in it — IE-035 ∥ IE-036 were parallel-safe
"on registry lines alone". **Why unnecessary now:** the split is a move with
no consumer change; the readers are what the command layer imports. **Shape:**
`spell-format.ts` (types and readers), definitions and registry stay. **Known
blast radius:** the zero-user-member sweep reads declarations in
`spell-definitions.ts` by path and the special-case sweep allows the `id:`
construct in that file; both move with the types. **Risk:** low. **Leverage:**
content beside mechanism without a shared file. Sequence **after IE-036**, so
twelve definitions land before the file they land in is reorganised.

### S6 — Make the frozen log's prefix test O(n) (optimisation, in the one test that dominates)

**Exists:** `persistence-2.test.ts:339` folds 551 events at 552 prefixes
twice — once through a JSON round trip — and carries a 30-second timeout it
was given after failing intermittently; it is 5.06 s of the suite's 23.9 s
summed file time, for sixteen tests. **Why unnecessary now:** `fold` is
`events.reduce(applyEvent, initialState(seed))` (`events.ts:5341`), so
"folding every prefix of a round-tripped log equals folding every prefix of
the original" is the same claim as "applying each round-tripped event to the
previous equal state gives an equal state" — one pass, 551 applications, an
equality after each. **Invariant:** the same property at the same 552 points;
the test still asserts a fold and not a speed. **Risk:** none. **Leverage:**
the suite's slowest file becomes ordinary and the timeout paragraph is deleted.

### S7 — Retire the two barrel commands with no production caller, and let a casting be ended by id (deletion, then a narrower replacement)

**Exists:** `resolveCast` and `endSpellEffectOn` are published through
`commands.ts` and `index.ts`, guarded, swept, and called by nothing but tests
(`resolveCast` is a "low-level half" whose one production use, Divine Smite,
goes through `resolveCastWith`; `endSpellEffectOn` reads the caster's current
Concentration to find the casting, §2.3). **Why unnecessary now:** the second
is the last id-by-holder conflation in the command layer and cannot end a
non-Concentration ongoing spell, which CLAUDE.md lists as a gap ("A
non-Concentration ongoing spell cannot be dismissed early … Adding one is
small and deliberately not in this milestone") and `missing-shapes.ts` files as
`a-casting-dismissed-early` (3 blocked). **Shape:** delete `endSpellEffectOn`;
add `endOngoingSpell(castingId, on: creature | null)` emitting `spell-ended`
— the event and both reducer branches exist, the Dispel resolver already
writes it — guarded by the caster's identity and the Incapacitated clause SRD
prints. Demote `resolveCast` from the barrel to a module export (tests import
the module). **Invariant:** `spell-ended`'s two meanings are unchanged.
**Risk:** low; an API change recorded as one. **Leverage:** closes a documented
gap and removes a second way of addressing a casting.

### S8 — A test-support module for the fixtures every file copies (consolidation, adopt going forward)

**Exists:** 59 test files define their own `sheet(` helper, 69 hand-write
`creature-added`, 41 hand-write `spellcasting-declared`, 25 read source or
prose off disk with their own readers, and three files each rebuild the SRD
prose map from `spells.json`. **Why unnecessary now:** the shapes are copies,
so a fixture correction is fifty edits and a new test file starts with sixty
borrowed lines. **Shape:** a `test-support/` module — a wizard, an ally, a foe,
a scene with landmarks, the nine slot pools, `declaredCasting` presets, the
prose map, the barrel-name reader `invariants.test.ts` and
`refusal-sweep.test.ts` each carry — adopted by new tests and by files a task
touches anyway; **not** a sweep converting 59 files, which would be a large
no-behaviour diff colliding with everything. **Risk:** low if incremental.
**Leverage:** developer friction, mostly; it also makes fixtures that
discriminate (the multiclass, the Rogue who resists) reusable rather than
rediscovered.

### S9 — `TurnBudget.attacksRemaining` is the movement remainder's shape (record now, convert with its consumer)

`combat.ts:164` stores a remainder seeded from `sheet.attacksPerAction`, which
is sound only while nothing raises the allowance mid-turn — the exact reading
IE-031 corrected for movement ("a stored remainder is a derived quantity
frozen at its seed"). Nothing raises it today, so this is non-semantic and not
urgent; the day Extra Attack or Action Surge's second attack lands, the
representation is wrong in the way movement's was. The rule from IE-031
applies unchanged — store `attacksMade`, derive what is left — and the task
that builds the first raiser should carry it. Recorded so that brief does not
rediscover it.

### S10 — Retire the prose the derived instruments replaced (documentation, safe because the citation guard holds it)

`PROGRESS.md` (2,208 lines) carries three superseded ranked maps that now say
"unchanged" against a derived table, and CLAUDE.md's "Known Pending Work"
bullet says of itself "Do not count from this bullet at all; it is the prose
the map replaced, kept because several shape descriptions still cite it". That
is a document kept alive by the guard that quotes it. The guard resolves a
citation by naming, so retiring a paragraph fails every description that
quoted it and forces a re-citation to the live source — which is the guard
working, and why this is safe to do as a bounded docs task rather than
dangerous. Point the maps at `COVERAGE.md`'s derived table and move each cited
sentence to the document that now owns the fact.

### S11 — Candidates inspected and refused, with the measurement that refused them

- **`Combatant.speed` as a second base for `speedOf`** (`standing.ts:1104`)
  looked like a persisted duplicate of `sheet.baseSpeed`. Both frozen logs
  refute it: the rat enters combat at 20 feet with a sheet that says 30
  (`golden-log.json` at index 22, `golden-log-2.json` at index 207), so the pinned
  number is load-bearing in a replay and the "two bases" are one fact stated at
  the fight and one generic sheet. Keep; CLAUDE.md's "harmless today" should
  say "pinned by the fixtures".
- **Further abstraction of `resolveEffects`:** no. The three mutations that
  survive the suite (Dispel's inner `continue`, the state threading, the `from`
  wiring — recorded in CLAUDE.md) are **test gaps**, not structure gaps; the
  answer is three small cases in the conformance lane (a Dispel at a target
  carrying two ongoing spells that fails the first check; an effect list whose
  second effect reads the world the first left; Spiritual Weapon's Prone rule
  read from the point), not a refactor.
- **Command-module topology:** the value-level import graph is a DAG; the
  three back-edges (`ongoing → activation`, `rolls → casting`,
  `targeting → casting`) are `import type` only. The docstring's DAG claim
  silently depends on those staying type-only; an `import type` lint rule
  would make it structural for the price of one config line. Not worth a task.
- **`index.ts` tiering and per-event schemas:** 28 star re-exports, roughly
  seven hundred names, reducer internals beside commands. Real, and still
  without a consumer; the first tool surface is the evidence that says which
  tier is which. Wait for it, as the last two audits said — with one note:
  T1 changes two public names, and the change should be recorded as an API
  change in the digest so the eventual tiering has a record to read.
- **Generalising the four stated facts** (`damageType`, `unaffected`,
  `fought`, `teleportTo` — each hand-plumbed through the request, `declaredFacts`,
  the pending record, `statedFacts` and the ongoing record): four instances is
  evidence, but the storage is persisted on `PendingCasting` and the four
  validators differ in kind, so what could generalise is the plumbing, not the
  fields. Defer until a fifth fact (Hex's chosen ability) is briefed, and
  generalise the plumbing in that task.
- **`reaches` ×2, `creatureOf` ×2, `derive` ×2:** different contracts each
  time (a reaction's reach with sight and an `unverified` line against an
  aura's reach with allegiance and death; a throwing reader against a nullable
  one). Not duplicates.
- **`SPLIT_BUNDLES`, the 57 corrupt-log backstops, the `castingsEnded` and
  `appliedCommands` growth:** history checked as arithmetic, backstops by
  design, and the snapshot policy that is M3's. Unchanged.
- **Refusal and context-request plumbing:** one exemption each, both honest;
  the request exemption (`unknownCreature` names an event) ends when a command
  adds a creature — §4, C2 — and the refusal exemption is rewritten by T1 (§2.5).
- **Runtime micro-performance:** not part of this audit by the workflow's own
  rule, and nothing measured here suggests it should be.

## 4. Correctness before capability

Ranked; each outranks every mechanism in §6.4.

- **C1 — `pendingCastings` keyed by casting id.** §2 in full. The engine
  refuses every other creature's casting and activation for the whole of a
  ten-minute rite, pinned by three tests as known debt. IE-036's twelve
  definitions and the in-combat long casting both build on this record; the
  Counterspell-on-Counterspell lift needs it; nothing else may land on the slot.
- **C2 — No command puts a monster into a game, and a stat block's printed
  condition immunities never reach state.** `adaptMonster` (`monster.ts:186`)
  produces `defenses.conditionImmunities` and `conditionApplicability`
  answers three ways — and **nothing outside `monster.ts` calls either**;
  `creature-added` (`events.ts:1065`) carries `sheet`, `maxHp`, `creatureType`,
  `defenses` (damage only) and `side`; `applyConditionTo` consults an
  `immuneTo` list only its caller supplies (`commands/conditions.ts:34`), and
  the one caller passes what a spell resolver hands it. So every monster in
  every test is a hand-written event, M2's tool surface has no way to add one
  without folding an event itself — the one thing the layer above the engine
  must never do — and a Zombie is Poisoned by Ray of Sickness like anybody.
  The fourteenth instance of a pure function nothing calls, and the largest
  since the scene commands. Two halves, one task: an `addCreature` command
  wrapping `adaptMonster` (which also ends the `unknownCreature` request's
  written exemption, §3 S11), and `CreatureState.conditionImmunities` written
  from the stat block, read by `applyConditionTo` through one gatherer
  (`conditionImmunitiesOf`, the `defensesOf` shape), with qualified entries
  staying `needs-adjudication`. This is also the storage a **granted**
  condition immunity (Mind Blank; 10 blocked, 1 finished) joins as the seventh
  sourced family — the order is printed first, granted second, not the reverse.
- **C3 — `endSpellEffectOn` addresses a casting by its holder** — §2.3, §3 S7.
- **C4 — Tranche 5 behaviour pinned as known debt**, each with its disposition:
  the three `casting_pending` tests (C1); `long-casting.test.ts:318`'s
  assertion that cannot fail (a one-line tidy in T1, same file); a rite open
  when `beginCombat` fires wedges the fight — `resolveTurn` refuses and
  settlement refuses until a round-derived clock arrives (T6 owns it);
  **a readied spell cannot state a stated fact**, so the three Dominates
  cannot be readied at all (`ReadiedResponse` carries a spell id, a casting id
  and a level — a small correctness task, §6.3 T7); the map's population floor
  set one above the live value (fixed to `> 150`, fine); **a Dash's gained
  movement survives a later Speed of 0** — an open SRD reading the engine has
  not decided, sentence in the code, no action; `bad_partial_recovery` still
  reaches the reducer and throws where `bad_key` was made a value (one line,
  pool candidate); and **Ray of Frost refused outside combat** because its
  rider is turn-anchored — recorded for the owner, and §6.6 says why it is
  RED rather than a Duration member.
- **C5 — IE-036 immediately after C1: yes.** Its fixtures drive declaration →
  `advanceTime` → settlement, and the settlement's signature changes in C1; its
  most natural demonstration is a second creature acting during the rite,
  which is the behaviour C1 corrects; and it depends on nothing else. Writing
  it first means writing it twice — Fable's IE-034 reasoning, unchanged.
- **C6 — What else would otherwise build against a known-wrong
  representation:** the in-combat long casting (must be a per-casting turn
  obligation on the keyed record); the Counterspell-on-Counterspell lift (a
  settle-order rule over the keyed record); summons' lifecycle (needs the
  `addCreature` half of C2 first, and then a way to tie a creature's presence to
  a casting — `releaseCasting` removing a creature is a new consequence and a
  design question, §6.7). Sequenced accordingly in §6.

## 5. Adjudication completeness, and whether it needs a stronger source of truth

**The three populations carry three different amounts of evidence, and the
misses line up with the least.**

| Population | Record | Anchored to | What it cannot see |
|---|---|---|---|
| executed (96) | `ADJUDICATED`: `{ clause, why, note }` per spell | a distinctive phrase that must match **exactly one** of the definition's own `unmodelled` strings, both directions | a clause the author never wrote into `unmodelled` — the population is self-reported |
| tracked (45) | `TRACKED_ADJUDICATED`: one adjudication per **marker kind** per spell | the spell's SRD paragraph, scanned for thirteen marker regexes | two clauses hitting one marker share one licence; a sentence using none of the thirteen words (Gate, Etherealness — already noted) |
| undefined (201) | `BLOCKED_ON`: a **list of shape ids** | nothing — no clause, no quote, no note | any omitted blocker; an entry `['a-long-casting-time']` for a spell with three blockers passes every guard |

The five wrong "finishes" predictions (Mind Blank, Protection from Energy,
Enthrall, Magic Weapon, True Strike) and the two blockers found by reading
(Hex's third sentence, Mislead's double) were **all omissions in the undefined
map** — never a wrong entry, always a missing one — and every one was caught
by a builder reading the paragraph. The instrument that would have caught them
before a brief was written does not exist, because `BLOCKED_ON`'s completeness
guard asks only "does every undefined spell have an entry" (`coverageGaps`),
and a bare list cannot say which sentences were read.

**The repository already has the right primitive, in the executed map.**
`Adjudication.clause` — a phrase that must match exactly one clause of a text,
asserted both directions, so a reworded clause has to be read again — is the
whole of what "this clause was inspected" needs. What the undefined map lacks
is (a) a *text* to anchor to, which for an undefined spell can only be its SRD
paragraph (the tracked guard already reads it off `spells.json`), and (b)
coverage asserted at the **sentence** rather than at the marker-kind or the
whole-spell level. So the recommendation is **not another hand list**; it is
the existing entry type pointed at the existing text:

1. `BLOCKED_ON` entries become lists of `{ clause, why, note }` where `clause`
   is a distinctive phrase from the spell's parsed paragraph, `why` is a shape
   id, `'table'`, or `'expressible'` (the tracked guard's third value, `engine`,
   under the name that fits a spell with no definition), and the guard asserts
   each phrase occurs exactly once in that paragraph — the honesty guard's
   `PROSE` technique, already written.
2. A **sentence-coverage** guard: split the paragraph into sentences, and for
   every sentence that trips a marker (the honesty guard's 24 are the wider and
   better set), require at least one adjudication whose phrase lies inside it.
   That is the four-state claim the owner asked for — modelled, table-owned,
   deliberately unsupported, or blocked on a named shape — made per sentence
   and derived from the book rather than from a list.
3. `consumersOf` reports **two `finishes` numbers**: finishes among entries
   that are sentence-complete, and finishes among the rest. The difference is
   the finding, exactly as `blocks` against `unblocks` was, and a tranche is
   briefed only from the first.
4. The tracked map takes the same entry type, which removes its
   one-per-marker-kind limit for free; the executed map gains the sentence
   guard as an **opt-in ratchet** — a definition may declare `covers` phrases
   for the sentences its effects implement, and where it does, the guard
   demands the paragraph be fully accounted for by `covers` plus `unmodelled`
   plus `ADJUDICATED`. New and changed definitions must carry it; the backlog
   need not, which is the shape every exemption list here already takes.

**Cost, honestly:** re-anchoring 201 entries is the paragraph-by-paragraph
read IE-002 did once in prose, and it is hours of content work. It does not
have to happen at once. The instrument (steps 1–3) is small and lands in this
cycle; the **workflow rule** — no shape is briefed from an `unblocks` list
whose spells are not sentence-complete — makes the backfill happen family by
family, exactly when it is worth something, and this cycle's own families
(`a-long-casting-time`'s twelve, which IE-036 defines anyway, and condition
immunity's ten) are the first. The alternative of representing SRD clause
boundaries explicitly in the parser was considered and refused: a sentence
split at test time over prose the repository already reads is enough, and a
parsed clause structure would be a data model with one consumer.

## 6. The next development cycle

### 6.1 Throughput, from tranche 5's own timeline

The chain is the wall clock (§1): about 39 minutes per serial mechanism slot,
25–45 clean, 50–62 with a YELLOW or three review rounds. The pool empties
early. So the cycle is sized as a **chain four deep with six mechanism
slots** — two waves carry two independent slots each, which the `events.ts`
split (T3) is what makes independent — beside a pool of five conformance,
tooling and content tasks. Green path: roughly four and a half hours of
chain. Risk-adjusted, with one YELLOW and two multi-round reviews inside the
chain: six and a half to seven and a half. That sits inside the owner's target
and leaves room for one optional slot (§6.5).

### 6.2 Goals, ranked, and why each outranks the alternatives

1. **Correctness: the keyed pending-casting record (T1).** Known-wrong
   behaviour pinned by tests; three later tasks build on it. Nothing else may
   go first.
2. **Simplification before more mechanisms accumulate: split `events.ts`
   (T3).** Outranks capability by the owner's own test — delaying it makes
   every mechanism task in this cycle and the next serial behind a file none
   of them wholly needs, and it is cheapest at a tranche boundary.
3. **Correctness: monsters enter through a command with their printed
   immunities (T2).** A shipped wrong number with no symptom, and the
   foundation both condition-immunity and summons need.
4. **Content the mechanism already paid for: IE-036 (T4).** Twelve spells,
   deferred once for the right reason, ready the moment T1 merges.
5. **Capability the map ranks and the record now supports:** the in-combat
   long casting (T6, finishing the largest blocker's second half and
   discharging a recorded wedge); a granted condition immunity (T9, the seventh
   family through the enumerator, Mind Blank finished, ten touched); the
   `end-of-current-turn` moment (T8, one small member with three named
   consumers).
6. **Source of truth:** the adjudication instrument (T5) lands beside the
   chain, so the cycle after this one is briefed from sentence-complete
   entries.

### 6.3 The tasks

**The chain** (mechanism; each names what is decided and is GREEN unless a
question is named):

| | Task | Decided design | Surface | After |
|---|---|---|---|---|
| **T1** | `pendingCastings` keyed by casting id | §2 in full: the record shape unchanged; one open casting per caster in the reducer; the global refusal deleted from the casting and activation paths and replaced by the per-caster Magic-action rule; `resolveDeclaredCast` takes the id and its idempotency kind carries it; the Counterspell trigger and resolver address the casting by its caster; offers per casting; `settleHoldsInvolving` per caster; `resolveTurn` reads the record's size; five tests inverted, the nesting limit kept under its own code, the `nothing_to_interrupt` reason rewritten; both fixtures untouched. Two public names change and the digest says so | `events.ts`, `commands/{casting,spell-resolution,activation,turns,reactions,holds}.ts`, the barrel, tests, CLAUDE.md | — |
| **T3** | Split `events.ts` along the fold's seams | §3 S1: `state.ts`, the union kept in `events.ts`, a `fold/` directory, one barrel; `applyOne` may stay one switch; byte-identity of moved bodies as the oracle; the five path-reading tests updated. Precondition: the foreman's value-graph script finds no cycle (a cycle is YELLOW) | `events.ts` → several; `invariants.test.ts`, `speed.test.ts`, the two persistence tests | T1 |
| **T2** | A monster enters through a command, and its printed condition immunities are honoured | §4 C2: `addCreature` wrapping `adaptMonster`, through `once`, emitting `creature-added` (with `spellcasting-declared` where the block casts); `creature-added` gains optional `conditionImmunities` (absent means none, so both logs fold); `CreatureState.conditionImmunities`; `conditionImmunitiesOf(state, who)` as the one gatherer, read by `applyConditionTo` so a caller's `immuneTo` becomes unnecessary; qualified entries stay `needs-adjudication` and come back in `unverified`; the `unknownCreature` exemption falls | `fold/creatures` (after T3), `commands/creatures.ts`, `monster.ts`, `commands/conditions.ts`, the barrel, `invariants.test.ts` | T3 |
| **T6** | The in-combat long casting | The second half of IE-034 on the keyed record. A `continueCasting` command spending the Magic action on the caster's turn against a named pending casting; the declaring turn's action is that turn's Magic action; at the caster's turn end, a pending casting with `completesAt` whose turn saw no `continueCasting` **fails derived-ly** — through `releaseCasting`, no event, the slot never spent, exactly as a lost Concentration — and the settlement is permitted when the round-derived clock reaches `completesAt` (`isDue`, unchanged); `resolveTurn` stops refusing a casting that has a turn to be pending across; `beginCombat` with an open rite simply enters the obligation. The in-combat `unsupported_casting_time` refusal and the recorded wedge both fall. **One bounded question named in advance:** where the derived failure sits in the turn-boundary ordering relative to `raiseTurnEnd` and `pendingTurnStart` — decide it as "before the end-of-turn area debts are raised", and escalate only if a fixture shows a save owed to a spell the same boundary failed | `fold/casting`, `fold/turns`, `commands/{casting,spell-resolution,turns,scene}.ts` | T1, T3 |
| **T9** | A condition immunity a spell grants | The seventh sourced family: `grantedConditionImmunities` on `CreatureState`, `condition-immunity-granted`, a `condition-immunity` effect kind, read by T2's gatherer, ended through the door (`GrantFamily` forces the enumerator line). Mind Blank finished; Heroism, Freedom of Movement, Heroes' Feast, Hallow and the rest lose the clause and stay blocked on their others; the shape id retires or narrows on re-reading | `fold/release` and `fold/grants`, `spell-definitions.ts` types, `spell-schema.ts`, `commands/spell-resolution.ts`, `missing-shapes.ts` | T2 |
| **T8** | The `end-of-current-turn` moment | A fifth `Duration` member, resolved against the turn in progress (one turn-ending away, said on the anchor's own turn) and refused outside combat exactly as its siblings are. Consumers, each read against its paragraph: Stinking Cloud's "Poisoned until the end of the current turn" (a start-of-turn area trigger plus this rider — the spell executes), Superior Hunter's Defense's deadline (its other two pieces stay named), Steady Aim's half. `SPLIT` nothing; a member with three writers is not speculative | `duration.ts`, `spell-definitions.ts` types, `spell-schema.ts`, the class file's note | T3 (independent of T9; runs beside it) |

**The pool** (conformance, tooling, content; parallel-safe unless noted):

| | Task | What it must do | Surface |
|---|---|---|---|
| **T4** | IE-036 — the twelve long-casting spells | The approved brief, unchanged, launched the moment T1 merges; the fixtures drive declaration → `advanceTime` → settlement by id, and one shows a second creature casting during the rite | content; collides with nothing after T1 |
| **T5** | The adjudication instrument | §5 steps 1–3: the clause-anchored entry type on `BLOCKED_ON` and `TRACKED_ADJUDICATED`, the sentence-coverage guard driven over a synthetic omission it must catch, the two `finishes` numbers in `COVERAGE.md`; backfill this cycle's families (condition immunity's ten; the twelve move out with T4). The workflow rule is recorded in `WORKFLOW.md` by the foreman | `scripts/missing-shapes.ts`, `blocked-on.test.ts`, `scripts/coverage.ts` |
| **T10** | Coverage report: delete the shape classifier; derive `PARTIAL_SPELLS` | §3 S2 | `scripts/coverage-data.ts`, `scripts/coverage.ts`, `spell-honesty.test.ts`, `COVERAGE.md`. Not beside T5 (same script file) — after it |
| **T11** | Derive `OngoingSpell.on`; retire the two zero-caller commands; the O(n) prefix test; three `resolveEffects` gap tests | §3 S3 (the stored-equals-derived test first, then the passes), S7 (`endOngoingSpell`, `resolveCast` demoted), S6, and S11's three cases. Four small items in one conformance task because each is under an hour and they share reviewers' context | `fold/release`, `fold/expiry`, `commands/{casting,ongoing}.ts`, the barrel, `persistence-2.test.ts`, spell tests. **After T3** and not beside T9 |
| **T7** | A readied spell can state a stated fact | `ReadiedResponse.spell` carries the stated facts the request carried (`damageType`, `fought`, `unaffected`, `teleportTo`), and `holdSpell` validates them through `declaredFacts` exactly as a casting does; the three Dominates become readiable. Small, and it is the correctness leftover IE-035 named | `events.ts` (the readied type — after T3, `state.ts`), `commands/actions.ts` |
| **T12** | Stamp on the envelope; `spell-format.ts`; the docs pass | §3 S4, S5 (after T4), S10 | types, `spell-definitions.ts`, `PROGRESS.md`, `CLAUDE.md` |

### 6.4 Waves, and what is parallel or sequential

```
Wave 1   T1                        ∥   T5 · T7* · T12(S10 docs half)
Wave 2   T3                        ∥   T4 (IE-036) · T10 (after T5)
Wave 3   T2  ∥  T6                 ∥   T11 · T12 (S4, S5 halves)
Wave 4   T9  ∥  T8                 ∥   (pool drains)
Optional T13 — see §6.5
```

`*` T7 touches the readied type, which is in `events.ts` until T3 moves it;
launch it in wave 1 only if its diff is confined to the type and
`commands/actions.ts`, else in wave 3.

**Sequential chains, by primitive:** the casting cases — T1 → T6; the fold
layout — T1 → T3 → everything in `fold/`; creature entry and immunities —
T2 → T9; `scripts/coverage*.ts` — T5 → T10. **Parallel-safe groups:** T2 beside
T6 and T9 beside T8 are parallel *because* T3 puts them in different fold
modules — if T3 slips, they serialise and the chain grows two slots. T4 runs
beside anything after T1. T11 runs beside T2/T6 but not beside T9 (both touch
the release module).

### 6.5 Optional slot, if the window allows

One of, chosen by the foreman on the clock: **`an-outcome-that-reads-the-targets-hit-points`**
(6 blocked, Power Word Stun finished; a threshold read off vitals before the
roll — GREEN, small); or **the Counterspell-on-Counterspell lift** (SRD-legal,
refused today; needs the settle-order rule — a bounded YELLOW to Fable before
the brief, §2.6). Heal's flat healing is deliberately *not* the optional slot:
`DiceScaling.dice` is required, six resolution paths hand its result to the
dice roller, and the honest change is a sum type on the format rather than an
optional field that silently rolls `NaNd6` — a brief for the cycle after, with
a Fable line on the format.

### 6.6 Architecture already settled, bounded questions, and what could be YELLOW or RED

**Settled and GREEN for Opus:** everything in §6.3 stated as a design — the
keyed record and its per-caster invariant; the fold split's boundaries and
oracle; `addCreature` over `adaptMonster` with one immunity gatherer; the
seventh family through the enumerator; the fifth `Duration` member; the
derived `on` behind a stored-equals-derived gate; the adjudication entry type
pointed at the paragraph. A deviation from any of these is
`ARCHITECTURE_BLOCKED`, as before.

**Bounded questions for Fable before implementation:** none required. Two
are named as *possible* YELLOWs: T3 if the value-graph script finds a cycle
(none expected — every helper is called from `applyOne` or a pass and calls
downward); T6 on the placement of the derived failure in the turn-boundary
pipeline, with the answer pre-stated. The Counterspell-on-Counterspell lift
(§6.5) is a YELLOW by construction and is asked *before* its brief, not during.

**What could be RED — none in the roster, two adjacent:**

- **Ray of Frost outside combat.** Refused because its rider is turn-anchored
  and the engine refuses to invent six seconds; every alternative is a rule the
  SRD does not print. IE-033's LATER note said the `end-of-current-turn`
  member would serve it; it will not — that member is *inside* combat, and the
  out-of-combat question is a policy about turn-anchored durations where there
  are no turns, which is a product-behaviour choice. T8 does not decide it; the
  owner does, and the honest options are "refuse the cantrip", "apply the
  damage and report the rider unverified", or "read one round as six seconds
  outside combat for riders only".
- **A second scene**, walls and barriers, and falling are doctrine seams and
  stay where the last three audits left them.

### 6.7 Deliberately deferred, with reasons

| Not in this cycle | Why |
|---|---|
| **Compelled and forbidden actions** (26 blocked, 3 finished) | The largest capability family and the least specified: it needs a vocabulary over the action economy for forbidding one action and leaving the rest, which is a design with several legitimate shapes. A Fable design note first, then a brief |
| **Summons** (15 / 4) | T2 is deliberately its first half. The second — a creature whose presence is a casting's to end, and a turn inserted into the order for it — is a new consequence for `releaseCasting` and a change to the Initiative order; wants its own design after T2 lands |
| **Counterspell-on-Counterspell** | Needs the keyed record (T1) and a settle-order rule; optional slot at best (§6.5) |
| **Heal's flat healing** (6 / 1) | A format change on `DiceScaling`, not a field; §6.5 |
| **Modified healing** (2 / 0) | Two partials, nothing finished; one gatherer beside `healCreature`. Pool filler if a builder is idle, not a slot |
| **Superior Hunter's Defense whole** | T8 builds the deadline; the fifth `ReactionEffect` member still has one writer and "that damage" across two types is a stated choice — both wait |
| **A second scene, walls and barriers, falling, movement modes** | Doctrine-bound and refused outright respectively; unchanged |
| **`index.ts` tiering, per-event schemas, the snapshot policy** | Wait for M2's and M3's first consumer; §3 S11 |
| **Generalising the stated-fact plumbing** | Wait for the fifth fact; §3 S11 |
| **Converting 59 test files to the fixture module** | Adopt going forward; a conversion sweep is a large no-behaviour diff that collides with everything |

### 6.8 Workflow observations, for the foreman and the owner

Two things cost tranche 5 more than implementation did, and both have a
mechanical half:

- **Four brief lines contradicted the SRD** and every one was caught by a
  builder reading the paragraph. A brief's "Required behaviour" already quotes
  the SRD; the citation guard's technique — a quoted run held against the
  spell's own paragraph in `spells.json` — can be pointed at
  `docs/dev/tasks/*.md` for one afternoon's tooling, and would have failed the
  four lines before a builder read them.
- **Review rounds that fail only on prose.** IE-026 spent six rounds with the
  implementation passing every one; IE-024 spent three on a question that was
  not the builder's to answer. The workflow already moved toward confirming
  reviews and integration edits for sentences; making it the rule — a round
  whose only defects are docstring sentences becomes a foreman edit at
  integration — is the owner's to decide and would have returned roughly an
  hour of the overrun.

## 7. Measurement notes

- The suite was run with `vitest run --reporter=json` and the report summed
  per file; wall time is less than the 23.9 s sum because files run in
  parallel. `persistence-2.test.ts` at 5.06 s and `spell-catalogue.test.ts` at
  1.50 s are the only files over a second; the `tools/llm-probe` tests run in
  the same suite in well under a second each.
- The derivation checks folded both fixtures with `applyEvent` one event at a
  time, comparing `Combatant.speed` to `sheet.baseSpeed` at every
  `combat-started` (3 and 19 combatants; one mismatch each, the rat), and the
  stored `on` of every ongoing record to its derivation at every prefix (869
  checks, 0 mismatches).
- Blocker-map figures are `consumersOf` as it stands; the `finishes` lists
  quoted in §6 are the query's answer and inherit whatever the undefined map
  omits, which is §5's point.
- Comment-to-code ratios were measured by line class; "large" and "complex"
  were kept apart on purpose — `spell-definitions.ts` is 53 % prose and the
  audit does not ask it to be smaller.

## Audit summary block

Simplification and optimisation findings, ranked: 1. `events.ts` split along the
fold's seams — the file that serialised the tranche, cheap at a boundary, with the
IE-005/IE-027 oracle. 2. Delete the regex shape classifier and derive
`PARTIAL_SPELLS` — a second blocker table in the report already disagrees with the
derived one. 3. Derive `OngoingSpell.on` — 869 of 869 checkpoints equal; three
maintenance passes go. 4. The command stamp on the envelope — sixty declarations
and one sweep replaced by a type. 5. `spell-format.ts` — content beside mechanism.
6. The O(n) prefix test — the suite's slowest file. 7. Retire `endSpellEffectOn`
and demote `resolveCast`; add `endOngoingSpell`. 8. A fixture module, adopted
forward. Refused on evidence: `Combatant.speed` (the rat), further
`resolveEffects` abstraction (three tests instead), tiering (no consumer).
Pending castings: `pendingCastings` keyed by id, record shape unchanged, one open
casting per caster; sixteen sites in seven modules enumerated, four tests inverted,
one exemption rewritten, no fixture regenerated. Correctness before capability:
the keyed record; a monster cannot enter the game through a command and printed
condition immunities never reach state; the holder-addressed `endSpellEffectOn`;
IE-036 immediately after the record. Adjudication completeness: yes for the
undefined population — clause-anchored entries over the SRD paragraph with a
sentence-coverage guard and two `finishes` numbers; no new hand list. Next cycle:
T1 keyed record → T3 split → T2 monsters ∥ T6 in-combat long casting → T9 granted
immunity ∥ T8 the end-of-current-turn moment, beside IE-036, the adjudication
instrument, the coverage deletion, the derivations and the docs pass; one
optional slot; no RED in the roster; Ray of Frost out of combat is the owner's.
