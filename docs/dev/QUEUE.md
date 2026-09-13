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

Engine tasks completed since last audit: 2
Audit due at: 4

The counter counts tasks that changed engine source outside tests and
definition prose: IE-003 (`5dfbc39`) and IE-005 (`4f829e9`). IE-004 (`0536a2b`) was conformance — a
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

### Tranche 3 — PROPOSED
roster: IE-008, IE-001, IE-007, IE-009

Re-audited against the repository as it stands at `ceb11e6`, not against the
ordering tranche 2 left behind. Two items moved and one is new.

| Role | Task | Lane | Parallel-safe |
|---|---|---|---|
| PRIMARY | IE-008 — Every pool a level grants, granted at advancement | mechanism | YES beside spell resolution |
| PRIMARY | IE-001 — A condition applied with no saving throw | mechanism | CONDITIONAL |
| SEQUENTIAL | IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts | mechanism | NO beside IE-001 |
| PARALLEL | IE-009 — Close out tranche 2's four findings | conformance | YES |

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

Nothing running. **Tranche 3 is proposed, not approved: nothing may execute.**
All four tasks are at `OWNER_APPROVAL_REQUIRED`.

| Task | Lane | Parallel-safe | Tranche |
|---|---|---|---|
| [IE-008 — Every pool a level grants, granted at advancement](tasks/IE-008-pools-at-advancement.md) | mechanism | YES beside spell resolution | 3 |
| [IE-001 — A condition applied with no saving throw](tasks/IE-001-condition-without-a-save.md) | mechanism | CONDITIONAL | 3 |
| [IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts](tasks/IE-007-ongoing-record-hygiene.md) | mechanism | NO beside IE-001 | 3 |
| [IE-009 — Close out tranche 2's four findings](tasks/IE-009-tranche-2-findings.md) | conformance | YES | 3 |

## NEXT

Nothing queued behind tranche 3. The order beyond it is `PROGRESS.md`'s
"Next actions" and the ranked map beneath it — Resistance or Immunity a spell
grants; healing that lifts a condition or raises the dead; damage with
neither roll nor save; teleportation; automatic area drift; the standing
spatial effect; `cause` on events; summons; long casting times — with the
whole-engine audit falling due first, at four engine tasks.

## LATER

| Task | Lane | Note |
|---|---|---|
| a refusal-code coverage sweep; a feature-definition validator; the special-case guard's allowlist; per-event field schemas | conformance | named in the audit, §3.4–3.5 and §3.9; briefed when a tranche has room |
| `qb-builder.md`: builders share one scratchpad path and one overwrote another's file — tell them to use task-unique filenames | docs | found by IE-004's builder; the foreman has been saying it in every launch prompt since, which is the workaround rather than the fix |
| the marker set in `spell-honesty.test.ts` has no word for *object*, so Dispel Magic's "creature, object, or magical effect" clause is unread | conformance | a stated floor; extend when a second clause needs it |

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
| 2026-09-13 | Gate 1 | IE-008, IE-001, IE-007, IE-009 | presented as tranche 3 after a re-audit against `ceb11e6`; awaiting the owner |
| 2026-09-13 | Gate 1 (tranche) | IE-005, IE-006, IE-002 | approved — "APPROVE TRANCHE 2"; tranche 2 launched with three builders, no further merge gate |
