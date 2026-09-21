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

1. The owner approves a **batch**: as many tracks as the tree can be
   partitioned into, each bounded enough that a builder never has to invent
   architecture, with dependencies and what may run in parallel. Silence is
   not approval.
2. The coordinator launches the parallel-safe briefs. Two briefs that change
   the same module under `commands/` or `fold/`, the `GameEvent` union,
   `state.ts`, or a vocabulary type run one after the other.
3. A builder works test-first in its worktree, runs the gauntlet
   (`typecheck`, `lint`, `test`, and `coverage` to read its delta, which it
   reports and then reverts — `COVERAGE.md` is the coordinator's to commit once
   per batch, and the `playable-levels.test.ts` failure the revert leaves on a
   branch that moved a number is expected rather than a defect), gets a reviewer
   verdict, fixes ordinary defects, and
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

1. **Rank by what a shape *finishes*, never by what it blocks.** The blocker
   tables print both and the Blocks column is the seductive one; it is a
   count of *consumers*, and four briefs in two batches were mis-sized by
   reading it. A shape blocking thirty entries that finishes one will ship
   one. Read the other columns too: `executed 0` means no consumer inside an
   effect resolver, and a shape whose entries each name a second blocker
   finishes none of them alone.

   Then read the shape's own description in
   `packages/content/scripts/missing-shapes.ts` and, before briefing it,
   **check the claim against the code and the book**. Of those four, one
   shape was a marker rather than a blocker, one was three mechanisms wearing
   a single id, and one described a mechanic `main` had already built — each
   found by a builder in minutes, after a brief had been written from the
   table alone. `STATUS.md`'s "Next" is a list of things somebody noticed, in
   the order they noticed them, and is not this question either.
2. **A batch is as wide as the tree can be partitioned**, not as long as a
   queue. A track runs about half an hour whatever is in it, because it is
   bounded by tool budget rather than by brief count — nine tracks with two to
   four briefs each finished in the time one track takes. So size a batch by
   counting disjoint file sets, not hours: more tracks, never longer queues.
   A track with nothing left to do stops early and costs nothing; a queue
   nobody reaches is a brief written for no one.

   Where several tracks must add a member to one union, give each a **distinct
   anchor** — "insert immediately after member X", a different X per track — so
   the hunks are not adjacent and git merges them without help. Check the
   anchor is in the union you think it is: an anchor named in the wrong union
   sends two tracks to the same place, which is a conflict the protocol exists
   to prevent.

   Partition by **file ownership** rather than by topic:
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

## A worktree is not a clone

Every brief says this, because four batches have each rediscovered a face of it.
A fresh worktree under `.claude/worktrees/` has no `node_modules` and no
`packages/srd/src/generated/`, and both are gitignored, so nothing about the gap
shows up in a diff.

- **Copy the generated SRD data in** (`packages/srd/src/generated/`) or nine test
  files fail on missing JSON, which a builder reads as its own regression.
- **Run `npm install`** (or junction the six packages). Without it `tsc -b`
  resolves `@ie/*` to the *main checkout's* `dist`, so a builder's typecheck
  silently passes against another tree's build of its own package.
- **Do not run `npm run srd:index` in a worktree.** The copied generated JSON can
  be stale relative to the checked-in `packages/srd/src/monster-index.ts`, and
  regenerating from stale input wipes every parsed attack out of a committed
  file. Re-ingest first or leave it alone.

## Guards that hold regardless of role

- `.claude/hooks/builder-guard.mjs` refuses `git push`, `git merge` and ref
  surgery for builders, reviewers and the architect.
- The gauntlet, the frozen fixtures, the content sweep and the idempotency
  sweep are the same for everyone.
