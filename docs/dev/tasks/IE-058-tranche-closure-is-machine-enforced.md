# IE-058 — A tranche cannot close over a live task

state: DONE
lane: tooling
tranche: 7
parallel-safe: YES — `docs/dev/check-queue.mjs` and its test; touches no engine source
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 7."

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

## Completion digest

**Merged `55d772e`**, 13/13 auto-merge conditions, reviewer PASS at high
confidence, round 2. `main` green at **8,542 tests across 124 files**.

### The regression, reproduced by the foreman against the real repository

Not against a fixture. IE-049 was flipped to `AWAITING_FOREMAN_REVIEW` on the
live corpus and both validators run from the same path:

| | Result |
|---|---|
| the validator as it stood at `04a5353` | **`Problems: none`** — while printing `IE-049 (AWAITING_FOREMAN_REVIEW)` on tranche 6's `COMPLETE` line |
| the validator after this task | `Problems: 1` — *"COMPLETE but IE-049 is AWAITING_FOREMAN_REVIEW — a tranche cannot close over a live task; finish it, or record the deferral as `IE-049 (deferred → tranche N)` on this roster"* |

**That top row is the tranche-6 failure, exactly.** The information was on the
screen and nothing refused. The owner's instruction was that completeness become
a machine-enforced invariant rather than a foreman attention rule, and the
difference between those two rows is that instruction, satisfied.

### The declared deviation: a two-sided deferral — accepted, and it is better

The brief proposed a one-sided marker on the closing roster. The builder made it
**two-sided** — `IE-042 (deferred → tranche 7)` on the closing roster and
`IE-042 (deferred from tranche 6)` on the receiving one, each half required —
because **a one-sided marker leaves deletion exactly as cheap as it is today**,
and therefore fails the brief's own load-bearing constraint that a deferral must
be louder than a deletion. That is the constraint reasoning about the design
rather than following it, which is what a builder is for.

Review then found the first attempt had **no legal spelling for a second slip**,
which would have made deleting the tranche-6 marker the only route back to a
green queue — the exact failure mode inverted. Hence a fourth form,
`(deferred from tranche N → tranche M)`. Four forms, and an unrecognised
bracketed note is **refused rather than read past**.

### The erasure had already happened, in the record this task was written from

The builder's first out-of-scope finding is about the foreman's own edit, and it
is correct. Tranche 6's roster had simply **lost** IE-042 — twelve ids, the
thirteenth absent — and IE-042's `approved:` line had been rewritten to tranche
7's words. Nothing in the corpus recorded that it was ever deferred; the
validator passed truthfully over an incomplete record.

**Fixed at merge, in the foreman's lane, and the same two lines applied to
IE-036's tranche-5 deferral**, which had the identical shape. Both now derive:

```
Tranche 5  COMPLETE  18 rostered → 17 shipped, 1 deferred
  deferred (1): IE-036 → tranche 6
Tranche 6  COMPLETE  13 rostered → 12 shipped, 1 deferred
  deferred (1): IE-042 → tranche 7
```

Note what that repaired besides the provenance: tranche 6 now reads **13
rostered**, which is what the owner approved. The roster itself had been carrying
the same wrong number as the closing report.

### The honest limit, recorded rather than implied

**A fully consistent erasure remains undetectable** — delete the id from the
closing roster, move the task file, add it plainly to the receiving roster —
because nothing the validator may read records prior roster membership, and the
brief fixes it to a single dependency-free file. Every *partial* erasure is now
loud, and **the motive is gone**: the shipped count is derived from task states
either way, so erasing an id no longer flatters the number. The builder declined
to widen the validator's inputs to close it, correctly calling that a YELLOW.

### Verified

31 new tests (36 in the file). The best of them, and the reviewer said so: an
`it.each` table over all nine non-`DONE` states **pinned against the state list
the validator prints**, so a tenth state cannot leave the table one case short.
Three mutations, each failing as required. Every prior rule intact. The real
corpus passes at exit 0 and no historical tranche needed the rule weakened.
