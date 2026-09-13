# IE-009 — Close out tranche 2's four findings

state: IMPLEMENTING
lane: conformance
tranche: 3
parallel-safe: YES — one spell test assertion, two prose corrections and one recorded finding; no runtime code, no event, no definition semantics
depends-on: none
worker: qb-builder · C:/Users/justi/Code/QuestBarrel/ImpossibilityEngine/.claude/worktrees/agent-a32bf711366a7dce4 · worktree-agent-a32bf711366a7dce4
approved: 2026-09-13 — "APPROVE TRANCHE 3"
merge-approved: none

## Brief

### Objective

Discharge the four findings tranche 2's builders and reviewers made outside
their briefs, each of which was deliberately not acted on at the time and
each of which is small enough that the cost of carrying it is larger than the
cost of closing it.

### Why now

They are in `docs/dev/QUEUE.md`'s `LATER` with their evidence attached, and
that evidence decays. One of them is a guard that is weaker than it looks,
which is exactly the kind of thing that stops being noticed.

### Required behaviour

**1. Pin Produce Flame's die size, not only its count.**
IE-002's reviewer found this after its PASS, and the builder correctly
declined to amend a reviewed commit for it. The level 9 test clears the cap
whether the die is `1d8` or `1d6`, so a mutation of the die *size* survives.
The number itself is right — both the builder and the reviewer checked `1d8`
against `packages/srd/raw/spells.md:4377` independently. Close the guard by
asserting the *novice's* ceiling as well: a caster below the first Cantrip
Upgrade step must be able to reach 8 and must not exceed it. Run the `1d6`
mutation and say in the digest that it now fails.

**2. Correct the "`spell-definitions.ts` was never code" framing.**
`CLAUDE.md` says, under "A Definition Is Validated Data": "`spell-definitions.ts`
was never code. All 125 definitions are pure declarative data". IE-005 moved
seven helpers into that file by direction of its own brief, so the sentence
is now false about the file while remaining true about the definitions — and
the distinction is the point of the paragraph, so it is worth stating rather
than deleting. The count is also stale twice over: it was 125, tranche 2 made
it 130, and the builder must read the current number rather than take either.

**3. Record the nine unreachable event types where M2 will meet them.**
IE-006's builder found that nine of the 91 declared event types are emitted
by no command anywhere: `creature-side-declared`, `mounted`, `dismounted`,
`free-interaction-used`, `initiative-swapped`, `stabilised`, `creature-died`,
`items-lost`, `bonus-removed`. Each is a fact a DM declares rather than an
outcome the engine computes, and each is hand-written throughout the existing
suite — so this is a shape rather than a hole, and **it is not this task's
job to build commands for them.** What it is this task's job to do is write
the fact down where the tool surface is planned, because a tool surface
cannot reach any of them and that is a thing to know before M2 rather than
during it. `CLAUDE.md`'s "Known Pending Work" is the place; `PROGRESS.md` is
the foreman's and must not be touched.

**4. Verify the claim in 3 rather than transcribing it.**
Do not take the list of nine on trust. Derive it — the declared union against
what the command layer emits — and if the real answer is eight or ten, write
that. A number copied from a digest into `CLAUDE.md` is exactly the kind of
unchecked claim the honesty guards exist to prevent, and the command layer
has been reorganised since the digest was written.

### Architecture constraints

- No runtime code. No new event, no new command, no definition semantics.
- Item 1 touches a test and nothing else; the definition is already correct.
- `PROGRESS.md` and `docs/dev/` are the foreman's and are out of bounds.

### Acceptance criteria

1. The `1d6` mutation of Produce Flame fails a named test; say which.
2. The framing paragraph is true of the file as it now stands, and its count
   matches the registry.
3. The unreachable-type list in `CLAUDE.md` is derived and stated with the
   method that derived it, not asserted.
4. The whole gauntlet passes; both frozen logs untouched; `COVERAGE.md`
   regenerated with no diff.

### Tests and conformance

The existing spell test file that owns Produce Flame. No new test file.

### Dependencies

None.

### Likely file surface

`packages/engine/src/ongoing-spells.test.ts` (Produce Flame's tests),
`CLAUDE.md`. Nothing else.

### Out of scope

Building a command for any of the nine event types; the `advanceCharacter`
feature-pool bug, which is IE-008 and is a real bug rather than a note;
anything in `docs/dev/` or `PROGRESS.md`.

### Known risks

- Item 3 is prose about a derived fact, and prose is where an unchecked claim
  hides. Item 4 exists to stop that, and the acceptance criterion asks for
  the method rather than the number.
