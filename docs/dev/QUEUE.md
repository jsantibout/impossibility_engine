# Development queue

The in-flight state of the work. `PROGRESS.md` says what and why; this says
where each task stands right now. The foreman is the only writer of this file
and of everything under `docs/dev/`. The rules are in `docs/dev/WORKFLOW.md`;
`node docs/dev/check-queue.mjs` validates this file and every task file, and
prints the summary a fresh session reads first.

A task's state lives on the `state:` line of its own file under
`docs/dev/tasks/`. This file indexes tasks and records what no task file can:
**the tranches and their authority**, the gate log, and the audit counter.

**The tranche is the unit of owner authority.** Approving one authorises
exactly the tasks on its roster to run all the way to a merged, pushed,
recorded `main` — and nothing else. No task joins an approved roster; the
validator refuses it.

## Audit counter

Last whole-engine audit: **the fourth, 2026-09-13** —
`docs/architecture/whole-engine-audit-fourth-2026-09-13.md`, recorded in
`PROGRESS.md` under "Fourth architecture audit against the doctrine".

Engine tasks completed since last audit: 0
Audit due at: 4

**Reset because the sweep actually happened.** The counter stood at 5 and was
deliberately not reset by the scoped rider gate, on the owner's instruction:
a gate scoped to one design question is not the whole-engine sweep the counter
measures toward. The fourth audit is that sweep — 21 command modules and the
barrel, the definition format's 45 optional fields and union members against
132 definitions, all 102 adjudications against the SRD prose, the ongoing
record and its upcaster, `EffectTarget`, both fixtures against the 91 event
types, refusal-code coverage, and the SRD text behind every leverage
candidate — so it resets.

The counter counts tasks that changed engine source outside tests and
definition prose. Nothing has landed since the audit.

## Tranches

### Tranche 1 — COMPLETE 2026-09-13 — "MERGE BOTH"
roster: IE-004, IE-003

Run under workflow V1, where the owner approved the work and then each merge.
Owner's words at Gate 1: "APPROVE BATCH"; at Gate 3: "MERGE BOTH".

| Role | Task | Lane | Merged as |
|---|---|---|---|
| PARALLEL | IE-004 — The honesty guard for executed spells | conformance | `0536a2b`, first |
| PRIMARY | IE-003 — Close the guard holes and make the guard sweeps mechanical | mechanism | `5dfbc39`, second, rebased cleanly over the first |

Both digests, both gate records and both merge records are on the task files.

### Tranche 2 — COMPLETE 2026-09-13 — "APPROVE TRANCHE 2"
roster: IE-005, IE-006, IE-002

The first tranche under V2: the approval authorises these three tasks through
implementation, review, ordinary rework, clean auto-merge, push and
bookkeeping, with no further merge gate. Nothing outside this roster moves.

| Role | Task | Lane | Parallel-safe | Merged as |
|---|---|---|---|---|
| PRIMARY | IE-005 — Split `commands.ts` by domain, behaviour-preserving | mechanism | NO beside mechanism; YES beside these two | `4f829e9`, third |
| PARALLEL | IE-006 — A second frozen event-log fixture | conformance | YES | `2915909`, second |
| PARALLEL | IE-002 — Pour twelve spells into the shapes that already execute | content | CONDITIONAL | `de45194`, first |

Independence check: PASS. IE-005 moves `commands.ts` into `commands/` and
sends eleven helpers to `attack.ts`, `positioning.ts`, `spell-definitions.ts`
(the helper region beside its types), `duration.ts` and `checks.ts`; it edits
test imports, the sweeps' module lists in `invariants.test.ts`, `CLAUDE.md`
and `CONTRIBUTING.md`. IE-006 adds a fixture, a scenario script, a
persistence test, a `.gitattributes` line and prose in `CONTRIBUTING.md` and
`CLAUDE.md`; no source file. IE-002 edits the definitions and registry region
of `spell-definitions.ts`, `VERIFIED_SPELLS` in the coverage script, spell
test files, `table` entries in `spell-honesty.test.ts` and `COVERAGE.md`.
Shared files: `spell-definitions.ts` between IE-005 and IE-002, in different
regions (helpers beside the types against definitions and the registry; the
registry merges by keeping both lines in id order); `CLAUDE.md` and
`CONTRIBUTING.md` prose, both sides kept. Dependencies: IE-005 on IE-003 and
IE-002 on IE-004, both merged. No design invalidates another: IE-005 changes
nothing observable, and IE-006's frozen log is exactly the test that would
say so if it did. Maximum concurrent builders: 3. Merge order: IE-006 and
IE-002 first (small), IE-005 last, rebased over the registry lines and the
prose. Likely Fable involvement: none foreseen — IE-005 is a move along seams
the third audit already measured, and the one structural helper it adds (the
duplicate-check wrapper) is named in the brief. Recommendation: APPROVE
TRANCHE 2.

### Tranche 3 — COMPLETE 2026-09-13 — "APPROVE TRANCHE 3"
roster: IE-008, IE-001, IE-007, IE-009

The approval authorises these four tasks through implementation, review,
ordinary rework, clean auto-merge, push and bookkeeping, with no further
merge gate. Nothing outside this roster moves.

Re-audited against the repository as it stands at `ceb11e6`, not against the
ordering tranche 2 left behind. Two items moved and one is new.

| Role | Task | Lane | Parallel-safe |
|---|---|---|---|
| PRIMARY | IE-008 — Every pool a level grants, granted at advancement | mechanism | YES beside spell resolution — **merged `601774c`** |
| PRIMARY | IE-001 — A condition applied with no saving throw | mechanism | CONDITIONAL — **merged `7592efe`** |
| SEQUENTIAL | IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts | mechanism | NO beside IE-001 — **merged `b80e0d5`** |
| PARALLEL | IE-009 — Close out tranche 2's four findings | conformance | YES — **merged `973129f`** |

**What the re-audit changed.**

- **IE-008 is new and outranks IE-001.** `advanceCharacter` emits pool events
  for hit dice and spell slots and for neither of the other two kinds
  `poolEvents` declares at creation, so every feature pool is frozen at the
  level the character was created at. A Paladin advanced 3 → 4 has 15 points
  of Lay On Hands instead of 20; a Sorcerer has 3 Sorcery Points instead of
  4. IE-006's builder found the missing-pool half and worked around it; the
  wrong-maximum half is larger and nothing had noticed it. A silently wrong
  number in a shipped path outranks a new capability.
- **The `resolveCast` `mayAct` guard moves from IE-001 to IE-007.** `NEXT`
  has said since IE-003 that it rides with the next command-layer mechanism
  task and named IE-001. After the split that is simply wrong:
  `resolveCast` is `commands/casting.ts:1051`, which IE-001 does not touch
  and IE-007 does. Moved, and the reason recorded on IE-007.
- **IE-001's demand is now measured rather than estimated.** Its brief
  guessed eighteen candidate spells from a prose scan; IE-002's spell-by-spell
  pass over all 211 undefined spells is better evidence, and the re-brief
  tells the builder to start there and expect fewer.
- **IE-001 and IE-008 are both mechanism and may still run together**, which
  the old one-owner rule would have forbidden. They share no primitive:
  IE-008 is `creation.ts` and resource authority, IE-001 is the `SpellEffect`
  union and `commands/spell-resolution.ts`. This is the first tranche to use
  what IE-005 bought, and it is used across *modules*, which is the narrower
  claim `WORKFLOW.md` now makes.

Independence check: PASS. IE-008 touches `creation.ts` and its tests; it adds
no event type and no fold change. IE-001 touches the `SpellEffect` union at
the top of `spell-definitions.ts`, `spell-schema.ts`,
`commands/spell-resolution.ts` and `coverage.ts`. IE-007 touches `events.ts`,
`spells.ts`, `commands/casting.ts`, `commands/spell-resolution.ts` and
`invariants.test.ts`. IE-009 touches one spell test file and `CLAUDE.md`.
Shared files: `CLAUDE.md` across all four and `COVERAGE.md` across two — both
known mechanical collisions, both sides kept, and tranche 2 is the evidence
that they rebase clean. IE-001 and IE-007 share `commands/spell-resolution.ts`
and the union, so they are **sequential, never concurrent**. Dependencies:
IE-001 on IE-004 and IE-005, both merged; IE-007 on IE-005 and on IE-001;
IE-008 and IE-009 on nothing.

Maximum concurrent builders: **3** (IE-008, IE-001, IE-009), then IE-007
alone once IE-001 has merged.

Merge order: IE-009 first (smallest, no runtime code), then IE-008, then
IE-001, then IE-007 rebased over it. The foreman runs every rebase.

Likely Fable involvement: **one plausible YELLOW, named in advance.** IE-007
item 2 removes two fields from a persisted record and versions the event
shape so both frozen logs still fold. If the builder finds that the frozen
logs cannot fold unchanged, that is a persistence-compatibility question and
it is Fable's, not the foreman's. IE-008 carries a smaller version of the
same risk — `golden-log-2.json` contains a real advancement — and its brief
says to stop and report rather than regenerate. Nothing else is foreseen:
IE-001 is a member added to a union whose three siblings already spell it,
and IE-009 is tests and prose.

Deliberately deferred, with reasons:

| Not in this tranche | Why |
|---|---|
| Outcome-scoped child effects | Still waiting on its second family. IE-001 is the first, and building the vocabulary from one is the guess the decision record refused |
| The nine unreachable event types | IE-009 **records** the fact; building commands for them is M2's tool-surface work and wants that surface's shape first |
| A refusal-code sweep, a feature-definition validator, per-event field schemas | Named in the third audit §3.4–3.5, §3.9; real, and none is a wrong number today |
| Resistance a spell grants; healing that lifts a condition; teleportation | The ranked map below. Each is a new shape, and this tranche already carries one |
| The whole-engine audit | Counter is 2 of 4. See below |

**The audit is not pulled forward, and the case for pulling it was
considered.** IE-008 is a correctness bug that three audits did not find,
which is an argument. It is not enough of one: the bug is a specific
divergence between two functions that should agree, not a systemic signal,
and IE-008's own brief closes the class by requiring one shared derivation
rather than two lists. What *is* accumulating for the next audit is on the
task files — a command layer that is now twenty-one modules and a barrel, a
public surface fourteen names wider, `once` making a guard-above-the-check
structurally impossible, and a second frozen log covering all 91 event types.
Four engine tasks is the trigger; this tranche's three mechanism tasks reach
it, so the audit falls due at the end of this tranche rather than inside it.

Recommendation: APPROVE TRANCHE 3.

### Tranche 4 — PROPOSED
roster: IE-010, IE-011, IE-012, IE-013

Prepared by the foreman from the **post-audit** state, not from the leverage
audit's ranking — which the fourth whole-engine audit re-derived and found
wrong in two of its four remaining candidates.

| Role | Task | Lane | Parallel-safe |
|---|---|---|---|
| PRIMARY | IE-010 — Outcome riders, and the two `on` rules made one | mechanism | NO beside the union or spell resolution |
| PARALLEL | IE-011 — Multiclass Hit Dice: call the function that is already right | mechanism | YES |
| PARALLEL | IE-012 — Scene commands: let something above the engine start an encounter | mechanism | YES |
| PARALLEL | IE-013 — Guards that can see a zero-user member | conformance | YES |

**Why these four, and why not the ones the leverage audit proposed.** Fable
re-derived C1, C2, C3 and C5 against the SRD text the way it re-derived C4:
**C2 makes zero consumers whole** and is dropped; **C1's nine consumers are
three** (Rage's resistance is already executed, and one of its four spells is
not in SRD 5.2.1 at all); C3 loses movement modes, which no rule reads; C5
splits, keeping condition removal and dropping modified healing at two
consumers. All four move to tranches 5 and 6, re-scoped. What replaces them at
the front is what the audit found instead: **two shipped wrong numbers and the
largest instance yet of a rule reachable from nothing.**

- **IE-010** is the only task with a decided design — the owner's chartered
  gate — and it owns the file where a shipped wrong answer lives. `on` has two
  rules: a Range: Self casting writes `on: [casterId]` and discards `held`, so
  Sunbeam blinds a creature and a Dispel Magic aimed at that creature finds
  nothing. One task closes a design decision, a correctness bug, a zero-user
  format member and three mis-filed adjudications.
- **IE-011** is a wrong number shipped: a Paladin 4 / Fighter 1 has four d10
  and no d8, while `hitDicePools` — correct, tested against both SRD worked
  examples — is called by nothing. The eleventh instance of that finding.
- **IE-012** is the twelfth and largest: nothing above the engine can start an
  encounter. **The foreman had deferred this to M2 and the audit overruled the
  boundary** — a tool surface calls commands and never folds events itself, so
  these are engine commands whatever M2 looks like. The correction is accepted.
- **IE-013** adds the guard that would have caught three of the audit's own
  findings by itself: nothing in the repository can see a format member that
  nobody uses.

Independence check: PASS. IE-010 is the `SpellEffect` union and
`commands/spell-resolution.ts`; **every new effect kind edits both, so at most
one union task runs at a time** — that is why 5 through 9 are a chain rather
than a tranche. IE-011 is `creation.ts` and `multiclass.ts`. IE-012 is a new
`commands/scene.ts` plus the barrel and the two sweeps. IE-013 is
`spell-schema.ts`, three test files and one read site in `commands/turns.ts`.
Shared: `CLAUDE.md` across all four and `COVERAGE.md` across two — the known
mechanical collisions, and three tranches of evidence that they rebase clean.
`invariants.test.ts` is touched by IE-012 (module lists) and by nobody else in
the roster.

Maximum concurrent builders: **4.** Merge order: IE-011, IE-012, IE-013,
IE-010 last — IE-013 counts `roll-mode.save`, which IE-010 removes, so IE-013
merges first and IE-010 rebases over it. The foreman runs every rebase.

Likely Fable involvement: **none foreseen.** IE-010's architecture is already
decided and recorded; a deviation from it is `ARCHITECTURE_BLOCKED` rather
than a judgement call. The other three are GREEN by the audit's own reading.

Deliberately deferred, with reasons:

| Not in this tranche | Why |
|---|---|
| Condition removal (C5, narrowed) | The next union task; the chain allows one at a time |
| Granted Resistance (C1, re-scoped to 2+1) with the `grants` `EffectTarget` member | After condition removal; its timer member has one user until a modifier rider wants `lasts` |
| Creature-type outcomes, and a declared "being fought" fact | The C2 replacement, four executed-partial consumers; after C1 |
| Speed modifier (C3, narrowed) | Last of the chain; `moveCreature` and `PendingMove` read Speed at declaration |
| `BLOCKED_ON` — derived blockers for the 207 undefined spells | The real fix for three rankings disagreeing fourfold. Conformance, and it should land before the *next* leverage ranking is written rather than before this tranche |
| The nine remaining unemitted event types | A second family with its own evidence; IE-012 names them |
| Feature-definition validator; refusal-code sweep (41 of 112); per-event field schemas; `index.ts` tiering; the snapshot policy for `castingsEnded` and `appliedCommands` | Named in the audit's `later` row; M2 and M3 own two of them |

Recommendation: APPROVE TRANCHE 4.

## CURRENT

Nothing running. **Tranche 4 is proposed, not approved: nothing may execute.**
All four tasks are at `OWNER_APPROVAL_REQUIRED`.

| Task | Lane | Parallel-safe | Tranche |
|---|---|---|---|
| [IE-010 — Outcome riders, and the two `on` rules made one](tasks/IE-010-outcome-riders.md) | mechanism | NO beside the union | 4 |
| [IE-011 — Multiclass Hit Dice](tasks/IE-011-multiclass-hit-dice.md) | mechanism | YES | 4 |
| [IE-012 — Scene commands](tasks/IE-012-scene-commands.md) | mechanism | YES | 4 |
| [IE-013 — Guards that can see a zero-user member](tasks/IE-013-format-and-validator-guards.md) | conformance | YES | 4 |

## NEXT

The union chain, in the audit's order, one per tranche because every new
effect kind edits `SpellEffect` and `resolveEffects`:

| | Task | Re-scoped how |
|---|---|---|
| 5 | Condition removal | C5 split: keep removal, reusing `useHealingTouch`'s extraction; drop modified healing at two consumers. Lesser Restoration whole; Heal needs flat-only healing, a one-line format question |
| 6 | Granted Resistance | C1 at **2 spells + 1 feature**, not 4 + 5, as `defensesOf`'s third input; the `grants` `EffectTarget` member if Superior Hunter's Defense is taken |
| 7 | Creature-type outcomes, and a declared "being fought" fact | The C2 replacement — Blight's auto-fail, Shatter's Disadvantage, Divine Smite's +1d8, Banishment's no-return, all reading a fact the engine holds authoritatively |
| 8 | Speed modifier | C3 narrowed: add/subtract, halve/double, set to 0, with a source and lifetime, derived like `armorClassOf`. **No movement modes** — no rule reads Fly, Climb or Swim |

Beside them, whenever a tranche has room: **`BLOCKED_ON`**, a derived map of
the 207 undefined spells' blockers sharing `MISSING_SHAPES`, with the three
bundle ids split. It is the fix for the audit's fourth finding — three
documents ranking one family at 17, 4 and 2 — and it makes every future
leverage count a query rather than a prose estimate. **It should land before
the next leverage ranking is written.**

## LATER

| Task | Lane | Note |
|---|---|---|
| a refusal-code coverage sweep; a feature-definition validator; the special-case guard's allowlist; per-event field schemas | conformance | named in the audit, §3.4–3.5 and §3.9; briefed when a tranche has room |
| `qb-builder.md`: builders share one scratchpad path and one overwrote another's file — tell them to use task-unique filenames | docs | found by IE-004's builder; the foreman has been saying it in every launch prompt since, which is the workaround rather than the fix |
| the marker set in `spell-honesty.test.ts` has no word for *object*, so Dispel Magic's "creature, object, or magical effect" clause is unread | conformance | a stated floor; extend when a second clause needs it |
| **`roll-mode.save` has zero users in the catalogue.** Blur and Beacon of Hope are the only `roll-mode` effects and neither saves | content | Fable, §H. A speculative branch field, and the clearest example in the repository of what one looks like. Remove it — and the outcome-rider design makes it redundant besides |
| **Disintegrate is mis-adjudicated to `outcome-scoped-child-effects`**, and IE-002 mis-filed **Ice Knife** and **Chromatic Orb** to it too | conformance | Fable, §C. Disintegrate needs a third outcome axis (save → damage → 0 HP) with one consumer; Ice Knife is two sequenced rolls plus an area at a target; Chromatic Orb is a chained attack on a dice-face trigger. Re-file all three |
| **`checkSpellDefinition` has no rule for a casting-owned rider on a definition with no lifetime** — a grant linked to a casting that never becomes ongoing and never ends | conformance | Fable, §E. The foreman drove all 132 definitions: **none today**, so this is a missing guard rather than a defect, and it is cheap because nothing has to be fixed first |
| Should `save`'s **stored** layout adopt `ConditionRider` too? IE-001 gave it the type through `conditionRiderOf` without moving its storage, because the brief forbade changing the member. Moving it is ~30 definitions, the schema and `riderDurations`, and buys uniformity of storage where uniformity of vocabulary is already had | mechanism | IE-001's builder raised it as a question rather than taking it. A decision, not a defect |
| `check` and `outlivesCasting` are now reachable on the `attack` and `save-damage` riders, where no definition uses them and no test covers those two combinations | content | the declared cost of one shared rider rather than three; expressible and unexercised |
| **`alsoOn` cannot grow `on` at the cast**, because `spell-ongoing` is pushed at the end of `resolveEffects` and every `condition-applied` in the batch folds before it. A Range: Self area spell — Sunbeam — blinds a creature and is not recorded as being on them, so a Dispel Magic aimed at that creature finds nothing. **And `CLAUDE.md`'s "now applied at the cast as well" is false for this case** | mechanism | IE-007's builder, pre-existing rather than introduced. A behaviour gap and a false sentence in the constitutional file; the sentence should be corrected when the behaviour is, or by the counts sweep below, whichever reaches it first. Deliberately not stretched into IE-007's bounded pass |
| **Settlement is still catalogue-driven.** `settleAreaEffects` resolves a trigger's `effects` through `definitionFor` (`commands/turns.ts:488`), so IE-007's pinned `areaTrigger.effects` and `.label` have no reader, and a correction to Web's saving throw still reaches a debt raised before it | mechanism | IE-007, documented rather than fixed: making settlement read the record is a second versioning change, because a pre-versioned record has no effects to restore. The irony is on the record — the same commit deletes `route` and `concentration` for being stored with no reader |
| **A sweep holding `CLAUDE.md`'s counts against `COVERAGE.md`.** Scope it to the sections where a count is *load-bearing* — IE-009's reviewer was explicit that it must not re-introduce digits where a guard would protect a number nobody needs. Four prose counts went stale inside tranche 3 alone — 130 definitions (now 132), eleven readers (twelve), "fifty-eight of the eighty-two executed" (86), "fifty-three" partial (54), "fifty-two companions" — and IE-001 moved most of them in one commit | conformance | IE-009, twice over: once as the defect it was sent back to fix and once as three more instances it found in sections it never touched. The repository's own answer to a number that matters is a generator and a CI guard; prose has neither. A strong candidate for tranche 4 — cheap, in the repo's idiom, and it closes a class rather than an instance |
| `spell-schema.test.ts`'s runtime special-case sweep does not read `spell-definitions.ts`, where IE-005 moved seven readers | conformance | IE-009's builder. No special case is there today, verified with the sweep's own regex, so it is a hole and not a breach. The sweep's first half — an id compared against a literal — can simply be pointed there; its second half cannot, because a file of definitions names all 130 of its own ids |
| **Multiclass Hit Dice pools are wrong, and the correct function is called by nothing.** `hitDicePools` (`multiclass.ts:142`) implements "Hit Dice pool by die type", is tested against both SRD worked examples (`multiclass.test.ts:203`) and is reached from no production code; `poolsFor` declares one Hit Die pool from the *starting* class. A Paladin 4 / Fighter 1 gets one `hit-die:d10` pool; a Cleric/Paladin gets no d8 pool at all | mechanism | IE-008's builder and reviewer, independently, in the function IE-008 refactored. Pre-existing and byte-identical across that diff, so it was correctly left alone. The eleventh instance in this repository of a pure function nothing calls, and a wrong number rather than a missing feature |

IE-003's two residuals are discharged: `carriesEvents` now answers
`'unresolved'` for a union payload with a driven non-vacuity case, and the
`TurnResolution.duplicate` docstring covers `resolvePendingSaves`.

Beyond that, the order is `PROGRESS.md`'s "Next actions, in order" and the
ranked map beneath it, which the audit re-confirmed for spells: Resistance or
Immunity a spell grants; healing that lifts a condition or raises the dead;
damage with neither roll nor save; teleportation; automatic area drift; the
standing spatial effect; `cause` on events; summons; long casting times.

## Gate log

| Date | Gate | Task(s) | Owner's decision |
|---|---|---|---|
| 2026-09-13 | Gate 1 (pre-audit) | IE-001, IE-002 | not approved; the owner asked for the whole-engine audit first, and it replaced the batch |
| 2026-09-13 | Gate 1 | IE-003, IE-004 | approved — "APPROVE BATCH"; tranche 1 launched with two builders |
| 2026-09-13 | architectural gate | IE-004 | inspected (three declared deviations, accepted); returned once for a self-contradicting `CLAUDE.md` paragraph; lightweight PASS on the rework |
| 2026-09-13 | architectural gate | IE-003 | `ARCHITECTURE_BLOCKED` at the three-round limit, judged procedural; inspected, all accepted; a fourth round authorised for two lines; lightweight PASS on the re-issue |
| 2026-09-13 | Gate 3 | IE-003, IE-004 | approved — "MERGE BOTH"; IE-004 merged `0536a2b`, IE-003 merged `5dfbc39`, both gauntlets green on `main`, pushed |
| 2026-09-13 | Gate 1 | IE-005, IE-006, IE-002 | presented as batch 2 under V1; re-presented as tranche 2 under V2 |
| 2026-09-13 | workflow change | — | V2: the Opus foreman coordinates, Fable is on call, and the owner's authority moves to the tranche. `docs/dev/WORKFLOW.md` |
| 2026-09-13 | architectural gate | IE-005 | three builder rounds ended `DEFECTS` on two doc comments; judged procedural, the unreviewed delta inspected, a fourth round authorised on the rebased commit, a fifth for one paragraph, `PASS` at the confirmation pass |
| 2026-09-13 | workflow change | — | `WORKFLOW.md` "Parallel safety": the command layer is no longer one primitive. One module under `commands/` is; two mechanism tasks in different domains may run concurrently, and still collide on the barrel and `invariants.test.ts` |
| 2026-09-13 | workflow change | — | Two repeated tranche-2 findings folded into the procedure: **round exhaustion is not a failed review** (the foreman may authorise one further bounded pass when findings are strictly shrinking, confidence high, escalation none and the remainder is not architecture — never manufacturing a PASS, never skipping independent review), and **rebases are the foreman's** (builders finish and report a branch; briefs stop asking them to rebase). `WORKFLOW.md`, `qb-builder.md` |
| 2026-09-13 | Gate 1 | IE-008, IE-001, IE-007, IE-009 | approved — "APPROVE TRANCHE 3"; launched with three builders, IE-007 held until IE-001 merges |
| 2026-09-13 | planning objective | — | the SRD surface is planned as a leverage problem — verified coverage per unit of engine complexity, not raw spell count. A change to the foreman's objective, not to authority: review loop, thirteen conditions, bounded extra pass, escalation and foreman-owned rebases all unchanged. `docs/architecture/spell-leverage-audit-2026-09-13.md` |
| 2026-09-13 | whole-engine gate | — | chartered, and **scoped by the owner** to one question: the restricted child vocabulary for outcome-scoped child effects. Design record only; `REJECT` and "narrower than asked" are legitimate answers. Tranche 4 not launched |
| 2026-09-13 | whole-engine audit | — | **the fourth, run in full** at the owner's instruction after the scoped gate: 21 command modules, 45 format members against 132 definitions, 102 adjudications against the SRD prose, both fixtures against 91 event types, and every leverage candidate re-derived. Counter reset, because the sweep actually happened. `docs/architecture/whole-engine-audit-fourth-2026-09-13.md` |
| 2026-09-13 | Gate 1 | IE-010, IE-011, IE-012, IE-013 | presented as tranche 4, prepared by Opus from the post-audit state; awaiting the owner |
| 2026-09-13 | whole-engine gate | — | **answered: `APPROVE, narrowed`.** Outcome *riders*, not child effects — leaf types in fixed slots on `attack`, `save-damage` and `save`, with the branch fixed by the host and the invariant that a rider never rolls. `onFail: SpellEffect[]` rejected on evidence. Tranche 4 not reordered; C1 re-briefed. `docs/architecture/outcome-scoped-child-effects-2026-09-13.md` |
| 2026-09-13 | Gate 1 (tranche) | IE-005, IE-006, IE-002 | approved — "APPROVE TRANCHE 2"; tranche 2 launched with three builders, no further merge gate |
