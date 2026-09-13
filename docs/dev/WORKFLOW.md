# How development runs: a foreman and builders

One Fable session is the **foreman** — principal engineer, architect,
scheduler and reviewer. It delegates approved, bounded implementation tasks
to one to three **builders**, each an Opus subagent in its own git worktree.
The **owner** decides what gets built and what gets merged, and nothing else
has to pass through them.

This file is the procedure. `docs/dev/QUEUE.md` is the live state, one file
per task under `docs/dev/tasks/` is the record of each task, and
`node docs/dev/check-queue.mjs` validates both. Start a session with `/qb`.

## What this reuses, and what it adds

Most of the workflow existed before this file did, and it is not restated
here:

| Already the rule | Where |
|---|---|
| What must remain true of the Engine | `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` |
| How the code works and why; the rules that are easy to get wrong | `CLAUDE.md` |
| What is done, what was decided, what comes next and why | `PROGRESS.md` |
| The measurement of what executes | `COVERAGE.md`, generated |
| File-ownership lanes, the merge playbook, the daily loop | `CONTRIBUTING.md` |
| Design records for a significant pass | `docs/architecture/<topic>-<date>.md` |
| The verification gauntlet | `.github/workflows/ci.yml` |

What was missing was the state of work **in flight** — which task is with
which builder, at which gate — and the roles. That is all this adds.

**Source-of-truth hierarchy**, highest first: the doctrine; `CLAUDE.md`;
`PROGRESS.md`; the task file and `QUEUE.md`; `COVERAGE.md`. A task file may
never contradict `PROGRESS.md` about *why* something is being done; it says
*what* and *where it stands*.

## Roles

| | Foreman (Fable, the primary session) | Builder (`qb-builder`, Opus) | Owner |
|---|---|---|---|
| Owns | architecture, prioritisation, dependency analysis, decomposition, briefs, review, conformance review, merge ordering, the queue, owner summaries | one approved bounded task, end to end: inspect, implement, test, mutate, fix, commit, report | product decisions, architecture approvals, scope, merge approval |
| May | investigate, prepare future tasks, launch approved work, send ordinary rework back to a builder, integrate an approved merge, run the whole-engine audit | rebase onto `main`, resolve conflicts per the playbook, add tests, document deviations | approve, reject, modify, defer, decide |
| Must not | approve its own proposal, implement product code instead of delegating, decide a material product or architecture question alone, merge without approval, launch before approval, widen scope, keep builders busy for the sake of it | merge, push, pick its next task, redesign silently, widen scope, hard-code around a test, touch another worktree, continue past a genuine architecture problem | — |

The foreman does not write engine code. The one exception is a merge-time
conflict resolution that the playbook already prescribes mechanically
(regenerate `COVERAGE.md`; keep both registry lines in id order).

## Task states

Ten states, closed. `check-queue.mjs` refuses any other word.

| State | Meaning | Who moves it out |
|---|---|---|
| `PROPOSED` | identified, not yet briefed | foreman |
| `OWNER_APPROVAL_REQUIRED` | briefed and presented; **Gate 1** | owner |
| `APPROVED_FOR_IMPLEMENTATION` | approved, not yet launched | foreman |
| `IMPLEMENTING` | a builder holds it | builder |
| `ARCHITECTURE_BLOCKED` | the builder found the approved design does not cover it | foreman |
| `AWAITING_ARCHITECT_REVIEW` | builder reported complete | foreman |
| `CHANGES_REQUIRED` | ordinary rework sent back | builder |
| `OWNER_DECISION_REQUIRED` | a material question; **Gate 2** | owner |
| `AWAITING_MERGE_APPROVAL` | review passed; **Gate 3** | owner |
| `DONE` | merged to `main`, verified, recorded | — |

A task's state lives in **its own file**, on the `state:` line. `QUEUE.md`
indexes tasks; it does not hold a second copy of their state.

## The three gates

These are authority boundaries. The foreman may recommend; only the owner's
words in the conversation move a task across one, and the words are quoted
in the task file's `approved:` or `merge-approved:` line with the date.

- **Gate 1 — work approval.** `OWNER_APPROVAL_REQUIRED` →
  `APPROVED_FOR_IMPLEMENTATION` needs explicit approval. One approval of a
  batch approves every task listed in it and nothing else.
- **Gate 2 — owner decision.** Any material question of architecture, product
  behaviour, an authority boundary, foundational state representation, scope
  or a meaningful trade-off stops at `OWNER_DECISION_REQUIRED` with options,
  trade-offs and a recommendation. The foreman does not resolve it quietly.
- **Gate 3 — merge approval.** `AWAITING_MERGE_APPROVAL` → merged needs
  explicit approval. "MERGE" means: fast-forward `main`, verify, push.

Ordinary implementation corrections are not a gate. The foreman sends them
straight back to the builder.

## The loop

1. The foreman audits where things stand (`/qb` injects it) and proposes the
   next task or batch, briefed to the format below.
2. **Gate 1.** Stop and ask.
3. On approval: commit the task file(s) with `state:
   APPROVED_FOR_IMPLEMENTATION` and the quoted approval, then launch one
   builder per parallel-safe task (protocol below).
4. While builders run, the foreman investigates and prepares future work.
   Prepared is not approved.
5. Each builder reports. The foreman reviews independently (checklist below),
   sends ordinary rework back, or escalates to **Gate 2**.
6. **Gate 3** per task, not per batch. One task passing review neither
   approves nor merges another.
7. On approval: integrate (procedure below), verify `main`, record the Done
   row in `PROGRESS.md`, mark `DONE`, count it toward the audit.
8. After 3–5 meaningful engine tasks, `WHOLE_ENGINE_AUDIT_DUE`: the foreman
   runs the audit before proposing further mechanics.

## Parallel safety

Before two tasks run at once, answer all eight for the pair: direct
dependency; likely file overlap; a shared architectural primitive; a shared
mutable or generated artifact; whether one design could invalidate the other;
the merge-conflict surface; whether either waits on an owner decision; whether
both alter the same authority boundary or state representation.

**One owner per primitive.** At most one builder at a time may change any of:
the `GameEvent` union and reducer (`events.ts`), the command layer
(`commands.ts`), the type declarations at the top of `spell-definitions.ts`,
roll resolution, Advantage semantics, the action economy, conditions,
durations and deadlines, the spatial model, target resolution, save and attack
resolution, resource authority, persistence and the fold. Two tasks that share
one of these run **sequentially**, whatever their counts say.

What is parallel-safe beside one mechanism task: content (definitions and the
registry, the `VERIFIED_SPELLS` list, spell tests — lane A in
`CONTRIBUTING.md`), conformance and oracle expansion, tooling, documentation,
isolated subsystems, unrelated bug fixes in files the mechanism task does not
touch.

**Every engine task collides on three files anyway** — `CLAUDE.md`,
`COVERAGE.md` and the spell registry — and the playbook resolves each
mechanically (keep both sides' prose; regenerate; keep both lines in id
order). That is a known merge cost, not a reason to serialise. The files that
*are* a reason are the ones in the primitive list, and the "announce before
touching" set in `CONTRIBUTING.md`: `dnd.ts`, `result.ts`, `character.ts`,
the `GameEvent` union — a task touching those is `parallel-safe: NO`.

Classify every task `YES`, `NO` or `CONDITIONAL`, and say why in one line.

## The brief

`docs/dev/tasks/IE-NNN-<slug>.md`, in this shape. The header lines are parsed;
keep them exactly.

```
# IE-NNN — Title

state: PROPOSED
lane: mechanism | content | conformance | tooling | docs
batch: none | N
parallel-safe: YES | NO | CONDITIONAL — one-line reason
depends-on: none | IE-NNN, …
worker: none | <agent name> · <worktree path> · <branch>
approved: none | YYYY-MM-DD — "<owner's words>"
merge-approved: none | YYYY-MM-DD — "<owner's words>"

## Brief
### Objective
### Why now
### Current relevant architecture      (with file:line pointers)
### Required behaviour                 (the SRD text, quoted, and the semantics)
### Architecture constraints
### Acceptance criteria
### Tests and conformance
### Dependencies
### Likely file surface
### Out of scope
### Known risks

## Completion report                    (the builder's, pasted by the foreman)
## Architect review
## Merge record
```

A brief states semantics and boundaries precisely enough that the builder
never has to invent architecture. "Improve X" is not a brief.

## Launch protocol

Preconditions: the task file is committed to `main` with
`state: APPROVED_FOR_IMPLEMENTATION`; the foreman's working tree is clean;
`main` is where the builder should branch from (`.claude/settings.json` sets
`worktree.baseRef: head`, so a worktree branches from the local `main`, not
from the remote).

Launch with the Agent tool: `subagent_type: "qb-builder"`, run in the
background, `description: "IE-NNN <title>"`. The prompt carries the whole
brief verbatim plus the builder rules below; the agent definition carries the
worktree isolation, the model, the effort and the guard hook. Then record the
worker on the task file (`git worktree list` shows the path and branch), set
`state: IMPLEMENTING`, and commit that bookkeeping change.

Builders are told, every time:

- **Setup, in the worktree**: `npm ci`, then `npm run srd:ingest && npm run
  srd:index` (the generated SRD data is gitignored, so a fresh checkout has
  none). Then `npm test` to confirm a green baseline before touching anything.
- **Work** test-first, as `CLAUDE.md` requires; verify rules against
  `packages/srd/raw/`; mutate the implementation to prove the new tests bite.
- **Never edit** `PROGRESS.md`, anything under `docs/dev/`,
  `packages/engine/fixtures/golden-log.json`, or `packages/srd/raw/`. Do edit
  `CLAUDE.md` for what was built — that is the codebase's own rule — and
  commit a regenerated `COVERAGE.md`.
- **Before reporting**: `git rebase main` (the local branch), resolve per the
  playbook, then the whole gauntlet — `npm run typecheck && npm run lint &&
  npm test && npm run coverage && git diff --exit-code COVERAGE.md`.
- **One commit per task**, message in the repo's style (an imperative
  sentence), body explaining the decisions. Rework is folded into that
  commit, not stacked on it.
- **Report** in the format below, and stop. Do not pick up anything else.
- **`ARCHITECTURE_BLOCKED`** the moment the approved design does not cleanly
  cover something: stop making architectural changes and report the exact
  problem, the evidence (file:line), why the design does not cover it, the
  viable options with trade-offs, and a recommendation.

### Completion report format

```
IE-NNN — <title>
Result: COMPLETE | ARCHITECTURE_BLOCKED
Worktree: <path>   Branch: <name>   Commit: <sha>   Rebased on main at: <sha>
What was built:            (three to eight lines)
Tests added:               (files, and what each pins; the mutation you ran)
Gauntlet:                  typecheck / lint / test (N passing) / coverage diff
Deviations from the brief: none | …
Out-of-scope findings:     none | … (not acted on)
Open questions:            none | …
```

## Review checklist

The foreman reviews in the builder's worktree, reading the diff
(`git diff main...<branch>`) and re-running the gauntlet there. Against:

1. **The brief** — every acceptance criterion met; nothing beyond it.
2. **Architecture** — the doctrine's invariants; no new special case by name;
   no second source of truth; derived where it should be derived; the
   generalisation rule (a second user before an abstraction).
3. **Tests** — the failing test came first; a mutation was run; fixtures that
   discriminate (the multiclass, the resistant Rogue); numbers quoted from the
   SRD line they came from.
4. **Conformance** — `COVERAGE.md` and any `unmodelled` claims honest;
   `PARTIAL` used where it applies; the tracking guard satisfied.
5. **Scope and coupling** — no drive-by refactors; no reach into another
   lane's files without the brief saying so.
6. **Regression risk** — `golden-log.json` untouched; replay determinism
   asserted where the change could affect it.

Outcome: `AWAITING_MERGE_APPROVAL` with the review written into the task
file; or `CHANGES_REQUIRED`, sent to the builder by name with SendMessage
(its context is intact, and the send resumes it if it has finished); or
`OWNER_DECISION_REQUIRED`.

## Merge procedure (after Gate 3)

```bash
# 1. Is the branch still on top of main? If main moved, ask the builder to
#    rebase and re-run the gauntlet, or do it for a trivial conflict.
git merge-base --is-ancestor main <branch> && echo up-to-date
# 2. Fast-forward only — the history is linear and stays that way.
git merge --ff-only <branch>
# 3. Verify main.
npm run typecheck && npm run lint && npm test && npm run coverage && git diff --exit-code COVERAGE.md
# 4. Publish.
git push origin main
# 5. Retire the worktree (unlock first if git says it is locked).
git worktree remove .claude/worktrees/<name>
git branch -d <branch>
```

Then: the Done row in `PROGRESS.md` (the existing convention — a bookkeeping
commit of its own), `state: DONE` with the quoted approval, the audit counter
in `QUEUE.md`, and the next task moves up.

**Merge order.** When two branches finished concurrently, integrate the one
with the smaller surface first, rebase the other on the result, re-run its
gauntlet, re-review anything the rebase touched, and only then present its
Gate 3. If a merge invalidates a pending branch, that branch goes back to
`CHANGES_REQUIRED` before its merge approval is requested.

## Owner summaries

At **Gate 1**, per task or as a batch:

```
WORK BATCH N — OWNER_APPROVAL_REQUIRED
PRIMARY   IE-NNN — title       (lane; parallel-safe)
PARALLEL  IE-NNN — title       (lane; parallel-safe)
Independence check / shared-file conflicts / dependency conflicts
Maximum concurrent builders
Per task: why now · proposed architecture · what changes · dependencies ·
          main risks · out of scope
Recommendation: APPROVE BATCH | APPROVE IE-NNN ONLY | MODIFY | DEFER
```

At **Gate 3**:

```
IE-NNN — title — AWAITING_MERGE_APPROVAL
Implementation · Tests · Architecture review: PASS/FAIL · Conformance
review: PASS/FAIL · Deviations · Remaining risks · Merge-order concerns
Recommendation: MERGE | DO NOT MERGE
```

Detail lives in the task file. The summary is what the owner reads.

## The whole-engine audit

Due after every 3–5 meaningful engine tasks; `QUEUE.md` keeps the count and
`check-queue.mjs` prints `WHOLE_ENGINE_AUDIT_DUE` when it is reached. The
audit is the foreman's own read-only work and needs no approval to run; its
*findings* become proposals that pass Gate 1 like anything else. It does not
launch rewrites.

It covers what the two previous audits covered (`PROGRESS.md`, "Architecture
audit against the doctrine"): duplicated primitives, accidental coupling,
inconsistent authority boundaries, missing validation and conformance, drift,
abstractions grown too broad, repeated needs that now justify one, runtime
special cases by name, test blind spots, hidden cross-subsystem assumptions,
state that should be derived, duplicated sources of truth, and complexity
recent work introduced. Measured, not recalled — the numbers are what the code
says on the day. It is recorded where the previous ones were: a section in
`PROGRESS.md`, and a design record under `docs/architecture/` if it is long.

## Resuming in a fresh session

`/qb` injects `QUEUE.md`, the validator's summary, `git status`, the
worktrees and the recent log. From those, a cold session answers: what is
being implemented, which builders are active, what awaits approval, review or
merge, what is blocked, what comes next, what is parallel-safe, what has been
decided (`PROGRESS.md`, "Decisions that constrain what comes next"), what each
previous builder did (its task file), and when the next audit is due.

A builder that was running when the previous session ended is still on disk:
its worktree is under `.claude/worktrees/`, its branch holds whatever it
committed, and its task file says what it was asked. Re-launch with the same
brief and the instruction to continue from that branch.

## What is deliberately not automated

- **No merge without a human**, ever, including trivial ones. The gate is the
  product.
- **No self-approval.** A proposal the foreman wrote is not approved until the
  owner says so, however obvious.
- **No autonomous scheduling.** Builders are launched by the foreman in
  response to an approval, not by a timer or a queue drain.
- **No utilisation target.** Zero active builders is a normal state.
