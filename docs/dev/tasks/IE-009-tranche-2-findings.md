# IE-009 — Close out tranche 2's four findings

state: DONE
lane: conformance
tranche: 3
parallel-safe: YES — one spell test assertion, two prose corrections and one recorded finding; no runtime code, no event, no definition semantics
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 3"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 3" (tranche 3 authority; 13/13 conditions green)

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

## Completion digest

The builder's revised digest and the four review verdicts are long; what
follows is the record that matters, and the task file is the only place it
lives.

```
IE-009 — Completion digest (revised after the foreman's bounded pass)
Builder: COMPLETE
Worktree: .claude/worktrees/agent-a32bf711366a7dce4   Branch: worktree-agent-a32bf711366a7dce4   Commit: 7553f96 (rebased by the foreman to 973129f)
Opus review: 3 builder-launched rounds, a foreman-authorised bounded fourth pass, and an amendment confirmation — PASS at the last
Tests: 5558 passing / 5558 total; new tests: 0 (one assertion tightened in the file that owns Produce Flame); mutation run: `dice: '1d8'` → `'1d6'` on PRODUCE_FLAME fails `reads the Cantrip Upgrade off the caster's level` with "expected 6 to be 8". Before the change the whole suite passed under that mutation.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — both frozen logs untouched; COVERAGE.md regenerated with no diff; no runtime code in the diff.
Architectural deviations: none. Two conscious departures from the brief's letter, both declared: the SRD line citation is replaced by the quoted sentence (the brief's 4377 was wrong — the sentence is at 4388 — and a line number into re-vendorable third-party text would have been the engine's only one); and acceptance criterion 2's count is satisfied by removing the count rather than by carrying a current digit.
Foundational primitives touched: none.
New runtime special cases: none.
Files outside the brief's surface: none.
Out-of-scope findings: (1) three more stale prose counts in CLAUDE.md, in sections the builder did not write — "fifty-eight of the eighty-two executed definitions" (86 now), "fifty-three now" for PARTIAL_SPELLS (54), "fifty-two companions" — all moved by IE-001 in one commit. (2) `spell-schema.test.ts`'s runtime sweep still excludes `spell-definitions.ts`, so none of the twelve readers is swept; no special case exists there today, re-verified with the sweep's own regex. (3) The brief's SRD citation was two lines off, and IE-002's builder and reviewer each recorded independently checking a line number that was wrong.
Unresolved concerns: none.
Confidence: high
Recommendation: READY FOR MERGE
```

**The load-bearing result is item 4, and it was the item that existed to
catch exactly this.** The digest IE-006 handed over said nine event types are
emitted by no command. Derived rather than transcribed, the answer is
**seventeen**, and the eight it missed are one family: `scene-set`,
`landmark-added`, `creature-placed`, `sight-declared`, `cover-declared`,
`combat-started`, `time-advanced`, `spellcasting-declared`. That is scene
setup — **a tool surface cannot start an encounter.** `placeCreature`,
`declareCover`, `declareSight` and `startCombat` are exported pure functions
returning `Result<State>` rather than `Result<GameEvent[]>`, called by the
reducer to fold an event nobody emits. The twelfth instance of this
repository's recurring finding and the largest: not one unreachable rule but
the whole opening of a session, found before M2 rather than during it.

## Risk gate

Three signals, and two of them were the foreman's own errors.

**Round exhaustion, and the rule's own wording.** The builder's three rounds
went 2 → 2 → 1, every finding a precision defect in prose it had itself
rewritten that round, confidence high and escalation none throughout. The
round-exhaustion rule, written four commits earlier, said **"strictly
shrinking"** — which 2 → 2 → 1 is not. Applied literally it escalates a
sentence about a derivation method to Fable, which is the cost the rule
exists to avoid. The bounded pass was authorised under the rule's purpose and
**the rule's text was then corrected** rather than quietly bent: the test that
separates convergence from churn is whether a finding *repeats*, not whether
the count falls every round. Non-increasing, ending small, no finding raised
twice.

**A merge under a running review, which is a foreman error with a
generalisable lesson.** IE-001 was merged while this task's bounded pass was
in flight, on the reasoning that its assumptions were unaffected — it adds no
event type and shares no code. That reasoning was wrong in a specific way:
**this task's deliverable *is* a set of counts read out of the repository**,
and IE-001 moved two of them. There is no test to fail and no line to
conflict, because the base and the new `main` are byte-identical where this
branch wrote, so two wrong numbers would have installed silently behind a
clean merge. Condition 12 already said the right thing — *"nothing merged in
the meantime changed an assumption the review rested on"* — and it was read as
*"will the tests still pass"*. `WORKFLOW.md` now names the case that reading
misses.

**A judgement call against the letter of an acceptance criterion**, declared
as such by the builder and put to the reviewer rather than ruled by the
foreman. Criterion 2 required the definition count to match the registry; the
builder re-derived it (132, not 130 + 2) and then **removed the digits**,
arguing that the quantifier is what carries the paragraph and the quantifier
*is* guarded, while a digit is a claim nothing checks sitting in the file
whose whole subject is claims that are checked.

The reviewer agreed, and drew the line more precisely than either the builder
or the foreman had: **a digit is legitimate when it is the subject of the
claim and ships with the method that regenerates it** — which is why the
seventeen-of-ninety-one paragraph rightly keeps its digits and gained a
derivation — **and illegitimate when it is scenery beside a structural
argument.** Both removed counts were scenery: "a definitions file names every
one of its own ids" is true at any size, which is precisely why that half of
the sweep can never be pointed at the file.

It also noted what it would have objected to had it been got wrong: the
*historical* digits are kept — "it said 125 while the catalogue held 130" —
because they describe the past and cannot go stale, and stripping them would
have destroyed the evidence for the decision along with the liability.

**And the decision was tested under the conditions it was made about.** `main`
moved three times during the review. On the third move the amended text needed
no checking at all, because it holds no live count; the previous text would
have needed re-verifying a third time inside one review.

GREEN. Merging under tranche 3 authority.

## Merge record

Merged to `main` as `973129f`, fast-forward, pushed. Worktree retired and
branch deleted. Rebased by the foreman four times over the course of the
task — a consequence of the sequencing error above, and every one clean.

The thirteen conditions, asserted by name:

1. **Inside the brief** — yes; two files, both on its declared surface. Two
   departures from its letter, both declared and both ruled above.
2. **Builder COMPLETE** — yes.
3. **Independent reviewer PASS, confidence high** — yes, at the amendment
   confirmation, after three builder rounds and a bounded fourth pass. Not
   before: the foreman did not supply it and did not merge on three `DEFECTS`.
4. **Defects resolved** — yes, including the two the foreman caused.
5. **Gauntlet in the worktree** — typecheck ✓ lint ✓ test 5558/5558 ✓
   coverage ✓ `git diff --exit-code COVERAGE.md` ✓.
6. **Conformance** — `COVERAGE.md` regenerated byte-clean, and its 46 tracked
   + 86 executed cross-checks the 132 the amendment re-derived.
7. **No unresolved architecture blocker** — none; Fable was not needed.
8. **No material deviation** — two declared, both inside the criteria's
   purpose, and the arguable one was ruled by an independent reviewer rather
   than by the foreman.
9. **No unexpected authority-boundary or foundational-state change** — none;
   no runtime code in the diff at all.
10. **No meaningful scope expansion** — none.
11. **No non-mechanical merge conflict** — none across four rebases.
12. **Integration did not invalidate the review** — the branch diff is
    `CLAUDE.md` and `ongoing-spells.test.ts` only, and the full gauntlet was
    re-run on `main` after the fast-forward: typecheck ✓ lint ✓ test
    5558/5558 ✓ coverage byte-clean ✓, both fixtures untouched. This is the
    condition the task's own history is about.
13. **Risk gate** — GREEN, above.

Verified on `main` at `973129f` and pushed to `origin/main`.
