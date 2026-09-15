# IE-006 — A second frozen event-log fixture

state: DONE
lane: conformance
tranche: 2
parallel-safe: YES — a new fixture, a new scripted scenario and a `.gitattributes` line; no source file changes
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 2"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 2" (tranche 2 authority; 13/13 conditions green)

## Brief

### Objective

Freeze a second event log, produced once by a scripted scenario that
exercises the subsystems the first fixture predates — the five reaction
windows, a declared and interrupted casting, the ongoing record and a moved
origin, area triggers, rests, resource pools, death saves, equipment removal,
roll-modifier and armour-class grants — and hold the fold to it under the
same compatibility test, for ever. The first fixture is never regenerated;
neither is this one.

### Why now

`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.5: `golden-log.json`
holds 93 events of 35 types; 56 of the 91 types have no compatibility
fixture, including every event that carries state a fold reconstructs for
the reaction windows, the interruptible casting and the ongoing record. A
schema change to any of them would pass every test.

### Current relevant architecture

`persistence.test.ts`: the fold-equality test over
`packages/engine/fixtures/golden-log.json`, the `KNOWN_EVENT_TYPES` ledger
(91 entries, asserted both ways), and the "two different seeds fold the same
log identically" assertion. `.gitattributes` marks the fixture
`merge=binary`; `CONTRIBUTING.md` rule 1 forbids regenerating it.

### Required behaviour

1. A scripted scenario (a test-side script, like the one that produced the
   first fixture) that drives, through the public API: a weapon attack with a
   damage-rolled window answered by Uncanny Dodge and settled; a save with a
   test-rolled window; a declared casting interrupted by Counterspell and one
   that settles; an ongoing spell with an origin moved along a route; a
   persistent area catching a creature at a boundary and on entry; a Short
   Rest and an interrupted Long Rest; a pool spent and restored; a creature
   dropped to 0, a death save, a stabilisation; an item unequipped and lost;
   a roll-modifier grant and an armour-class grant released by a dispel.
2. Run it once, freeze the output as `golden-log-2.json`, add the
   `.gitattributes` line and the `CONTRIBUTING.md` sentence.
3. The compatibility test folds it and compares byte for byte; a second
   assertion lists the event types it covers and requires the union of both
   fixtures to cover at least 80 of the 91 types, naming the rest.

### Architecture constraints

- No engine change. If the scenario cannot reach a subsystem through the
  public API, that is a finding for the digest, not a reason to add one.
- The scenario is deterministic from a seed and re-running it must produce
  the frozen file — asserted once at freeze time and then never again.

### Acceptance criteria

1. The fixture exists, folds identically, and the coverage assertion holds.
2. `CONTRIBUTING.md` and `.gitattributes` name it.
3. The whole gauntlet passes.

### Dependencies

None.

### Likely file surface

`packages/engine/fixtures/golden-log-2.json`, `persistence.test.ts` (or a
sibling), a scenario script beside the first, `.gitattributes`,
`CONTRIBUTING.md`, `CLAUDE.md` (one sentence under the event-log section).

### Out of scope

Regenerating the first fixture; per-event field schemas (a later task).

### Known risks

- A scenario that silently skips a subsystem covers nothing; the type-coverage
  assertion is the guard.

## Completion digest

```
IE-006 — Completion digest
Approved architectural intent: Freeze a second event log, produced once by a scripted scenario that exercises the subsystems the first fixture predates, and hold the fold to it under the same compatibility test, for ever. Neither fixture is ever regenerated.
Builder: COMPLETE
Worktree: .claude/worktrees/agent-ab456f876cef3d0bf   Branch: worktree-agent-ab456f876cef3d0bf   Commit: d1f6536 (rebased by the foreman to 2915909)   Rebased on main at: 83e1365
Opus review: PASS — rounds: 2
Tests: 5424 passing / 5424 total; new tests: 15 (packages/engine/src/persistence-2.test.ts); mutation run: changed `items-lost`'s reducer arm in events.ts to drop the whole stack rather than the quantity — only the new fixture's "folds to the state it has always folded to" failed; the other 5423 tests passed, so the pair of frozen logs is the only thing watching that rule. A second mutation (spell-origin-moved leaving the origin where it was) failed nine of the new file's tests.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — COVERAGE.md regenerated and unchanged; no spell definition or class feature touched.
Architectural deviations: none
Foundational primitives touched: none — no file under packages/engine/src changed except the new test file. events.ts, commands.ts and spell-definitions.ts are byte-identical to main.
New runtime special cases: none — no runtime code was added.
Files outside the brief's surface: none. All six are named in the brief's "Likely file surface".
Out-of-scope findings (not acted on):
  - `advanceCharacter` declares only hit-dice and slot pools. A **feature** pool granted at the new level is never declared, so a Fighter advanced from 8 to 9 has Indomitable on the sheet and no pool to spend it from, and `takeTestReaction` refuses. `poolEvents` (creation.ts:2423) handles activated/pool/reaction grants at creation; advanceCharacter (creation.ts:2661) does not. Worked around by creating Bram at level 9; the fixture still carries a real advancement (Nyx 4 → 5).
  - Nine of the 91 event types are emitted by no command anywhere: `creature-side-declared`, `mounted`, `dismounted`, `free-interaction-used`, `initiative-swapped`, `stabilised`, `creature-died`, `items-lost`, `bonus-removed`. Each is a fact a DM declares and each is hand-written throughout the existing suite, so this is a shape rather than a hole — but it is worth knowing that a tool surface cannot reach any of them.
  - Metamagic is not executed, so nothing spends Sorcery Points. The fixture hand-writes a `resource-spent` so Sorcerous Restoration has something to give back.
  - Excess-property checking on the `GameEvent` union bit twice while writing the script (an `initiative-swapped` written with `id`/`with` instead of `a`/`b`, and an `items-lost` with `reason` instead of `source`). This is the third and fourth instance of the trap CLAUDE.md already records; both were caught, the first by the reducer throwing and the second by `tsc`. No engine change proposed.
Unresolved concerns: none
Reviewer confidence: high
Recommendation: READY FOR MERGE

IE-006 — Independent review
Verdict: PASS
Commit reviewed: d1f6536   Gauntlet re-run: typecheck ✓ lint ✓ test 5424/5424 coverage diff ✓
Brief compliance: met. All eleven required subsystems drive through the public API — Uncanny Dodge answering a damage-rolled window and settled; Indomitable answering a test-rolled window and settled; Counterspell interrupting a declared casting plus a second declaration settled by resolveDeclaredCast; Moonbeam's origin moved along a stated via route; Web caught on entry and at a turn start (and Moonbeam at end-of-turn and area-moved); Short Rest, an interrupted Long Rest and one that runs its course; Second Wind/Sorcery Points/Rage spent and restored; the rat dropped to 0, a death-save-recorded, a stabilisation; chain shirt unequipped and rope taken away; Blur and Mage Armor granted, released by a dispel, and re-granted so the log is put away with both alive. Coverage assertion names the uncovered set (empty) with a floor of 80 against 91 declared, as the brief specified. CONTRIBUTING.md and .gitattributes both name the new fixture.
Tests: one new file, persistence-2.test.ts, 15 tests, 1.45s. Pins the fold's named facts (clock 40374, round 5, 34 turns, 15 castings, 142 command ids, 38 rolls issued, hit points, pools, rest moments, inventory/equipped split, exhaustion), the still-open damage window including engine provenance on its roll, the four Concentrations, the five ongoing records with spellId/level/on, two origins, the conditions with their casting links, Grease's Prone outliving its casting, the AC and roll-modifier grants by source, the eight timers by key, the repeat save's hook and the Web's escape check. Mutations that bite: a renamed or reshaped event fails "folds at all" or the named facts; a moved expiry boundary changes the timer list without changing an event; narrowing the fixture fails the >=50-fresh-types assertion; deleting the first fixture fails "still needs the first fixture". Fixture discriminates — all four area moments, both Dispel `on:` variants, offers as (reactor, feature) pairs. Determinism re-verified by me: regenerating to scratch is byte-identical to the frozen file.
Regression risk: none. golden-log.json byte-untouched, persistence.test.ts untouched, no engine source changed. Replay determinism asserted three ways (same seed twice, different seed, JSON round-trip at every one of 552 prefixes). The idempotency and action-economy sweeps in invariants.test.ts are unaffected and still green.
Conformance: PASS — COVERAGE.md regenerated and unchanged, correctly, since no spell or feature moved.
Scope creep: none in code. CLAUDE.md carries three paragraphs where the brief suggested one sentence; content is accurate and the consequent edits (the "four rules" bullet, the "four tracked files" count) were forced by the change.
Architectural violations: none. No runtime code added; no special case keyed on a name; no second source of truth — declaredEventTypes() is duplicated from persistence.test.ts with a written reason, over the same union, and persistence.test.ts still asserts KNOWN_EVENT_TYPES both ways.
Hard-coded or test-specific fixes: none. The "the fixture insists" flat bonuses force branches deterministically, which is the documented technique for reaching the path the dice would not.
Accidental coupling: none. The test imports only fold/GameEvent/GameState; the generator imports commands, as make-golden-log.ts already does.
Foundational primitives touched: none.
New runtime special cases: none.
Defects for the builder: none
Escalation reason: none
Confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

One signal, and it is a size overage rather than a scope change.

**Prose longer than the brief suggested.** The brief asked for "one sentence"
in `CLAUDE.md`; the diff carries three paragraphs and two edits elsewhere in
the file, and the reviewer named it rather than passing over it. Read in full.
The two edits elsewhere are **forced arithmetic**: "Four rules that a session
will otherwise break" and "Four tracked files are `merge=binary`" were both
made false by adding a fixture, and `CONTRIBUTING.md`'s rule 1 and conflict
table say the same thing in the same two places. A file that records how the
repository actually works cannot be left counting four of five. The three new
paragraphs say what the second fixture is, why one was not enough, that
neither is ever regenerated and that three types live only in the older log —
which is the sentence a future session most needs, because the obvious wrong
conclusion is that the new fixture supersedes the old. Long, and every line of
it load-bearing. GREEN.

Not signals: no deviation, no foundational primitive, no runtime code at all,
no new abstraction, no special case, reviewer confidence high, builder and
reviewer in agreement. `packages/engine/src` gained exactly one file and it is
a test.

Worth recording rather than acting on: the builder's own mutation is the
evidence this task was worth doing. Changing `items-lost`'s reducer arm to
drop the whole stack rather than the quantity failed **only** the new
fixture — 5423 other tests passed. That is precisely the hole the audit
measured, demonstrated rather than argued.

Merging under tranche 2 authority.

## Merge record

Merged to `main` as `2915909`, fast-forward, pushed. Worktree retired and
branch deleted.

`main` had moved twice since the builder rebased — `de45194` (IE-002) and
`d2af1f7` (its bookkeeping) — so the foreman rebased again. Both of those
touch `CLAUDE.md`, which is one of the three known collisions, and the rebase
was conflict-free: IE-002 wrote in "A Casting Can Hold A Point" and "Known
Pending Work", this task in "Two people work on this repo" and "The Event
Log". Mechanical, as condition 11 requires.

The thirteen conditions, asserted by name:

1. **Inside the brief** — yes; all six files are in its "Likely file surface",
   and the coverage floor it set at 80 of 91 came out at 91 of 91.
2. **Builder COMPLETE** — yes.
3. **Independent reviewer PASS, confidence high** — yes, at round two.
4. **Defects resolved** — yes; none outstanding, no unresolved concerns.
5. **Gauntlet in the worktree** — typecheck ✓ lint ✓ test 5424/5424 ✓ coverage
   ✓ `git diff --exit-code COVERAGE.md` ✓.
6. **Conformance** — `COVERAGE.md` regenerated and unchanged, correctly: no
   spell definition and no class feature moved.
7. **No unresolved architecture blocker** — nothing was `ARCHITECTURE_BLOCKED`
   and Fable was not needed.
8. **No material deviation** — none declared, none found.
9. **No unexpected authority-boundary or foundational-state change** — none.
   `packages/engine/src` gained one test file and nothing else; `events.ts`,
   `commands.ts` and `spell-definitions.ts` are byte-identical.
10. **No meaningful scope expansion** — none; the prose overage is inspected
    above and is inside the file's own surface.
11. **No non-mechanical merge conflict** — the `CLAUDE.md` collision with
    IE-002 resolved by rebase with no conflict at all.
12. **Integration did not invalidate the review** — the rebase crossed IE-002's
    two commits, which change no engine source the fold reads, and the full
    gauntlet was re-run on `main` after the fast-forward: typecheck ✓ lint ✓
    test 5468/5468 ✓ coverage byte-clean ✓. The suite grew from 5453 to 5468 by
    exactly this task's 15 tests.
13. **Risk gate** — GREEN, above.

Verified on `main` at `2915909` and pushed to `origin/main`.
