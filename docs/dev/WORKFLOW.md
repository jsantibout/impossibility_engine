# How development runs: a foreman, builders, a reviewer — and an architect on call

One **Opus** session is the **foreman**: it holds the queue, proposes work,
runs the floor, and integrates. One to three Opus **builders** implement in
isolated git worktrees, an independent Opus **reviewer** checks each result,
and the two fix ordinary defects between themselves. **Fable** is the
principal architect, and is *on call*: it is invoked for a bounded
architectural question, for the analysis behind an owner decision, and for the
periodic whole-engine audit — and for nothing else. The **owner** approves a
**tranche** of work; inside that tranche, clean work merges without a second
approval.

> Owner approves a tranche → foreman runs it → builders build → reviewer
> reviews → clean work merges → `TRANCHE_COMPLETE` → owner approves the next.
> Fable is called into the room when architectural intelligence is worth
> paying for, and then the room goes back to Opus.

This file is the procedure. `docs/dev/QUEUE.md` is the live state, one file
per task under `docs/dev/tasks/` is the record of each task, and
`node docs/dev/check-queue.mjs` validates both. Start a session with `/qb`.

## What changed in V2, and what did not

The first production run worked. Two authority decisions changed on the
strength of it; everything else is as it was.

| | V1 | V2 |
|---|---|---|
| Who coordinates | Fable | **Opus foreman** |
| Fable's job | every gate, every digest, every launch | **YELLOW escalations, RED analysis, the audit** |
| Owner approves | each task, then **each merge** | **a tranche, once** |
| Clean merge | owner presses MERGE | **the foreman merges under tranche authority** |
| Builders, reviewer, worktrees, guards, validator, gauntlet, digests, audit | — | **unchanged** |

The human gate did not go away; it moved up a level. The owner still decides
what is built, and nothing outside an approved tranche moves at all.

## What this reuses, and what it adds

Most of the workflow is not restated here:

| Already the rule | Where |
|---|---|
| What must remain true of the Engine | `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` |
| How the code works and why; the rules that are easy to get wrong | `CLAUDE.md` |
| What is done, what was decided, what comes next and why | `PROGRESS.md` |
| The measurement of what executes | `COVERAGE.md`, generated |
| File-ownership lanes, the merge playbook, the daily loop | `CONTRIBUTING.md` |
| Design records for a significant pass | `docs/architecture/<topic>-<date>.md` |
| The verification gauntlet | `.github/workflows/ci.yml` |

**Source-of-truth hierarchy**, highest first: the doctrine; `CLAUDE.md`;
`PROGRESS.md`; the task file and `QUEUE.md`; `COVERAGE.md`. A task file may
never contradict `PROGRESS.md` about *why* something is being done; it says
*what* and *where it stands*.

## Roles

| | Foreman (Opus, the `/qb` session) | Architect (Fable, `qb-architect`) | Builder (`qb-builder`, Opus) | Reviewer (`qb-reviewer`, Opus) | Owner |
|---|---|---|---|---|---|
| Owns | the queue and all of `docs/dev/`, tranche proposals, briefs, dependency and parallel-safety analysis, launches, the risk gate, routing reviewer findings, integration, merge sequencing, verification, `PROGRESS.md` bookkeeping, owner summaries | the answer to one bounded architectural question; the analysis behind a RED decision; the whole-engine audit | one approved bounded task end to end: inspect, implement, test, mutate, commit, get reviewed, fix, report a digest | one independent review of one completed task: diff, brief compliance, tests, regression risk, conformance, scope, coupling, special cases | product decisions, architecture approvals, scope, **the tranche** |
| May | propose, launch approved work, decide GREEN questions, send defects back, rebase and integrate, **merge a clean task under tranche authority**, verify, push, retire worktrees, invoke Fable, stop for the owner | read anything, measure, judge, recommend | add tests, document deviations, call the reviewer, fix what it finds | run the gauntlet, read anything, return ordinary defects to the builder, escalate | approve, reject, modify, defer, decide |
| Must not | approve its own tranche, add a task to an approved tranche, treat silence as approval, invent foundational architecture, implement product code, poll or monitor workers, merge anything that fails a condition below, launch before approval, widen scope | edit code, commit, merge, run the floor, review routine implementation | merge, push, **rebase**, pick its next task, redesign silently, widen scope, hard-code around a test, touch another worktree, edit `docs/dev/` or `PROGRESS.md`, continue past a genuine architecture problem | edit code, commit, soften the checklist on request, approve what it did not run | — |

**Fable's tokens are the scarce resource, and the foreman's are not free
either.** Opus performs the volume: coordination, engineering, review, rework
and integration. Fable is called for architecture that does not yet exist, and
returns to silence.

**The foreman may make GREEN-level technical decisions that follow
already-established architecture. It may not silently make new foundational
architecture.** If the answer is not already in the doctrine, `CLAUDE.md`, an
architecture record or an approved brief, it is YELLOW.

## Task states

Ten states, closed. `check-queue.mjs` refuses any other word.

| State | Meaning | Who moves it out |
|---|---|---|
| `PROPOSED` | identified, not yet briefed or not yet in a proposed tranche | foreman |
| `OWNER_APPROVAL_REQUIRED` | briefed and presented in a tranche; **Gate 1** | owner |
| `APPROVED_FOR_IMPLEMENTATION` | inside an approved tranche, not yet launched | foreman |
| `IMPLEMENTING` | a builder holds it — building, being reviewed, fixing | builder |
| `ARCHITECTURE_BLOCKED` | the builder or reviewer escalated (YELLOW) | foreman, after Fable answers |
| `AWAITING_FOREMAN_REVIEW` | a digest with a reviewer PASS has arrived; the risk gate | foreman |
| `CHANGES_REQUIRED` | the foreman sent it back (rare: builder ↔ reviewer rework never reaches this) | builder |
| `OWNER_DECISION_REQUIRED` | a material question (RED); **Gate 2** | owner |
| `AWAITING_MERGE_APPROVAL` | an auto-merge condition failed; the owner must decide; **Gate 3, the exception** | owner |
| `DONE` | merged to `main`, verified, pushed, recorded | — |

A task's state lives in **its own file**, on the `state:` line. `QUEUE.md`
indexes tasks and owns what no task file can: the tranches, the gate log and
and the gate log. State is written at the moments the foreman is awake
anyway — launch, digest, merge — never as a running status.

## The tranche is the unit of owner authority

A **tranche** is a bounded set of work targeting roughly **four to six hours
of autonomous development**, when the ready queue honestly supports that much.
A normal tranche holds **about 8–12 meaningful tasks** — guidance, not a
quota. It is numbered, and every task in it carries `tranche: N` in its header.

**Never bundle work to hit a number.** If six tasks are honestly ready, propose
six. A task is honestly ready when it is briefed well enough that a builder
never has to invent architecture — which is the same bar as always, applied to
a longer list.

### Waves

A tranche contains one or more **waves**, and a wave is a dependency boundary
rather than an approval boundary:

```
TRANCHE N
  Wave 1 — Task A, Task B, Task C        (no dependencies)
  Wave 2 — Task D, Task E                (after A merges)
  Wave 3 — Task F, Task G                (after D merges)
```

**One owner approval authorises the whole listed tranche.** Inside it the
foreman may, without asking again: launch the parallel-safe tasks of a wave;
auto-merge clean work under tranche authority; **launch a later wave the moment
its dependencies are satisfied**; re-order approved tasks when repository
evidence requires it; **defer an approved task** that evidence shows is
premature, invalid or unnecessary, and carry on with the rest; run ordinary
builder ↔ reviewer rework; and invoke Fable for a bounded YELLOW question.

**There is no gate between waves.** The tranche is the hard autonomy boundary,
and it is unchanged: the foreman may not add a task that was not listed, may
not materially widen an approved task's scope, may not treat a newly discovered
task as implicitly approved, and may not continue past a RED issue.

A deferred task is recorded with its reason and reported at
`TRANCHE_COMPLETE`.

### "Sequential" is a wave, not a tranche

Two tasks that may not run *concurrently* — because they touch the same union,
the same foundational primitive, the same file — are **sequential waves inside
one tranche**, not one task per tranche. "At most one union-changing task at a
time" is a concurrency constraint and the wave structure is how it is
expressed. Splitting such a chain across tranches makes the owner an approval
bottleneck for a fact the foreman already knows.

The bar is unchanged: each task in the chain must be briefed well enough to be
honestly approved *now*. A task that needs the previous one's findings before
it can be briefed is not ready, and belongs in the next tranche.

**The owner's approval of a tranche authorises exactly the listed tasks** to
move through implementation, review, ordinary rework, the risk-gate check
appropriate to their risk, integration, merge to `main`, verification, push,
bookkeeping and worktree retirement — **without a second approval per task.**

It authorises nothing else:

- **No unlisted task may be added to an approved tranche.** A task discovered
  mid-tranche is written up, put in `NEXT`, and proposed in the next tranche.
  The validator refuses a task whose `tranche:` does not appear in that
  tranche's roster in `QUEUE.md`, and refuses a roster entry with no task file.
- **Silence is never approval.** Only the owner's words in the conversation
  move a tranche across Gate 1, and they are quoted in `QUEUE.md` and on every
  task file's `approved:` line with the date.
- **The foreman never approves its own proposal**, however obvious.
- **A tranche does not roll into the next.** At `TRANCHE_COMPLETE` the foreman
  stops and waits.

## The thirteen auto-merge conditions

A task inside an approved tranche merges **only if every one of these is
true**. The foreman asserts them by name in the task file's merge record; any
one false sends the task to `AWAITING_MERGE_APPROVAL` — or to
`CHANGES_REQUIRED`, or to Fable, if that is the honest answer — instead.

1. The implementation stayed inside the approved brief.
2. The builder reported `COMPLETE`.
3. An independent `qb-reviewer` returned `PASS` with **confidence: high**.
4. Every ordinary defect the reviewer raised is resolved.
5. The full gauntlet passes in the worktree: `npm run typecheck && npm run lint && npm test && npm run coverage && git diff --exit-code COVERAGE.md`.
6. Conformance passes — `COVERAGE.md` regenerated and honest, the tracking and
   honesty guards satisfied, `unmodelled` claims still fiction rather than debt.
7. No unresolved architecture blocker: nothing is `ARCHITECTURE_BLOCKED`, and
   any Fable decision it needed has been given and recorded.
8. No material architectural deviation the owner did not approve. A deviation
   the digest declares and the reviewer passed is material unless it is plainly
   inside the brief's stated latitude; if it is arguable, it is not clean.
9. No unexpected authority-boundary or foundational-state change: the digest's
   "Foundational primitives touched" line names nothing the brief did not, and
   no change to who owns a piece of state, to the `GameEvent` union or the
   fold, or to persistence, arrived unannounced.
10. No meaningful scope expansion — no files outside the brief's surface
    without a reason in the digest that the brief anticipated.
11. No non-mechanical merge conflict. The three known collisions — `CLAUDE.md`,
    `COVERAGE.md`, the spell registry — resolve by the `CONTRIBUTING.md`
    playbook and are mechanical. Anything else goes back to its builder.
12. Integration did not invalidate what was reviewed: after the rebase the
    branch still passes the gauntlet, and nothing merged in the meantime
    changed an assumption the review rested on. If it did, the task returns to
    its builder and is re-reviewed.
13. The foreman's risk gate passes (below).

**If all thirteen are green the foreman integrates, verifies `main`, merges,
pushes, records and retires the worktree, and moves to the next task in the
tranche — without asking.** The tranche approval is the merge authority.

## The foreman's risk gate

It sits between the reviewer's `PASS` and the merge, and it is **lightweight by
default**. The foreman reads the completion digest — builder result, reviewer
verdict, tests, conformance, deviations, primitives touched, special cases —
not the diff. With no signal the gate is one sentence in the task file:

> *Implementation matches the approved brief, the reviewer passed it with high
> confidence, no deviations and no foundational primitives reported. Merging
> under tranche N authority.*

The foreman inspects the actual diff only when a **risk signal** is present:

`ARCHITECTURE_BLOCKED` · an architectural deviation · a foundational primitive
changed · a new abstraction introduced · reviewer uncertainty (`confidence:
medium` or `low`) or a builder/reviewer disagreement · tests and stated
semantics disagree · an unexplained special case · an authority-boundary
change · a state-representation change · a persistence or event-fold change ·
substantial cross-system coupling · an unusually high-risk task.

A signal is **not** by itself an escalation. The foreman inspects as deeply as
the signal warrants and then classifies: GREEN (proceed, saying what it found),
YELLOW (Fable), RED (owner), or `CHANGES_REQUIRED` back to the builder.

## Escalation levels

| Level | Examples | Handled by | Mechanism |
|---|---|---|---|
| **GREEN** | implementation details, ordinary defects, expected test failures, reviewer-requested fixes, mechanical refactors inside approved architecture, established patterns, documentation, straightforward conformance work, deterministic integration and rebase, a clean auto-merge | builder and reviewer between themselves; the foreman for integration and routing | the rework loop; neither Fable nor the owner hears of it except as a line in a digest or the tranche report |
| **YELLOW** | a new reusable abstraction appears necessary · two established subsystems collide · repeated special cases indicate missing architecture · state ownership is ambiguous · authoritative vs derived is unclear · persistence or replay semantics are implicated · builder and reviewer disagree architecturally · the approved architecture cannot cleanly express the implementation · a foundational primitive must change in a way not already authorised · three review rounds without a PASS | **Fable**, invoked by the foreman | below |
| **RED** | a material product-behaviour choice · a North-Star implication · a major architecture rewrite · a foundational authority change · substantial scope expansion · a decision that could invalidate completed systems · an architectural trade-off where several legitimate options materially change the engine | Fable analyses; **the owner decides** | the foreman stops at `OWNER_DECISION_REQUIRED` with options, trade-offs and a recommendation |

An Opus agent that cannot tell GREEN from YELLOW treats it as YELLOW. The cost
of a needless Fable call is small; the cost of an invented architecture is not.
A foreman that cannot tell YELLOW from RED treats it as RED.

### Invoking Fable — the supported path

Fable is a **subagent**, launched with the Agent tool:

```
Agent(
  subagent_type: "qb-architect",
  model: "fable",                 // explicit; do not rely on the frontmatter alone
  description: "IE-NNN <the question in five words>",
  run_in_background: false,       // the tranche is stopped on this answer
  prompt: <the escalation brief>
)
```

`.claude/agents/qb-architect.md` carries `model: fable`; the launch passes
`model: "fable"` as well, because the Agent tool's model override is the
documented mechanism and takes precedence over the frontmatter. The session
model is *not* changed — a session cannot re-price itself, and the foreman
stays Opus throughout.

**If `qb-architect` does not resolve**, the session began before the
definition existed: agent definitions are read at session start. The supported
fallback is the same launch with `subagent_type: "general-purpose"`,
`model: "fable"`, and the contents of `.claude/agents/qb-architect.md` pasted
above the escalation brief — the model override is what carries Fable, and the
definition is only instructions. Do not invent configuration to work around
it, and do not silently decide the question yourself instead.

At YELLOW the foreman:

1. **Stops the affected task.** `state: ARCHITECTURE_BLOCKED`, worker
   recorded. Other tasks in the tranche continue if they are independent of
   the question.
2. **Gathers the evidence itself.** Fable judges; it does not do legwork. The
   escalation brief carries: the exact decision required, stated as a question
   with a yes/no or a small set of options; the brief and the acceptance
   criterion it collides with; the evidence with `file:line`; what the builder
   and reviewer each said; what the foreman already ruled out and why; and the
   blast radius — what else would have to change under each option.
3. **Receives a concise decision or recommendation** — not an implementation.
4. **Records it** where this repository already records decisions: a paragraph
   on the task file under `## Architecture decision`, quoted; a line in
   `QUEUE.md`'s gate log; and, if it constrains future work, `PROGRESS.md`'s
   "Decisions that constrain what comes next" or a record under
   `docs/architecture/<topic>-<date>.md`. Fable writes nothing itself.
5. **Resumes only if the answer stays inside the owner's existing authority** —
   the approved brief and the tranche. If the decision widens scope, changes a
   foundational authority, or changes product behaviour, it is RED: stop at
   `OWNER_DECISION_REQUIRED` and present Fable's analysis with the options.

**Fable is never used for routine implementation review.** That is the
reviewer's job, and re-reading a clean implementation is exactly the cost V2
exists to remove.

## The loop, event by event

1. **Owner starts a session with `/qb`.** The foreman reads the injected state,
   runs the whole-engine audit first if the counter says it is due, and
   proposes the next **tranche**: 3–5 tasks, briefed, with dependencies,
   execution order and concurrency. It presents **Gate 1** and ends its turn.
2. **Owner approves, modifies or defers.** On approval the foreman quotes the
   words into `QUEUE.md`'s tranche record and every task file's `approved:`
   line, sets `APPROVED_FOR_IMPLEMENTATION`, launches one `qb-builder` per
   parallel-safe task that is ready, records each worker, sets `IMPLEMENTING`,
   commits that one bookkeeping change, says what is running, and **ends its
   turn**. It is now idle and costs nothing.
3. **Builders work.** Each sets up its worktree, implements test-first, passes
   the gauntlet, makes its one commit, and launches `qb-reviewer` on its own
   branch. Ordinary defects go straight back to the builder, which fixes them,
   folds them into the commit, re-runs the gauntlet and asks again — up to
   three rounds. A PASS ends in a **completion digest**; a YELLOW ends in
   `ARCHITECTURE_BLOCKED`. Either way the builder finishing is the event.
4. **The foreman is woken by the completion notification.** It pastes the
   digest into the task file, runs the risk gate, and then:
   - **all thirteen conditions green** → integrate, verify, merge, push,
     record, retire the worktree, and launch the next task in the tranche if
     one was waiting on this one. No owner involvement.
   - **an ordinary defect the reviewer missed** → `CHANGES_REQUIRED` and a
     `SendMessage` back to the builder.
   - **YELLOW** → invoke Fable as above.
   - **RED, or a failed merge condition that is the owner's to weigh** →
     `OWNER_DECISION_REQUIRED` or `AWAITING_MERGE_APPROVAL`, with a
     recommendation.

   Then it ends its turn.
5. **The tranche empties.** When every task in it is `DONE` or explicitly
   parked, the foreman stops at **`TRANCHE_COMPLETE`**, reports (format below),
   proposes the next tranche, and waits. It does not start it.
6. **Audit due.** When the counter reaches its threshold, the next wake-up that
   would propose a mechanic invokes Fable for the whole-engine audit **first**,
   records the findings, lets them reorder or re-scope the proposed tranche,
   and stops at Gate 1 before any new work begins.

If the session was closed while builders ran, nothing is lost: each builder's
commit is on its `worktree-*` branch under `.claude/worktrees/`, and `/qb`
shows them. The foreman takes each digest from the branch (`git log
main..<branch>`, the task file, and the agent's last message if the transcript
is available) and continues from step 4.

## While workers run, the foreman does not

Poll them, ask whether they are finished, inspect intermediate commits,
maintain a running status, narrate progress, review minor implementation
decisions, or do speculative work because it happens to be awake. Preparing
the *next* tranche is done when the foreman is woken for a gate, not in the
gap. Completion notifications are the mechanism; nothing else is needed.

> delegate → end the turn → wake on an event → route the result.

## Parallel safety

Before two tasks run at once, answer all eight for the pair: direct
dependency; likely file overlap; a shared architectural primitive; a shared
mutable or generated artifact; whether one design could invalidate the other;
the merge-conflict surface; whether either waits on an owner decision; whether
both alter the same authority boundary or state representation.

**One owner per primitive.** At most one builder at a time may change any of:
the `GameEvent` union and reducer (`events.ts`), **one module under
`commands/`**, the type declarations at the top of `spell-definitions.ts`,
roll resolution, Advantage semantics, the action economy, conditions,
durations and deadlines, the spatial model, target resolution, save and attack
resolution, resource authority, persistence and the fold. Two tasks that share
one of these run **sequentially**, whatever their counts say.

**The command layer stopped being one primitive on 2026-09-13** (IE-005,
`4f829e9`): it is twenty-one domain modules under `packages/engine/src/commands/`
with `commands.ts` as an enumerating barrel, so two mechanism tasks in
*different* domains may now run beside each other. That is what splitting the
file bought, and it is narrower than it sounds — **they still collide on the
barrel** whenever either adds or removes a command, and on
`invariants.test.ts`, whose sweeps read the directory. Both are mechanical, of
the spell registry's kind: keep both lines. So concurrency across domains is a
real saving on the *serialisation*, not on the merge, and the eight questions
above are still answered for the pair rather than assumed.

What is parallel-safe beside one mechanism task: content (definitions and the
registry, the `VERIFIED_SPELLS` list, spell tests — lane A in
`CONTRIBUTING.md`), conformance and oracle expansion, tooling, documentation,
isolated subsystems, unrelated bug fixes in files the mechanism task does not
touch.

**Every engine task collides on three files anyway** — `CLAUDE.md`,
`COVERAGE.md` and the spell registry — and the playbook resolves each
mechanically (keep both sides' prose; regenerate; keep both lines in id
order). Tranche 2 is the evidence: all three of its tasks edited `CLAUDE.md`
and every rebase was conflict-free, because the regions were disjoint. That
is a known merge cost, not a reason to serialise. The files that
*are* a reason are the ones in the primitive list, and the "announce before
touching" set in `CONTRIBUTING.md`: `dnd.ts`, `result.ts`, `character.ts`,
the `GameEvent` union — a task touching those is `parallel-safe: NO`.

Classify every task `YES`, `NO` or `CONDITIONAL`, and say why in one line.
Concurrency is **bounded by parallel safety rather than by a number** — two to
five builders is the normal range, and zero is a normal state too. There is no
utilisation target. **A wave of five tasks does not mean five builders**: it
means five approved tasks and whatever concurrency their independence check
actually permits.

## The brief

`docs/dev/tasks/IE-NNN-<slug>.md`, in this shape. The header lines are parsed;
keep them exactly.

```
# IE-NNN — Title

state: PROPOSED
lane: mechanism | content | conformance | tooling | docs
tranche: none | N
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

## Completion digest                    (pasted by the foreman when it arrives)
## Risk gate
## Architecture decision                (only if Fable was invoked)
## Merge record
```

A brief states semantics and boundaries precisely enough that the builder
never has to invent architecture. "Improve X" is not a brief. The reviewer
reviews against this file, so what is not in it is scope creep.

**A decision relayed by message has not reached the reviewer.** A reviewer
reviews against the brief **on disk in the builder's worktree**, and a builder
may not edit `docs/dev/`, so a Fable answer the foreman sends by `SendMessage`
reaches the builder and nobody else. IE-024's rework came back `ESCALATE` on
**authority with no defect reported** for exactly this: the brief in that
worktree still said "no new validation rules" and "any change to
`checkShape`'s denylist" is out of scope, while the decision authorising both
sat in a message and on a `main` the worktree had not seen.

So when Fable answers, the foreman does **three** things, not one: record the
decision on the task file; **strike the superseded lines where a reviewer
reads them**, rather than only appending the decision at the end; and **rebase
the builder's worktree** so the brief it works from is the decided one. The
foreman owns rebases anyway, and this is one more reason it does.

**A brief never asks the builder to rebase or to integrate.** It ends at a
finished, reviewed branch reported in a digest; the foreman owns the rebase
and everything after it.

**A brief may not assert a rules fact without quoting the SRD line it came
from.** IE-011's acceptance criterion said a Paladin 4 / Fighter 1 has a d10
pool and a d8 pool; `classes.md` prints D10 for both classes, so the pair
pools into five d10 and the example was wrong. The builder caught it,
implemented the required behaviour rather than the mistaken example, and
pinned both shapes. Every definition in the catalogue is already held to
quoting its line; a brief is where the numbers a builder will trust come
from, and it is held to the same rule. Recall is not evidence — which is the
first thing `CLAUDE.md`'s rules section says.

`merge-approved:` records the authority the merge rested on. Under tranche
authority it is the tranche's own approval, named as such:

```
merge-approved: 2026-09-14 — "APPROVE TRANCHE 2" (tranche 2 authority; 13/13 conditions green)
```

An exceptional Gate 3 records the owner's merge words directly, as before.

## Launch protocol

Preconditions: the task file is committed to `main` with
`state: APPROVED_FOR_IMPLEMENTATION`, `tranche: N` matching an approved
tranche roster in `QUEUE.md`, and the quoted approval; the foreman's working
tree is clean; `main` is where the builder should branch from
(`.claude/settings.json` sets `worktree.baseRef: head`, so a worktree branches
from the local `main`, not from the remote).

Launch with the Agent tool: `subagent_type: "qb-builder"`, in the background,
`description: "IE-NNN <title>"`. The prompt names the task file path and
carries the brief verbatim; the agent definition carries the worktree
isolation, the model, the effort, the guard hook, the review loop and the
digest format. Then record the worker on the task file (`git worktree list`
shows the path and branch), set `state: IMPLEMENTING`, commit that
bookkeeping change once for the whole launch, and **end the turn**.

## The completion digest

The builder's last message, in this shape; the foreman pastes it into the task
file when it arrives. Nothing else about the implementation is reread unless a
risk signal says so.

```
IE-NNN — Completion digest
Approved architectural intent: <one or two lines from the brief>
Builder: COMPLETE | ARCHITECTURE_BLOCKED
Worktree: <path>   Branch: <name>   Commit: <sha>   Rebased on main at: <sha>
Opus review: PASS | ESCALATE — rounds: N
Tests: <N passing> / <N total>; new tests: <k>; mutation run: <what and that it failed>
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS | <what is off>
Architectural deviations: none | <each, with why>
Foundational primitives touched: none | <list>
New runtime special cases: none | <list>
Files outside the brief's surface: none | <list, with why>
Out-of-scope findings (not acted on): none | <list>
Unresolved concerns: none | <list>
Reviewer confidence: high | medium | low
Recommendation: READY FOR MERGE | ESCALATE
```

## Review, and the rework loop

The reviewer is launched by the builder once its gauntlet passes and its
commit exists, with the task file path, the worktree path and the branch. It
runs in that worktree, reads `git diff main...<branch>`, the brief and the
tests, re-runs the gauntlet, and returns a structured verdict against: brief
compliance; tests (the failing test came first, a mutation was run, fixtures
discriminate, numbers quote their SRD line); regression risk
(`golden-log.json` untouched, replay determinism); conformance (`COVERAGE.md`,
`unmodelled` honesty, `PARTIAL`, the tracking guard); scope creep; obvious
architectural violations (the doctrine's invariants, a new special case by
name, a second source of truth, something derived that is stored); hard-coded
or test-specific fixes; accidental coupling; and it lists the foundational
primitives touched and any new special case, because the foreman's risk gate
reads those two lines first.

Ordinary defects go back to the builder as a list; the builder fixes, folds,
re-runs the gauntlet and asks again. **Three rounds is the builder's cap**, and
what it guards against is churn and architecture-by-rework — a builder
redesigning under review, one finding at a time. It is not a verdict.

**Round exhaustion is not a failed review.** When the cap is reached the
foreman reads the rounds and decides which of two things happened. If *all* of
these hold — the findings **converge**, `Confidence: high` and
`Escalation reason: none` every round, and the remaining delta is ordinary
implementation or documentation correction rather than architecture — it is
procedural exhaustion, and the foreman may authorise **one further bounded
review pass**, saying in the task file what it is bounded to. Anything else is
YELLOW: findings that broaden, drop in confidence, or expose an architectural
disagreement go to Fable.

**Converging is not the same as strictly shrinking, and this sentence said the
wrong one first.** IE-009's rounds went 2 → 2 → 1 — non-increasing, ending at
one prose defect, and flat in the middle. Read as "strictly shrinking" that is
an escalation to Fable over a sentence about a derivation method, which is the
cost this rule exists to avoid. The test that actually separates convergence
from churn is **whether a finding repeats**: a defect raised again after the
builder claimed to fix it is churn, and a *new* defect in prose the builder
rewrote that round is the review working. So the rule is: **non-increasing,
ending small, and no finding raised twice.** A count that rises, or the same
finding surviving a fix, is YELLOW.

Two things that extension never does. It does not **manufacture a PASS** — the
foreman may not supply condition 3 itself, however small the remaining defect,
and IE-005's last round existed to move one paragraph. And it does not **skip
independent review**: the extra pass is a real reviewer reaching its own
verdict. Where the outstanding defect is genuinely narrow, send it back to the
reviewer that already holds the verification rather than a fresh one, and
bound it to confirming that defect — re-deriving ten thousand lines to confirm
a three-line fix is the waste the bound exists to prevent.

A reviewer that sees an architectural problem does not negotiate it: it returns
`ESCALATE` and the builder ends with `ARCHITECTURE_BLOCKED`. The reviewer's
verdict is copied verbatim into the digest; a builder cannot soften it, and the
reviewer ignores any request to.

**The reviewer's independence is what tranche authority rests on.** A reviewer
that did not run the gauntlet, or that passed with `confidence: medium`, does
not satisfy condition 3, and the task stops for the owner rather than merging.

If a builder cannot launch the reviewer, it reports its digest with
`Opus review: NOT RUN` and the foreman launches `qb-reviewer` itself, once, in
that worktree.

## Merge procedure

Executed by the foreman — under tranche authority when all thirteen conditions
are green, or after an exceptional Gate 3 when one was not. **Builders and
reviewers cannot reach any of it**: a hook refuses `git push`, `git merge`,
tags, ref surgery and worktree management for both roles, and Claude Code's own
worktree isolation refuses edits and git aimed at the main checkout.

```bash
# 1. Is the branch still on top of main? If main moved, rebase it yourself —
#    see "Rebases are the foreman's" below. Builders cannot: the permission
#    model refuses them `git rebase`.
git merge-base --is-ancestor main <branch> && echo up-to-date
git -C .claude/worktrees/<name> rebase main   # only if it is not
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

Then: the Done row in `PROGRESS.md` (the existing convention), `state: DONE`
with the authority quoted on `merge-approved:`, the thirteen conditions
asserted in the task file's merge record —
one bookkeeping commit — and the next task in the tranche moves up.

**If step 3 fails on `main`, the merge is reverted, not fixed forward.**
`git reset --hard <the sha before the merge>` — nothing has been pushed yet —
the task goes back to `CHANGES_REQUIRED`, and its builder is told what failed.

**Merge order.** When two branches finished concurrently, integrate the one
with the smaller surface first, then rebase the other yourself and re-verify
it before merging — condition 12. If a merge invalidates a pending branch,
that branch goes back to `CHANGES_REQUIRED`.

**A branch whose deliverable is a derived claim is invalidated by a base that
moves, and the merge stays clean.** Condition 12 asks whether anything merged
in the meantime "changed an assumption the review rested on", and the easy
misreading — the foreman's, on IE-009 — is to check whether the tests still
pass. A task whose output is prose stating counts read out of the repository
has no test to fail and no line to conflict: its base and the new `main` are
byte-identical where it wrote, so a wrong number installs silently. **Do not
merge another branch under a review of one**, and where the sequencing is
already fixed, re-check such a branch's *claims* and not only its gauntlet.

**Rebases are the foreman's.** The permission model refuses a builder
`git rebase` — tranche 2 established it twice — so a builder **finishes and
reports its branch**, and every rebase and integration step is the foreman's,
before the verification of condition 12. Do not brief a builder to rebase, do
not ask one to by `SendMessage`, and read `Rebased on main at:` in a digest as
a fact about where the branch sits rather than as work the builder was meant
to do. Where a rebase raises a conflict, the `CONTRIBUTING.md` playbook
resolves the three known ones mechanically; a conflict the playbook does not
cover goes back to the builder as `CHANGES_REQUIRED`, since resolving it is a
decision about the code rather than about the history.

## Owner summaries

At **Gate 1** — the tranche proposal:

```
DEVELOPMENT TRANCHE N — OWNER_APPROVAL_REQUIRED
Per task: IE-NNN — title
          why now · dependencies · architecture surface · likely file surface ·
          parallel-safe YES/NO/CONDITIONAL · lane
Waves: Wave 1 — <tasks>; Wave 2 — <tasks>, after <what>; …
Dependency graph: <in plain English, what waits on what and why>
Concurrency per wave: <n>, bounded by the independence check below
Execution and merge order: <the order, and what rebases over what>
Approximate autonomous duration: <hours>
Independence check: <shared files, shared primitives, what serialises>
Likely Fable involvement: none foreseen | IE-NNN, because <the question>
Excluded deliberately: <what was considered and left out, and why>
What this authorises: implementation, review, rework, clean auto-merge, push
and **later waves as their dependencies are satisfied**, for these <n> listed
tasks and nothing else.
Recommendation: APPROVE TRANCHE N | APPROVE IE-NNN, IE-NNN ONLY | MODIFY | DEFER
```

At **`TRANCHE_COMPLETE`**:

```
TRANCHE_COMPLETE — tranche N
Shipped: <IE-NNN — title — commit sha>, one line each
Deferred: none | <IE-NNN, and the evidence that made it premature, invalid
          or unnecessary>
Waves executed: <n of m, and what each waited on>
Tests: <added> new; <N> total passing
Conformance: <COVERAGE.md deltas: executed / tracked / partial>
Architectural deviations: none | <each, and how it was judged>
Debt discovered: none | <each, and where it is now written down>
YELLOW / Fable interventions: none | <each, the question and the decision>
RED / owner interventions: none | <each>
Engine health: <gauntlet on main, replay determinism, golden logs untouched>
Audit recommendation: none | WHOLE_ENGINE_AUDIT_RECOMMENDED — <the systemic
          evidence, and why it is not an isolated bug>
Proposed next tranche: <the Gate 1 block above>
```

At an exceptional **Gate 3**:

```
IE-NNN — title — AWAITING_MERGE_APPROVAL
Condition that failed: <which of the thirteen, and what the evidence is>
Risk gate: lightweight | inspected: <why, and what was found>
Options: <merge as-is | return to the builder | re-scope>
Recommendation: MERGE | DO NOT MERGE
```

Detail lives in the task file. The summary is what the owner reads.

## The whole-engine audit

**The owner initiates it. The foreman never does, and keeps no counter.**

A broad audit normally runs **once per heavy development day**, in a fresh
Fable session against a clean `main`, started by the owner. Fable records it
using the repository's existing convention — a section in `PROGRESS.md`, and a
design record under `docs/architecture/` — and **the next foreman session reads
those findings** and may reorder or re-scope the queue before proposing work.

There is no schedule to maintain, no task-count threshold, no
architecture-change budget, and nothing for `check-queue.mjs` to print. An
earlier version of this file carried all three; they were removed on
2026-09-13 because audit scheduling is the owner's judgement and automating it
produced either too many audits or a number nobody trusted.

`qb-architect` has no Write tool and writes nothing to the tree: where the
foreman invokes Fable, Fable returns the record and the foreman files it.

### What a broad audit produces

Two things, not one. The scheduling is settled and unchanged; this is only what
the audit is *for*.

**1 — The retrospective.** Against the actual repository: whether recently
completed work closed what it claimed; architectural drift; duplicated or
conflicting primitives; stale assumptions and stale sources of truth;
correctness holes; validation and conformance blind spots; speculative or
zero-consumer representation; accidental coupling; persistence and replay
concerns; authority-boundary problems; debt that has become material; and what
should be **simplified or deleted rather than extended**.

**2 — The next development cycle.** Fable already holds the whole engine in
context at that moment, and that is the expensive part; recommending what to do
next while it is there costs little and is worth a great deal. It names: the
highest-leverage work; **why it outranks the plausible alternatives**;
correctness work that should outrank new capability; the dependencies; what is
safely parallel and what must be sequential; which architecture is already
settled and safe for Opus to execute; which questions need Fable again *before*
implementation; **measurement or source-of-truth work needed before further
prioritisation can be trusted**; and what should be deferred, with the reason.

Where the repository genuinely supports it, that recommendation covers roughly
the next **four to six hours** of useful development — thought of as coherent
architectural goals and dependency groups, never as a task count to hit.

### Who owns what

**Fable owns *what* should happen next and *why*. The foreman owns *how*.**

So Fable does not spend context on assigning workers or worktrees, rebases and
merge mechanics, reviewer routing, routine implementation detail, or project
management — unless a file or module boundary is architecturally significant.
It may name likely tasks, architectural units, dependencies, constraints and
acceptance-level outcomes wherever those are useful.

### After a broad audit

The next foreman session reads the audit and its next-cycle recommendation,
**verifies its premises against current `main`**, translates it into
implementation-ready briefs, builds dependency-aware waves, adds safe parallel
conformance, content or tooling work where repository evidence justifies it,
and presents one long `DEVELOPMENT TRANCHE — OWNER_APPROVAL_REQUIRED`.

The foreman may refine operational sequencing on repository evidence. It **may
not silently overturn a Fable architectural decision** — a substantive
disagreement is YELLOW and goes back to Fable.

**A recommendation is not authorisation.** The chain is unchanged: Fable
recommends → the foreman operationalises → the owner approves → the foreman
executes.

### What the foreman still does: `WHOLE_ENGINE_AUDIT_RECOMMENDED`

The foreman watches for *systemic* architectural risk and says so. It does not
launch anything.

Evidence that warrants the flag: repeated new special cases across several
subsystems; several YELLOW escalations converging on the same boundary;
persistence or replay uncertainty spreading past one bounded task; contradictory
foundational representations; repeated stale source-of-truth failures; recently
merged tasks invalidating each other's assumptions; or evidence that coverage
or conformance materially overstates support.

**An isolated bug does not qualify, however serious**, when it is clearly
localised and its class is being closed directly.

Having seen it, the foreman sets `WHOLE_ENGINE_AUDIT_RECOMMENDED` in
`QUEUE.md` with the evidence, and then:

- **if continuing the approved tranche would be unsafe** — the risk touches
  what the remaining tasks are about to build on — it stops at
  `OWNER_DECISION_REQUIRED`;
- **otherwise it finishes the approved tranche** and reports the
  recommendation at `TRANCHE_COMPLETE`.

### Fable's cadence

Fable is for a bounded YELLOW architecture question, RED analysis before an
owner decision, the owner's broad audits, and — later — a simplification pass.
**Never for coordination, implementation review, merges, queue updates or
ordinary foreman work.**

**A bounded YELLOW escalation inside a tranche is not a broad audit** and needs
no owner initiation: it is an architecture consultation on one question, the
foreman invokes it, and the tranche continues.

### The simplification audit, not yet

After roughly **three to five broad whole-engine audits**, or when a major
subsystem becomes structurally mature, Fable runs a separate **non-semantic
simplification and optimisation audit**: where is the engine correct but
unnecessarily complex; what duplicated representation can collapse; what
speculative fields have zero consumers; what indirection no longer buys
anything; what repeated scans, parsing or validation can be simplified; what
dead fields and historical seams remain; what developer or test workflow is
unnecessarily expensive. It ranks by leverage, confidence and regression risk.

**Runtime micro-performance is not part of it** and comes later, driven by
profiling rather than intuition. Do not run a generic optimisation pass before
this cadence says so.

## Resuming in a fresh session

`/qb` injects `QUEUE.md`, the validator's summary, `git status`, the worktrees
and the recent log. From those, a cold session answers: which tranche is
approved and what it authorises, what is being implemented, which builders are
active, what awaits approval, review or merge, what is blocked, what comes
next, what is parallel-safe, what has been decided (`PROGRESS.md`, "Decisions
that constrain what comes next"), what each previous builder did (its task
file's digest), and when the next audit is due.

**Agent definitions are read at session start, and that is a cold-start check
rather than a fact any one session can prove about itself.** A session that
*creates or edits* `.claude/agents/*.md` may not be able to launch what it just
wrote — the type does not resolve, or the old definition is still in force —
and contorting the architecture to make that session discover its own new
configuration would be fixing the wrong thing. So whenever a role definition
changes, the check belongs in the **next** session:

- `/qb` loads, and the injected blocks run.
- `qb-architect` resolves as a `subagent_type` and routes to Fable — one
  trivial probe is enough, and it costs almost nothing.
- `qb-builder` and `qb-reviewer` still resolve.

Until that check has been run once against a changed definition, treat the
escalation path as unproven and say so rather than assuming it. The
`general-purpose` + `model: "fable"` fallback above exists for exactly the
window where it is not yet proven.

## What is deliberately not automated

- **No work outside an approved tranche**, ever. Not a small fix, not an
  obvious cleanup, not a task the foreman is confident the owner would want.
  It goes in `NEXT` and waits for a gate.
- **No task added to an approved tranche.** The roster is the authority; the
  validator enforces it.
- **No self-approval.** A tranche the foreman proposed is not approved until
  the owner says so.
- **Silence is not approval.** Not at Gate 1, not at Gate 2, not at Gate 3.
- **No merge that fails a condition.** The thirteen are the product; removing
  the per-task button did not remove them.
- **No autonomous scheduling and no polling.** Builders are launched in
  response to an approval; the foreman is woken by completions, not by timers,
  loops or status checks.
- **No utilisation target.** Zero active builders is a normal state.
- **No Fable on the routine path**, and no foreman inventing architecture in
  its place. Those are the same rule read from two ends.
