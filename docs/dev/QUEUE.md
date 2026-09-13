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

Engine tasks completed since last audit: 1
Audit due at: 4

The counter counts tasks that changed engine source outside tests and
definition prose: IE-003 (`5dfbc39`). IE-004 (`0536a2b`) was conformance — a
guard, a script and two `unmodelled` strings — and is in the merge log below
but not counted. What it added for the next audit to weigh is on its task
file: the executed bucket now has a missing-shape vocabulary of its own
beside the tracked guard's.

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

### Tranche 2 — PROPOSED
roster: IE-005, IE-006, IE-002

The first tranche under V2: approving it authorises these three tasks through
implementation, review, ordinary rework, clean auto-merge, push and
bookkeeping, with no further merge gate.

| Role | Task | Lane | Parallel-safe |
|---|---|---|---|
| PRIMARY | IE-005 — Split `commands.ts` by domain, behaviour-preserving | mechanism | NO beside mechanism; YES beside these two |
| PARALLEL | IE-006 — A second frozen event-log fixture | conformance | YES |
| PARALLEL | IE-002 — Pour twelve spells into the shapes that already execute | content | CONDITIONAL |

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

## CURRENT

| Task | Lane | Parallel-safe | Tranche |
|---|---|---|---|
| [IE-005 — Split `commands.ts` by domain, behaviour-preserving](tasks/IE-005-split-commands-by-domain.md) | mechanism | NO | 2 |
| [IE-006 — A second frozen event-log fixture](tasks/IE-006-second-frozen-fixture.md) | conformance | YES | 2 |
| [IE-002 — Pour twelve spells into the shapes that already execute](tasks/IE-002-pour-spells-into-existing-shapes.md) | content | CONDITIONAL | 2 |

All three at `OWNER_APPROVAL_REQUIRED`. No builder is active. Tranche 2 is
proposed, not approved: nothing may execute.

## NEXT

| Task | Lane | Note |
|---|---|---|
| [IE-001 — A condition applied with no saving throw](tasks/IE-001-condition-without-a-save.md) | mechanism | re-brief after IE-005: one `ConditionRider`, the new kind as its fourth consumer; carries the `resolveCast` guard below |
| [IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts](tasks/IE-007-ongoing-record-hygiene.md) | mechanism | sequential with IE-001 (both in spell resolution and `spells.ts`) |

## LATER

| Task | Lane | Note |
|---|---|---|
| guard `resolveCast` with `mayAct` — IE-003's derived sweep found it unguarded and named it as a debt rather than widening its brief | mechanism | one line plus a sweep entry; rides with IE-001, the next mechanism task that changes behaviour in the command layer, and is needed before M2 exposes `resolveCast` |
| a refusal-code coverage sweep; a feature-definition validator; the special-case guard's allowlist; per-event field schemas | conformance | named in the audit, §3.4–3.5 and §3.9; briefed when a tranche has room |
| `qb-builder.md`: builders share one scratchpad path and one overwrote another's file — tell them to use task-unique filenames | docs | found by IE-004's builder |
| the marker set in `spell-honesty.test.ts` has no word for *object*, so Dispel Magic's "creature, object, or magical effect" clause is unread | conformance | a stated floor; extend when a second clause needs it |

IE-005 carries two residuals IE-003's reviewer left, inside files it rewrites
anyway: `carriesEvents` answering `unresolved` for a union payload, and the
`TurnResolution.duplicate` docstring.

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
