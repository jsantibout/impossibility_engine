# Development queue

The in-flight state of the work. `PROGRESS.md` says what and why; this says
where each task stands right now. The foreman is the only writer of this
file and of everything under `docs/dev/`. The rules are in
`docs/dev/WORKFLOW.md`; `node docs/dev/check-queue.mjs` validates this file
and every task file, and prints the summary a fresh session reads first.

A task's state lives on the `state:` line of its own file under
`docs/dev/tasks/`. This file indexes tasks and records what no task file can:
batches, the gate log, and the audit counter.

## Audit counter

Last whole-engine audit: `f2512c7` (2026-09-12) — the second architecture
audit against the doctrine, recorded in `PROGRESS.md` under "Architecture
audit against the doctrine". The comparative audit (`5cdf785`, 2026-09-13)
was a design audit against other engines, not a code audit.

Engine tasks completed since last audit: 5
Audit due at: 4

Counted: the LLM-boundary hardening (`190fc1e`), the capabilities publish
(`cac086d`), the spatial-model pass (`81112d1`), the definitions validator
(`df6de4c`) and roll modifiers (`5b32e0c`). So the audit is **due now**. The
foreman runs it while batch 1 builds; its findings arrive as proposals at
Gate 1, and the counter resets when the audit is recorded.

## Batches

### Batch 1 — OWNER_APPROVAL_REQUIRED

| Role | Task | Lane | Parallel-safe |
|---|---|---|---|
| PRIMARY | IE-001 — A condition applied with no saving throw | mechanism | CONDITIONAL |
| PARALLEL | IE-002 — Pour twelve spells into the shapes that already execute | content | CONDITIONAL |

Independence check: PASS — IE-001 changes the effect vocabulary and its
resolution; IE-002 adds definitions using only the kinds that exist today and
touches no type, command or schema. Shared files: the registry in
`spell-definitions.ts` (both append; keep both lines in id order) and
`COVERAGE.md` (regenerate). Dependency conflicts: none. Maximum concurrent
builders: 2. Recommendation: APPROVE BATCH.

## CURRENT

| Task | Lane | Parallel-safe | Batch |
|---|---|---|---|
| [IE-001 — A condition applied with no saving throw](tasks/IE-001-condition-without-a-save.md) | mechanism | CONDITIONAL | 1 |
| [IE-002 — Pour twelve spells into the shapes that already execute](tasks/IE-002-pour-spells-into-existing-shapes.md) | content | CONDITIONAL | 1 |

Both at `OWNER_APPROVAL_REQUIRED`. No builder is active.

## NEXT

Prepared or being prepared; none approved.

| Candidate | Source | Note |
|---|---|---|
| Resistance or Immunity a spell grants (17 spells) | `PROGRESS.md`, ranked map rank 2 | the family the deferred child-effect vocabulary is waiting on; brief after IE-001 lands, because both add an effect kind |
| Whole-engine audit follow-ups | the audit due now | proposals, not tasks, until Gate 1 |

## LATER

The order is `PROGRESS.md`'s "Next actions, in order" and the ranked map
beneath it; this list does not restate them. Named there and not yet briefed:
healing that lifts a condition or raises the dead; damage with neither roll
nor save; teleportation; automatic area drift (Cloudkill); the standing
spatial effect (Spirit Guardians' Speed, the Paladin auras); splitting
`commands.ts`; `cause` on events; summons; long casting times.

## Gate log

| Date | Gate | Task(s) | Owner's decision |
|---|---|---|---|
| — | — | — | none yet |
