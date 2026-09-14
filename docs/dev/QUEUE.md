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

Last whole-engine audit: the third, 2026-09-13 —
`docs/architecture/whole-engine-audit-2026-09-13.md`, recorded in
`PROGRESS.md` under "Third architecture audit against the doctrine" and in
the Done table, commit `588d7a0`.

Engine tasks completed since last audit: 4
Audit due at: 4 — **reached; the gate is chartered and running**

**The gate is scoped, at the owner's instruction** (2026-09-13): Fable is
chartered on one architectural question rather than a whole-engine sweep —
**the restricted child vocabulary for outcome-scoped child effects**, which
`docs/architecture/spell-leverage-audit-2026-09-13.md` ranks as the
highest-leverage and highest-risk missing primitive and names as not the
foreman's to design. The deliverable is
`docs/architecture/outcome-scoped-child-effects-2026-09-13.md`, a design
record only; nothing is implemented and tranche 4 is not launched.

Recorded precisely so nobody later reads a narrow review as a broad one:
**the periodic audit's usual whole-engine sweep did not run at this
threshold.** What was accumulating for it is on the task files and in the
leverage audit — a command layer that is twenty-one modules and a barrel, a
public surface fourteen names wider, `once` making a guard-above-the-check
structurally impossible, two frozen logs covering all 91 event types, two
wrong-number bugs found in progression, and seventeen event types no command
emits. The next threshold should either sweep or say again why it did not.

The counter counts tasks that changed engine source outside tests and
definition prose: IE-003 (`5dfbc39`), IE-005 (`4f829e9`), IE-008
(`601774c`) and IE-001 (`7592efe`). **The threshold is reached.** The audit
runs before tranche 4 is proposed at Gate 1, never instead of a gate, and the
leverage audit recommends its charter: the restricted child vocabulary for
outcome-scoped child effects. IE-007 is inside an already-approved roster and
is unaffected — the audit gates the next *proposal*, not the completion of an
approved tranche. IE-004 (`0536a2b`) was conformance — a
guard, a script and two `unmodelled` strings — and is in the merge log below
but not counted. What it added for the next audit to weigh is on its task
file: the executed bucket now has a missing-shape vocabulary of its own
beside the tracked guard's. IE-002 (`de45194`) was content — two spell
definitions, their tests and prose — and IE-006 (`2915909`) was conformance —
a frozen fixture, its generator and one test file, with no engine source
touched at all. Neither is counted. IE-005 is: it moved the whole command layer, added
`once` to `idempotency.ts` and sent thirteen helpers to five modules — all
behaviour-preserving, which is not the same as not counting. What it leaves
the next audit to weigh is on its task file: twenty-one modules and a barrel
where there was one file, a public surface fourteen names wider, and a
duplicate-check wrapper that makes a guard-above-the-check structurally
impossible for the first time in eight recorded instances. What it left
for the next audit to weigh is on its task file: the existing effect kinds are
measurably drained, so the next spell coverage is bought by a mechanic.

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

### Tranche 3 — APPROVED 2026-09-13 — "APPROVE TRANCHE 3"
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
| SEQUENTIAL | IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts | mechanism | NO beside IE-001 |
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

## CURRENT

Tranche 3 is approved and running. **IE-008 is `DONE`, merged `601774c`** —
first-round PASS, thirteen conditions green. **IE-009 is at
`CHANGES_REQUIRED`** with a bounded fourth review pass running. IE-001 is
still building; **IE-007 is held at `APPROVED_FOR_IMPLEMENTATION`** and
launches when IE-001 has merged, because they share
`commands/spell-resolution.ts` and the `SpellEffect` union.

**IE-009's bounded pass verified the work and caught a defect the foreman
caused.** The pass confirmed the derivation independently — 91 declared, 74
emitted, **17 emitted nowhere**, with its own script implementing the stated
method; the bare-id reading gives 16 and drops exactly `creature-placed`; the
eight setup types are genuinely unreachable, `placeCreature`, `declareCover`,
`declareSight` and `startCombat` all returning `Result<State>` rather than
`Result<GameEvent[]>`. Then it found that **merging IE-001 under a running
review had made two of IE-009's prose numbers false** — 130 definitions is
now 132, eleven exported readers is now twelve — and that the merge would be
*textually clean*, because base and `main` are byte-identical at those lines.
A wrong number would have installed silently.

That is a foreman error in sequencing, and `WORKFLOW.md` now carries the
lesson: condition 12 asks whether anything merged in the meantime changed an
assumption the review rested on, and the easy misreading is to check whether
the tests still pass. A task whose deliverable is a derived claim has no test
to fail and no line to conflict. Do not merge another branch under a review of
one.

**IE-009 is also the first use of the round-exhaustion rule, and it caught the
rule's own wording.** Its three rounds went 2 → 2 → 1, every finding a
precision defect in prose the builder had rewritten that round, confidence
high and escalation none throughout. The rule as written said "strictly
shrinking", which 2 → 2 → 1 is not — so applying it literally would have sent
a sentence about a derivation method to Fable. The foreman authorised the
bounded pass under the rule's purpose and then **corrected the rule's text**
rather than leaving a precedent of quietly bending it: the test that separates
convergence from churn is whether a finding *repeats*, not whether the count
falls every round. `WORKFLOW.md`.

**Two findings from IE-009 outrank the task that produced them.**

- **The unreachable-event count was 9 and is 17**, and the eight it missed are
  one family: `scene-set`, `landmark-added`, `creature-placed`,
  `sight-declared`, `cover-declared`, `combat-started`, `time-advanced`,
  `spellcasting-declared`. That is scene setup — **a tool surface cannot start
  an encounter**. `placeCreature`, `declareCover`, `declareSight` and
  `startCombat` exist as pure functions the *reducer* calls to fold the event,
  and nothing emits one. This is the twelfth instance of the repository's
  recurring finding, and the largest: it is not one unreachable rule but the
  whole opening of a session. It is an **M2 blocker discovered before M2**,
  which is the best time to find one, and it belongs in the next tranche
  rather than in `LATER`.
- **IE-005 opened a guard hole and nothing said so.** `spell-schema.test.ts`'s
  runtime special-case sweep reads `commands/`, `events.ts`, `spells.ts`,
  `spellcasting.ts` and `standing.ts`; IE-005 moved seven readers into
  `spell-definitions.ts`, which is not on that list. No special case exists
  there today — verified with the sweep's own regex — so this is a hole rather
  than a breach. Half of it is unclosable, because the sweep's second half
  asks that a file name no catalogue id and a file of definitions names all
  130 of its own; the first half could simply be pointed there.

A third, smaller and worth recording because of who made it: **IE-002's
builder and reviewer both reported having "independently checked" an SRD line
number that was eleven lines off.** The value they checked — Produce Flame's
`1d8` — was right, and both of them did read the sentence; what neither
verified was the pointer they each cited. IE-009 quoted the SRD sentence
instead of citing a line into `packages/srd/raw/`, which is the convention
everywhere else and survives a re-vendoring.

| Task | Lane | Parallel-safe | Tranche |
|---|---|---|---|
| [IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts](tasks/IE-007-ongoing-record-hygiene.md) | mechanism | NO beside IE-001 | 3 |

**IE-001 merged `7592efe`, and its unification found what the leverage audit
predicted it would.** The three condition-rider spellings had each drifted to
a different idea of which fields they read — an escape check reached two of
the three, `outlivesCasting` only one — and those differences were accidents
of the order the spells were written in rather than rules. No spell-by-spell
test could have surfaced that, because each block was correct on its own
terms. One type, one option-builder, one schema reader now, and the mutation
that drops `unowned` from the shared helper fails four *Grease* tests, which
is the evidence the merge preserved behaviour.

**IE-007 launched on that base** and is the tranche's last task. Its item 2 —
removing two fields from a persisted record while both frozen logs still fold
— is the highest-risk thing in tranche 3, and its brief says to stop and
report rather than regenerate a fixture if it cannot be done compatibly.

## NEXT

**Tranche 4 is recommended and not yet proposed at Gate 1**, because tranche
3 is in flight and no task joins an approved roster. The reasoning is
`docs/architecture/spell-leverage-audit-2026-09-13.md`, written to the
owner's instruction that the remaining SRD surface be planned as a
leverage problem — verified rules coverage per unit of new engine
complexity — rather than spell by spell.

**A gate stands in front of it.** The whole-engine audit falls due when
IE-001 merges (the counter reaches 4 of 4) and it is Fable's. It is
chartered on the one question the foreman's audit deliberately did not
answer: **the restricted child vocabulary for outcome-scoped child
effects**, which is the highest-leverage missing primitive (8+ consumers),
the one the definitions decision record deferred pending evidence, and the
one the foreman may not design. Its output is a design record; tranche 5
implements it.

| Recommended for tranche 4 | Family | Consumers (spell + feature) | Level |
|---|---|---|---|
| A granted Resistance / Immunity / Vulnerability | C1 | 4 + 5 | GREEN |
| Condition removal, and healing an effect modifies | C5 | 6 + 7 | GREEN |
| A selector for the save a casting forces | C2, first half | 6 + 1 | GREEN |

Each is a closed-union extension with three or more consumers in **both**
populations — executed-but-partial spells, and unexecuted class features —
and each reuses an existing storage-and-cleanup pattern rather than
inventing one. C1 is the fourth user of a shape `bonuses`,
`GrantedArmorClass` and `rollModifiers` already share, with one cleanup door
already built. None is foundational architecture.

They are mutually parallel-safe: C1 is `CreatureState` defences and
`applyDamage`, C5 is healing and conditions, C2 is `roll-modifiers.ts` and
the save path.

**From tranche 4 onward every digest carries a leverage report** — reusable
primitives added, existing primitives reused, features directly implemented,
what is newly expressible *without further engine code*, bespoke handlers
and their justification, tests, remaining blockers, invariant impact. The
format is in the audit. It exists because raw implementation and capability
unlocked are different numbers and the current digest reports only the
first.

Beyond tranche 4, the order is the audit's section F and `PROGRESS.md`'s
ranked map, which it re-confirmed rather than replaced.

## LATER

| Task | Lane | Note |
|---|---|---|
| a refusal-code coverage sweep; a feature-definition validator; the special-case guard's allowlist; per-event field schemas | conformance | named in the audit, §3.4–3.5 and §3.9; briefed when a tranche has room |
| `qb-builder.md`: builders share one scratchpad path and one overwrote another's file — tell them to use task-unique filenames | docs | found by IE-004's builder; the foreman has been saying it in every launch prompt since, which is the workaround rather than the fix |
| the marker set in `spell-honesty.test.ts` has no word for *object*, so Dispel Magic's "creature, object, or magical effect" clause is unread | conformance | a stated floor; extend when a second clause needs it |
| Should `save`'s **stored** layout adopt `ConditionRider` too? IE-001 gave it the type through `conditionRiderOf` without moving its storage, because the brief forbade changing the member. Moving it is ~30 definitions, the schema and `riderDurations`, and buys uniformity of storage where uniformity of vocabulary is already had | mechanism | IE-001's builder raised it as a question rather than taking it. A decision, not a defect |
| `check` and `outlivesCasting` are now reachable on the `attack` and `save-damage` riders, where no definition uses them and no test covers those two combinations | content | the declared cost of one shared rider rather than three; expressible and unexercised |
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
| 2026-09-13 | Gate 1 (tranche) | IE-005, IE-006, IE-002 | approved — "APPROVE TRANCHE 2"; tranche 2 launched with three builders, no further merge gate |
