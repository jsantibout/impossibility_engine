# IE-058 — A tranche cannot close over a live task

state: IMPLEMENTING
lane: tooling
tranche: 7
parallel-safe: YES — `docs/dev/check-queue.mjs` and its test; touches no engine source
depends-on: none
worker: qb-builder, launched 2026-09-14 from `04a5353` (wave 2)
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: none

## Brief

### Objective

Make tranche completeness a **machine-enforced invariant**: `TRANCHE_COMPLETE`
must be impossible while any task on that tranche's approved roster is still
live, and the closing shipped/deferred counts must be derived from the task
states rather than written by the foreman.

### Why now

**Tranche 6 was declared complete over a live task, and the validator had been
reporting it the whole time.** IE-042 was approved, never launched, and still
reads `APPROVED_FOR_IMPLEMENTATION`; the foreman's closing report said "thirteen
of thirteen delivered" when twelve were `DONE`.

The owner's diagnosis is the right one and it is sharper than the foreman's
first reading. The fix is **not** "derive the closing report from the validator"
— the validator printed IE-042 on its own line and again on the tranche line in
every summary, and the foreman read past it twelve times. **An attention rule
that has already failed twelve times is not a fix.** The invariant has to be
enforced by the tool.

### Current relevant architecture, verified on `main`

- `docs/dev/check-queue.mjs` — `TRANCHE_STATES = ['PROPOSED','APPROVED','COMPLETE']`.
  `checkTranches` validates roster membership, the status value, and that an
  `APPROVED`/`COMPLETE` heading carries the owner's dated, quoted words.
  **There is no rule anywhere tying `COMPLETE` to the state of the tasks on its
  roster** — that is the hole.
- `STATES` — ten values, and **none of them means deferred**. IE-036's deferral
  from tranche 5 and IE-042's from tranche 6 were recorded in **prose** on the
  task file and in a gate-log row, which is exactly what the owner says must not
  be relied on.
- `checkTasks` — enforces that a roster names a task whose file claims that
  tranche, and that a task claiming a tranche is on its roster. **A task file
  carries exactly one tranche**, which is the constraint the deferral
  representation has to live inside.
- The validator's own test is `packages/engine/scripts/check-queue.test.ts`,
  which is outside `docs/dev/` and is collected by vitest. It already drives the
  real validator over throwaway fixtures, which is the harness this task
  extends.

### A narrow, explicit write exception

The workflow says **builders never edit `docs/dev/`**, and that rule stands for
`QUEUE.md` and for every task file — the foreman is racing you on those all
tranche. It does **not** need to protect the validator script, which is tooling
that happens to live there.

**This task may edit `docs/dev/check-queue.mjs` and nothing else under
`docs/dev/`.** Do not touch `QUEUE.md`, `WORKFLOW.md` or any file under
`docs/dev/tasks/` — including your own. If your change requires a task file or
the queue to be edited to stay valid, **say so in the digest and stop**; that
edit is the foreman's.

### Required behaviour

1. **The closure invariant.** A tranche whose status is `COMPLETE` must have
   every task on its roster **accounted for**: either `DONE`, or explicitly
   marked as deferred from that tranche. Any other state — `APPROVED_FOR_IMPLEMENTATION`,
   `IMPLEMENTING`, `CHANGES_REQUIRED`, `AWAITING_FOREMAN_REVIEW`,
   `AWAITING_MERGE_APPROVAL`, `ARCHITECTURE_BLOCKED`, `OWNER_DECISION_REQUIRED`,
   `PROPOSED`, `OWNER_APPROVAL_REQUIRED` — is a **problem**, named loudly, with
   the task id and its state.
2. **A machine-readable deferral, and the smallest one that works.** There is
   none today. The foreman's preferred shape, which you may better but must not
   silently replace:

   > mark it on the **roster line**, e.g.
   > `roster: IE-036, …, IE-042 (deferred → tranche 7)`

   That shape is preferred because it survives the one-tranche-per-file
   constraint: the task file moves cleanly to its new tranche, while the closing
   tranche's roster still **shows the miss** rather than erasing it.
   **The erasure is the failure mode to design against** — a foreman can
   currently "close" a tranche by quietly deleting an id from the roster, which
   is less visible than the bug this task fixes. Whatever representation you
   choose must make a deferral *louder* than a deletion, not quieter.
3. **Derived closing counts.** The validator's summary reports, for each
   `COMPLETE` tranche, the shipped count and list and the deferred count and
   list, computed from task states. A foreman must not be able to write "13
   delivered" when twelve are `DONE` — the number comes from the tool.
4. The existing rules are unchanged: roster membership both ways, the owner's
   quoted authority, the state/tranche cross-checks, and every other problem the
   validator already reports.
5. **The real corpus must pass.** Tranches 1–6 are all `COMPLETE` on `main` and
   their rosters are all-`DONE` after the foreman's re-rostering — confirm that,
   and if any older tranche fails the new rule, **report it rather than
   weakening the rule**: a historical tranche that closed over a live task is a
   finding, not a reason to soften the guard.

### Architecture constraints

- no new hand-maintained list of anything;
- the deferral marker is machine-readable and **visible in the closing count**;
- deletion from a roster must not become the easy way to close a tranche;
- the validator stays a single file with no dependencies beyond what it has.

### Acceptance criteria

1. **The tranche 6 regression, reproduced.** A fixture tranche marked
   `COMPLETE` whose roster carries an `APPROVED_FOR_IMPLEMENTATION` task — the
   IE-042 shape — is **rejected loudly**, naming the task and its state.
2. The same fixture with that task `DONE` is **accepted**.
3. The same fixture with that task explicitly deferred, by whatever
   representation you build, is **accepted** — and the summary counts it as
   deferred rather than shipped.
4. Every other live state is rejected too, driven as a table over the full
   non-terminal set rather than by picking two.
5. A tranche that is `APPROVED` (not yet complete) with live tasks is
   **unaffected** — that is the ordinary running state and must not become a
   problem.
6. The derived counts are asserted: a fixture with three roster tasks, two
   `DONE` and one deferred, reports exactly that and not "three delivered".
7. The **real** `docs/dev/` corpus passes, and `node docs/dev/check-queue.mjs`
   exits 0 on `main`.
8. `npm run typecheck`, `npm run lint`, the full suite, `COVERAGE.md`
   byte-clean.

### Tests and conformance

`packages/engine/scripts/check-queue.test.ts` is the home; it already drives the
real validator over throwaway fixtures. The **foreman** records the deferral
representation in `docs/dev/WORKFLOW.md` after the merge — not you.

### Dependencies

None, and it collides with nothing: no engine source, and one file under
`docs/dev/` that the foreman is not writing during the tranche.

### Out of scope

Any change to the engine, to `QUEUE.md`, to `WORKFLOW.md` or to any task file.
Any change to the ten task states beyond what a deferral representation
genuinely needs. Reporting on tranche *timing*, throughput or estimates.

### Known risks

Low in code. The design risk is the one requirement 2 names: a representation
that makes deferral quieter than it is today — in particular anything that lets
a roster entry simply vanish — would replace a visible bug with an invisible
one. If the shape you land on has that property, stop and say so.
