# How delegated work runs

One coordinating session, builders in worktrees, an independent review, and
the owner deciding what is built. This is the whole procedure; everything
else an agent needs is `CLAUDE.md` and the design note for the subsystem.

## Roles

| Role | Does | Never |
|---|---|---|
| **Owner** | decides what is built and approves a batch of briefs | — |
| **Coordinator** (the `/qb` session, Opus) | writes briefs, launches builders, reads reviews, integrates, merges, pushes, updates `STATUS.md` | approves its own batch, widens a brief, invents architecture |
| **Builder** (`qb-builder`, Opus, own worktree) | one brief end to end: tests first, implementation, gauntlet, review, fixes, a completion digest | merges, pushes, picks its next task, edits `STATUS.md` or `docs/` |
| **Reviewer** (`qb-reviewer`, Opus) | one independent review: diff against brief, tests, regression risk, scope | edits code |
| **Architect** (`qb-architect`, Fable, on call) | a bounded architectural question the coordinator cannot answer from `CLAUDE.md` and the design notes | edits, commits, routine review |

## The loop

1. The owner approves a **batch**: briefs enough to fill four to six hours of
   *parallel* work, each bounded enough that a builder never has to invent
   architecture, with dependencies and what may run in parallel. Silence is
   not approval.
2. The coordinator launches the parallel-safe briefs. Two briefs that change
   the same module under `commands/` or `fold/`, the `GameEvent` union,
   `state.ts`, or a vocabulary type run one after the other.
3. A builder works test-first in its worktree, runs the gauntlet
   (`typecheck`, `lint`, `test`, `coverage`, `git diff --exit-code
   COVERAGE.md`), gets a reviewer verdict, fixes ordinary defects, and
   reports a digest: what changed, what the tests prove, deviations from the
   brief, anything it could not do.
4. The coordinator merges a task that is **clean** — inside its brief,
   reviewer pass, gauntlet green, no unapproved deviation, no new
   content-specific assumption in the engine — without asking again. Anything
   else goes back to the builder, to the architect (a bounded question), or to
   the owner (a decision).
5. When the batch is done the coordinator updates `STATUS.md`, reports the
   `COVERAGE.md` delta, and proposes the next batch. It does not start it.

## Choosing what goes in a batch

Three rules, written down after a batch of five briefs moved the catalogue by
three entries while the two heaviest blockers sat untouched at the top of a
table that ranks them.

1. **Rank by reach, not by recency.** `COVERAGE.md`'s blocker tables say what
   each missing shape blocks and what it would finish; that ranking decides
   what is briefed. `STATUS.md`'s "Next" is a list of things somebody noticed,
   in the order they noticed them, and is not the same question. Read the
   shape's own description in `packages/content/scripts/missing-shapes.ts`
   before ruling it out — more than one entry there says a cheaper thing
   finishes it than its name suggests.
2. **A batch is four to six hours of work running at once**, which means
   briefs measured in hours rather than in fields, as many of them as can run
   simultaneously. Partition them by **file ownership** rather than by topic:
   one builder owns a file for the batch and nobody else opens it. Two briefs
   on one topic that would queue behind each other on the same module belong
   to one builder instead.
3. **Every brief names the number it moves** — the entries it completes, the
   column it shifts. A brief that cannot needs a different justification: a
   statement in the docs that is false, a bug that loses or corrupts data, or
   a guard the repository has no test for. Mechanism built ahead of anything
   that asks for it is how a batch ships nothing.

## Briefs

A brief is a short file the builder can act on alone: the SRD sentence or
bug it serves, the files it may touch, the tests that must exist, and what is
out of scope. Keep them in the conversation or in a pull request; they are
not a permanent record. Closed briefs from the earlier queue-driven process
are in `docs/archive/tasks/`.

## Guards that hold regardless of role

- `.claude/hooks/builder-guard.mjs` refuses `git push`, `git merge` and ref
  surgery for builders, reviewers and the architect.
- The gauntlet, the frozen fixtures, the content sweep and the idempotency
  sweep are the same for everyone.
