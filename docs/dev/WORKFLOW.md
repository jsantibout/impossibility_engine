# How development runs: an architect, builders and a reviewer

One Fable session is the **architect** — principal engineer and final
technical judgment. It is **event-driven**: it wakes to plan and propose,
launches approved work, and then ends its turn. Opus does the volume: one to
three **builders** implement in isolated git worktrees, an independent Opus
**reviewer** checks each result, and the two fix ordinary defects between
themselves. Fable wakes again only for a completion digest, an escalation, an
owner decision, or the periodic whole-engine audit. The **owner** decides what
gets built and what gets merged.

> Fable thinks → delegates → sleeps. Opus works → Opus reviews → Opus fixes.
> Fable wakes for exceptions and gates.

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

| | Architect (Fable) | Builder (`qb-builder`, Opus) | Reviewer (`qb-reviewer`, Opus) | Owner |
|---|---|---|---|---|
| Owns | architecture, prioritisation, dependency analysis, decomposition, briefs, merge ordering, the queue, owner summaries, the architectural gate, the whole-engine audit | one approved bounded task end to end: inspect, implement, test, mutate, commit, get reviewed, fix, report a digest | one independent review of one completed task: diff, brief compliance, tests, regression risk, conformance, scope, coupling, special cases | product decisions, architecture approvals, scope, merge approval |
| May | propose, launch approved work, integrate an approved merge, inspect deeply when a risk signal says so | rebase onto `main`, resolve conflicts per the playbook, add tests, document deviations, call the reviewer, fix what it finds | run the gauntlet, read anything, return ordinary defects to the builder, escalate | approve, reject, modify, defer, decide |
| Must not | approve its own proposal, implement product code, poll or monitor builders, reread work the reviewer already checked without a reason, do speculative architecture while idle, decide a material question alone, merge without approval, launch before approval, widen scope | merge, push, pick its next task, redesign silently, widen scope, hard-code around a test, touch another worktree, edit `docs/dev/` or `PROGRESS.md`, continue past a genuine architecture problem | edit code, commit, soften the checklist on request, approve what it did not run | — |

**Fable's tokens are the scarce resource.** Fable makes the few high-leverage
decisions; Opus performs the large volume of engineering, review and rework.
Fable does not write engine code (the one exception is a merge-time conflict
the playbook already resolves mechanically), and it does not supervise.

## Task states

Ten states, closed. `check-queue.mjs` refuses any other word.

| State | Meaning | Who moves it out |
|---|---|---|
| `PROPOSED` | identified, not yet briefed | architect |
| `OWNER_APPROVAL_REQUIRED` | briefed and presented; **Gate 1** | owner |
| `APPROVED_FOR_IMPLEMENTATION` | approved, not yet launched | architect |
| `IMPLEMENTING` | a builder holds it — building, being reviewed, fixing | builder |
| `ARCHITECTURE_BLOCKED` | the builder or reviewer escalated (YELLOW) | architect |
| `AWAITING_ARCHITECT_REVIEW` | a digest with a reviewer PASS has arrived; the architectural gate | architect |
| `CHANGES_REQUIRED` | the architect sent it back (rare: builder ↔ reviewer rework never reaches this) | builder |
| `OWNER_DECISION_REQUIRED` | a material question (RED); **Gate 2** | owner |
| `AWAITING_MERGE_APPROVAL` | the architectural gate passed; **Gate 3** | owner |
| `DONE` | merged to `main`, verified, recorded | — |

A task's state lives in **its own file**, on the `state:` line. `QUEUE.md`
indexes tasks; it does not hold a second copy of their state. State is written
at the moments Fable is awake anyway — launch, digest, merge — never as a
running status.

## The three owner gates, and the architectural gate

The owner gates are authority boundaries. Fable may recommend; only the
owner's words in the conversation move a task across one, and the words are
quoted in the task file's `approved:` or `merge-approved:` line with the date.

- **Gate 1 — work approval.** `OWNER_APPROVAL_REQUIRED` →
  `APPROVED_FOR_IMPLEMENTATION` needs explicit approval. One approval of a
  batch approves every task listed in it and nothing else.
- **Gate 2 — owner decision.** Any RED question stops at
  `OWNER_DECISION_REQUIRED` with options, trade-offs and a recommendation.
- **Gate 3 — merge approval.** `AWAITING_MERGE_APPROVAL` → merged needs
  explicit approval. "MERGE" means: fast-forward `main`, verify, push.

**The architectural gate** sits between the reviewer's PASS and Gate 3 and is
Fable's. It is **intentionally lightweight by default**: Fable reads the
completion digest, not the diff. If the digest reports no deviation, no
foundational primitive touched, no new special case, no reviewer concern and
a PASS, the gate is one sentence — *"Implementation matches the approved
architecture, the reviewer passed it, no deviations reported. Proceeding to
the owner merge gate."* — and Gate 3 follows. Fable inspects the actual diff
only when a **risk signal** is present:

`ARCHITECTURE_BLOCKED` · an architectural deviation · a foundational primitive
changed · a new abstraction introduced · reviewer uncertainty or a
builder/reviewer disagreement · tests and stated semantics disagree · an
unexplained special case · an authority-boundary change · a state
representation change · a persistence or event-fold change · substantial
cross-system coupling · the periodic audit · an unusually high-risk task.

## Escalation levels

| Level | Examples | Handled by | Mechanism |
|---|---|---|---|
| **GREEN** | implementation details, ordinary defects, test failures, straightforward extensions of an approved pattern, documentation, mechanical refactors, ordinary review findings | builder and reviewer, between themselves | the rework loop; Fable never hears of it except as a line in the digest |
| **YELLOW** | an unclear architectural pattern, a new reusable abstraction, a repeated special case, a subsystem collision, authority or state-ownership ambiguity, a builder/reviewer architectural disagreement, three review rounds without a PASS | Fable | the builder or reviewer ends with `ARCHITECTURE_BLOCKED`; that completion wakes Fable |
| **RED** | a product-behaviour decision, a major rewrite, a foundational authority change, a broad scope change, a decision that could invalidate completed systems, North-Star implications | Fable and the owner | Fable stops at `OWNER_DECISION_REQUIRED` with options and a recommendation |

An Opus agent that cannot tell GREEN from YELLOW treats it as YELLOW. The cost
of a needless wake-up is small; the cost of an invented architecture is not.

## The loop, event by event

1. **Owner starts a session with `/qb`.** Fable reads the injected state,
   runs the whole-engine audit if it is due, proposes the next task or a
   parallel-safe batch (briefs below), presents **Gate 1**, and ends its turn.
2. **Owner approves.** Fable records the approval in the task file(s),
   launches one `qb-builder` per approved parallel-safe task, records each
   worker, commits that one bookkeeping change, tells the owner what is
   running, and **ends its turn**. It is now idle and costs nothing.
3. **Builders work.** Each sets up its worktree, implements test-first,
   passes the gauntlet, makes its one commit, and launches `qb-reviewer` on
   its own branch. The reviewer returns a verdict. Ordinary defects go
   straight back to the builder, which fixes them, folds them into the
   commit, re-runs the gauntlet and asks for review again — up to three
   rounds. A PASS ends in a **completion digest**; a YELLOW ends in
   `ARCHITECTURE_BLOCKED`. Either way the builder finishes, and its finishing
   is the event.
4. **Fable is woken by the completion notification.** It reads the digest and
   applies the risk-signal test: no signal → the one-sentence architectural
   gate, then the **Gate 3** summary; a signal → inspect the diff in the
   builder's worktree as deeply as the signal warrants, then Gate 3, or
   `CHANGES_REQUIRED` back to the builder by `SendMessage`, or Gate 2. Then
   it ends its turn.
5. **Owner approves the merge.** Fable integrates (procedure below), verifies
   `main`, pushes, records the Done row in `PROGRESS.md`, marks `DONE`,
   advances the audit counter, and — if nothing else is running and the
   next proposal is ready — presents the next Gate 1. Then it ends its turn.
6. **Audit due.** When the counter reaches its threshold, the next wake-up
   that would propose a mechanic runs the whole-engine audit first.

If the session was closed while builders ran, nothing is lost: each builder's
commit is on its `worktree-*` branch under `.claude/worktrees/`, and `/qb`
shows them. Fable reviews their digests from the branch (the digest is the
last message of the agent's transcript, and `git log main..<branch>` plus the
task file say the rest) and continues from step 4.

## While builders run, Fable does not

Poll them, ask whether they are finished, inspect intermediate commits,
maintain a running status, narrate progress, review minor implementation
decisions, or do speculative architecture because it happens to be awake.
Preparing the *next* proposal is done when Fable is woken for a gate, not in
the gap. Completion notifications are the mechanism; nothing else is needed.

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
Zero, one, two or three builders are all normal states; there is no
utilisation target.

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

## Completion digest                    (pasted by the architect when it arrives)
## Architectural gate
## Merge record
```

A brief states semantics and boundaries precisely enough that the builder
never has to invent architecture. "Improve X" is not a brief. The reviewer
reviews against this file, so what is not in it is scope creep.

## Launch protocol

Preconditions: the task file is committed to `main` with
`state: APPROVED_FOR_IMPLEMENTATION` and the quoted approval; Fable's working
tree is clean; `main` is where the builder should branch from
(`.claude/settings.json` sets `worktree.baseRef: head`, so a worktree
branches from the local `main`, not from the remote).

Launch with the Agent tool: `subagent_type: "qb-builder"`, in the background,
`description: "IE-NNN <title>"`. The prompt names the task file path and
carries the brief verbatim; the agent definition carries the worktree
isolation, the model, the effort, the guard hook, the review loop and the
digest format. Then record the worker on the task file (`git worktree list`
shows the path and branch), set `state: IMPLEMENTING`, commit that
bookkeeping change once for the whole batch, and **end the turn**.

## The completion digest

The builder's last message, in this shape; Fable pastes it into the task file
when it arrives. Nothing else about the implementation is reread unless a
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
Recommendation: READY FOR ARCHITECTURAL GATE | ESCALATE
```

## Review, and the rework loop

The reviewer is launched by the builder once its gauntlet passes and its
commit exists, with the task file path, the worktree path and the branch. It
runs in that worktree, reads `git diff main...<branch>`, the brief and the
tests, re-runs the gauntlet, and returns a structured verdict against: brief
compliance; tests (the failing test came first, a mutation was run, fixtures
discriminate, numbers quote their SRD line); regression risk (`golden-log.json`
untouched, replay determinism); conformance (`COVERAGE.md`, `unmodelled`
honesty, `PARTIAL`, the tracking guard); scope creep; obvious architectural
violations (the doctrine's invariants, a new special case by name, a second
source of truth, something derived that is stored); hard-coded or
test-specific fixes; accidental coupling; and it lists the foundational
primitives touched and any new special case, because Fable's gate reads those
two lines first.

Ordinary defects go back to the builder as a list; the builder fixes, folds,
re-runs the gauntlet and asks again. Three rounds without a PASS is YELLOW.
A reviewer that sees an architectural problem does not negotiate it: it
returns `ESCALATE` and the builder ends with `ARCHITECTURE_BLOCKED`. The
reviewer's verdict is copied verbatim into the digest; a builder cannot
soften it, and the reviewer ignores any request to.

If a builder cannot launch the reviewer (the launch fails), it reports its
digest with `Opus review: NOT RUN` and Fable launches `qb-reviewer` itself,
once, in that worktree — the only case where Fable is woken twice for one
task.

## Merge procedure (after Gate 3)

```bash
# 1. Is the branch still on top of main? If main moved, send the builder a
#    rebase request by SendMessage and sleep; do it yourself only for a
#    conflict the playbook resolves mechanically.
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

Then: the Done row in `PROGRESS.md` (the existing convention), `state: DONE`
with the quoted approval, the audit counter in `QUEUE.md` — one bookkeeping
commit — and the next task moves up.

**Merge order.** When two branches finished concurrently, integrate the one
with the smaller surface first, send the other builder a rebase request,
and present its Gate 3 only when its re-run digest arrives. If a merge
invalidates a pending branch, that branch goes back to `CHANGES_REQUIRED`
before its merge approval is requested.

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

At **Gate 3**, the digest's lines plus:

```
IE-NNN — title — AWAITING_MERGE_APPROVAL
Architectural gate: lightweight PASS | inspected: <why, and what was found>
Merge-order concerns: none | …
Recommendation: MERGE | DO NOT MERGE
```

Detail lives in the task file. The summary is what the owner reads.

## The whole-engine audit

Due after every 3–5 meaningful engine tasks; `QUEUE.md` keeps the count and
`check-queue.mjs` prints `WHOLE_ENGINE_AUDIT_DUE` when it is reached. It is
Fable-level work by design — it is the one time Fable reads the engine
broadly — and it runs at the next wake-up that would otherwise propose a
mechanic, not in an idle gap. It needs no approval to run; its *findings*
become proposals that pass Gate 1 like anything else. It does not launch
rewrites. Its measurement legwork (counting call sites, listing special
cases, mapping coupling) may be delegated to an Opus subagent; the judgment
is not.

It covers what the two previous audits covered (`PROGRESS.md`, "Architecture
audit against the doctrine"): duplicated primitives, accidental coupling,
inconsistent authority boundaries, missing validation and conformance, drift,
abstractions grown too broad, repeated needs that now justify one, runtime
special cases by name, test blind spots, hidden cross-subsystem assumptions,
state that should be derived, duplicated sources of truth, and complexity
recent work introduced. Measured, not recalled. It is recorded where the
previous ones were: a section in `PROGRESS.md`, and a design record under
`docs/architecture/` if it is long.

## Resuming in a fresh session

`/qb` injects `QUEUE.md`, the validator's summary, `git status`, the
worktrees and the recent log. From those, a cold session answers: what is
being implemented, which builders are active, what awaits approval, review or
merge, what is blocked, what comes next, what is parallel-safe, what has been
decided (`PROGRESS.md`, "Decisions that constrain what comes next"), what each
previous builder did (its task file's digest), and when the next audit is
due.

## What is deliberately not automated

- **No merge without a human**, ever, including trivial ones. The gate is the
  product.
- **No self-approval.** A proposal Fable wrote is not approved until the
  owner says so, however obvious.
- **No autonomous scheduling and no polling.** Builders are launched in
  response to an approval; Fable is woken by completions, not by timers,
  loops or status checks.
- **No utilisation target.** Zero active builders is a normal state.
