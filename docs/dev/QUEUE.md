# Development queue

The in-flight state of the work. `PROGRESS.md` says what and why; this says
where each task stands right now. The architect is the only writer of this
file and of everything under `docs/dev/`. The rules are in
`docs/dev/WORKFLOW.md`; `node docs/dev/check-queue.mjs` validates this file
and every task file, and prints the summary a fresh session reads first.

A task's state lives on the `state:` line of its own file under
`docs/dev/tasks/`. This file indexes tasks and records what no task file can:
batches, the gate log, and the audit counter.

## Audit counter

Last whole-engine audit: the third, 2026-09-13 —
`docs/architecture/whole-engine-audit-2026-09-13.md`, recorded in
`PROGRESS.md` under "Third architecture audit against the doctrine" and in
the Done table, commit `588d7a0`.

Engine tasks completed since last audit: 0
Audit due at: 4

## Batches

### Batch 1 — IMPLEMENTING

| Role | Task | Lane | Parallel-safe |
|---|---|---|---|
| PRIMARY | IE-003 — Close the guard holes and make the guard sweeps mechanical | mechanism | CONDITIONAL |
| PARALLEL | IE-004 — The honesty guard for executed spells | conformance | YES |

Independence check: PASS — IE-003 edits `commands.ts`, `events.ts`,
`rest.ts`, `spells.ts`, a new `idempotency.ts` and the invariants suite;
IE-004 edits the tracking suite, the coverage script's `PARTIAL_SPELLS` list
and `unmodelled` prose in definitions. Shared files: `CLAUDE.md` (prose, both
sides kept) and `COVERAGE.md` (regenerated). Dependency conflicts: none.
Maximum concurrent builders: 2. Recommendation: APPROVE BATCH.

This batch replaces the one proposed before the audit (IE-001 + IE-002). The
audit found IE-001 premature as briefed and IE-002 the wrong first partner;
both are re-scheduled below, with the reasons in their files.

## CURRENT

| Task | Lane | Parallel-safe | Batch |
|---|---|---|---|
| [IE-003 — Close the guard holes and make the guard sweeps mechanical](tasks/IE-003-guard-holes-and-mechanical-sweeps.md) | mechanism | CONDITIONAL | 1 |
| [IE-004 — The honesty guard for executed spells](tasks/IE-004-honesty-guard-for-executed-spells.md) | conformance | YES | 1 |

IE-003 `AWAITING_MERGE_APPROVAL` since 2026-09-13: reviewer PASS after a fourth round, lightweight architectural gate on the re-issued digest, Gate 3 presented. IE-004 `CHANGES_REQUIRED` with its builder for one doc-only reviewer round. Both builders hold their worktrees (path and branch on each task file). Merge order: whichever the owner approves first; the other rebases over disjoint `CLAUDE.md` hunks.

## NEXT

Prepared; none approved. The order is the audit's (§5 of the record).

| Task | Lane | Note |
|---|---|---|
| [IE-005 — Split `commands.ts` by domain, behaviour-preserving](tasks/IE-005-split-commands-by-domain.md) | mechanism | batch 2's primary, alone in the mechanism lane; the seam table is measured; its brief must extend the derived sweeps in `invariants.test.ts`, which read `commands.ts` and `rest.ts` by file name |
| [IE-006 — A second frozen event-log fixture](tasks/IE-006-second-frozen-fixture.md) | conformance | batch 2, beside the split |
| [IE-002 — Pour twelve spells into the shapes that already execute](tasks/IE-002-pour-spells-into-existing-shapes.md) | content | batch 2, after IE-004 has changed what a new definition must satisfy |

## LATER

| Task | Lane | Note |
|---|---|---|
| [IE-001 — A condition applied with no saving throw](tasks/IE-001-condition-without-a-save.md) | mechanism | re-brief after IE-005: one `ConditionRider`, the new kind as its fourth consumer |
| [IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts](tasks/IE-007-ongoing-record-hygiene.md) | mechanism | sequential with IE-001 (both in spell resolution and `spells.ts`) |
| guard `resolveCast` with `mayAct` — the derived sweep found it unguarded and IE-003 named it as a debt rather than widening its brief | mechanism | one line plus a sweep entry; rides with the next mechanism task that touches `commands.ts`, and is needed before M2 exposes `resolveCast`; in the same pass, `carriesEvents` in `invariants.test.ts` should answer `unresolved` rather than a silent `false` for a `Result<A | B>` payload, and the docstring on `TurnResolution.duplicate` should cover `resolvePendingSaves` |
| a refusal-code coverage sweep; a feature-definition validator; the special-case guard's allowlist; per-event field schemas | conformance | named in the audit, §3.4–3.5 and §3.9; briefed when a batch has room |

Beyond that, the order is `PROGRESS.md`'s "Next actions, in order" and the
ranked map beneath it, which the audit re-confirmed for spells: Resistance or
Immunity a spell grants; healing that lifts a condition or raises the dead;
damage with neither roll nor save; teleportation; automatic area drift; the
standing spatial effect; `cause` on events; summons; long casting times.

## Gate log

| Date | Gate | Task(s) | Owner's decision |
|---|---|---|---|
| 2026-09-13 | Gate 1 (pre-audit) | IE-001, IE-002 | not approved; the owner asked for the whole-engine audit first, and it replaced the batch |
| 2026-09-13 | Gate 1 | IE-003, IE-004 | approved — "APPROVE BATCH"; batch 1 launched with two builders |
