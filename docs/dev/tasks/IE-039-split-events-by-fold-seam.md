# IE-039 — Split `events.ts` along the fold's own seams

state: DONE
lane: mechanism
tranche: 6
parallel-safe: NO — it *is* `events.ts`; nothing that touches the fold runs beside it
depends-on: IE-038
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Split the 5,363-line `events.ts` into a state module, the event union, and a
`fold/` directory, behaviour-preserving, with declaration-level byte-identity
as the oracle.

### Why now

This is the file that serialised tranche 5. Seven of its ten mechanism tasks
touched it — IE-020 → 028 → 030 → 032 → 033 → 034 → 035 — and that chain *was*
the critical path. Read by domain those seven touched four different regions,
so under a split three of them would have been concurrent. Tranche 6 has the
same shape: IE-038 (casting cases), IE-040 (creature entry), IE-041 (turn
passes and casting), IE-042 (a grant family), IE-047 (release and expiry). The
delta audit deferred it because a 4,800-line split would stall every mechanism
task behind it; at a tranche boundary the stall is one wave. This is the
owner's own test for putting simplification before capability: four approved
tasks in this cycle would otherwise serialise behind a file none of them
wholly needs.

### Current relevant architecture

Verified against `main` at `7f503c2`: 5,363 lines — state types (1–1,061), the
`GameEvent` union (1,062–2,130, 94 declarations with docstrings),
`CorruptLogError`, release and cleanup (2,335–2,680), area detectors and
turn-boundary raising (2,882–3,570), expiry and triggered endings
(3,641–3,970), the derived-pass pipeline (`applyEvent`, 3,974), `applyOne`
(4,151–5,341, a 1,190-line switch over 108 cases), `fold` (5,341).

**The apply boundary is verified one-directional**: the only calls to
`applyOne(`, `applyEvent(` and `fold(` inside the file are `applyEvent` →
`applyOne` and `fold`'s reduce. No helper calls back up into the pipeline,
which is the cycle risk the precondition below is about.

### Required behaviour

1. **Precondition, before any move:** build the declaration-level value graph
   of `events.ts` — the `invariants.test.ts` `DECLARATION` walk is the
   template — and confirm it is acyclic across the proposed module boundaries.
   A cycle is `ARCHITECTURE_BLOCKED` (a YELLOW for Fable), not something to
   work around.
2. Target shape: `state.ts` (the state types and `initialState`); `events.ts`
   **kept as the union only** — it is the schema five test files read by path;
   and `fold/` with `release.ts` (the grant enumerator, `releaseCasting`,
   `releaseOnTarget`, `releaseGrants`, `withoutTarget`, `holdsNothingOf`),
   `areas.ts`, `turns.ts`, `expiry.ts`, `endings.ts` and `apply.ts`
   (`applyOne`, `applyEvent`, `fold`). One barrel re-exports exactly the public
   names `events.ts` exports today.
3. `applyOne` **stays one switch** with its `never` default. Dispatching it by
   domain is IE-027's move and may follow in a later task; the first pass is
   the safer one.
4. Every moved body is **byte-identical** to its source after a short, declared
   list of mechanical transformations (import rewrites and nothing else). The
   digest names the list, as IE-027's did.
5. No public name changes. `index.ts`'s exported surface is identical.

### Architecture constraints

Settled; a deviation is `ARCHITECTURE_BLOCKED`:

- the union stays in `events.ts`; the state types move to `state.ts`;
- byte-identity of moved bodies is the oracle, not "the suite passed";
- no behaviour change of any kind, including refusal codes and event order.

### Acceptance criteria

1. Both frozen logs fold to byte-identical state; `scenario.test.ts`'s re-run
   determinism holds.
2. The value-graph script is committed (it is the evidence for the layout) and
   reports no cycle.
3. The five path-reading tests are updated and still assert what they asserted:
   `persistence.test.ts` and `persistence-2.test.ts` (`declaredEventTypes`
   reads the union — unchanged if the union stays put),
   `declared-fact-commands.test.ts` and `spell-schema.test.ts` (the union),
   `invariants.test.ts`'s emitted-type sweep (its exclusion of `events.ts` must
   extend to the new fold modules, and the comment must say **why** reducer
   `case` labels do not match a `type:` position), and `speed.test.ts`'s
   single-reader sweep (its population gained `events.ts` in IE-031 and must
   gain the fold modules).
4. `npm run typecheck`, `npm run lint`, the full suite, `COVERAGE.md`
   byte-clean.
5. The digest records the module map — which declaration went where — because
   the next four tasks are briefed against it.

### Tests and conformance

No new behavioural tests. The frozen logs and the sweeps are the conformance.
CLAUDE.md gains a short paragraph in the event-log section naming the seams,
in the shape of the one IE-005 wrote for `commands/`.

### Dependencies

After IE-038 — it rewrites the casting cases and the pending field, and
rebasing that onto a split file is strictly worse than splitting after it.

### Out of scope

Dispatching `applyOne` by domain. Any change to the union's members. The
`spell-definitions.ts` split (deferred — see the tranche record).

### Known risks

Low with the oracle, and the one thing that could go wrong is a helper reading
module-level state; the file is pure and there is none. The real risk is
mechanical: an import cycle introduced by a careless boundary, which the
precondition script is there to catch before any code moves.

## Module map

The digest's load-bearing output, because four later tasks are briefed against it.

| Module | Holds |
|---|---|
| `state.ts` | `CreatureState`, `AppliedCommand`, `CommandStamp`, `LastDamage`, `PendingAttack`, `PendingMove`, `PendingCasting`, `PendingDamage`, `PendingTest`, `ReadiedResponse`, `ReadiedAction`, `InventoryLine`, `GameState`, `initialState` |
| `events.ts` | the `GameEvent` union and the barrel — 1,180 lines, down from 5,432 |
| `fold/common.ts` | `CorruptLogError`, `withCombat`, `creatureOf`, `withCreature`, `sceneOf`, `combatOf`, `must`, `castingIdFor`, `sortedTimers`, `sortedRecord` |
| `fold/release.ts` | the grant enumerator and every release door — `grantsOf`, `grantSourcesOf`, `withoutGrants`, `releaseCasting`, `releaseOnTarget`, `releaseGrants`, `holdsNothingOf`, `alsoOn`, `withoutTarget`, the pending-casting helpers |
| `fold/areas.ts` | the area detectors and the debt queue |
| `fold/turns.ts` | `raiseTurnSaves`, `raiseTurnEnd`, `reachStartOfTurn` |
| `fold/expiry.ts` | `expireEffects`, `dropStrandedDamage`, `dropOrphanedSaves` |
| `fold/endings.ts` | `allyOfCaster`, `endTriggeredCastings` and the trigger machinery |
| `fold/apply.ts` | `applyOne` (one switch, `never` default), `applyEvent`, `fold`, `historyOf`, the derived passes |

Graph: `common` and `release` are leaves; `areas → common`; `turns → areas, common`;
`expiry → release`; `endings → release`; `apply → everything`. **ACYCLIC**, verified
by running `scripts/fold-graph.ts` on `main` after the merge.

## Completion digest

```
IE-039 — Completion digest
Builder: COMPLETE
Commit: ba5dc74 (reviewed at 87d825f; replayed onto main as 3190f91)
Opus review: PASS — rounds: 3, confidence high, no behavioural defect at any round
Tests: 7902 / 7902 on the branch (up from 7874: per-source-file sweeps see nine more files);
  no new behavioural tests, which the brief directs. On main after the replay: 7936 / 117 files.
Mutations: (a) moving `sortedRecord` into `fold/apply.ts` makes fold-graph.ts report the cycle
  apply → areas → turns and exit 1; (b) removing the fold/ exclusion from EVENT_TYPE_SOURCE
  fails two invariants tests; (c) removing FOLD_SOURCE from SPEED_SOURCE fails the assertion
  that both reducer cases ask speedOf — the one a shrinking population would have silenced.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — both frozen logs and scenario.test.ts's three determinism assertions run
  explicitly, 53/53. Fixtures untouched.
Architectural deviations: none. One declared addition inside the brief's intent — fold/common.ts
  is a seventh module beyond the brief's named six, and the graph shows it is mechanical rather
  than a judgement: sortedRecord is reached by turns, areas and apply, so it cannot live in any
  of them without making that seam a dependency of the others. That is commands/command.ts's
  argument exactly. The reviewer accepted it as justified by the graph.
Foundational primitives touched: the GameEvent union's file, GameState and every state record
  plus initialState, and the whole reducer — all by location only. All 88 declarations are
  code-identical with comment lines removed, independently re-derived by the reviewer.
New runtime special cases: none.
Files outside the brief's surface: CONTRIBUTING.md (3 lines) — its B-lane ownership row said
  events.ts holds "the union, the reducer, GameState", which the split makes false.
Out-of-scope findings: (1) fold-layout.json is a hand-kept list of 88 names and fold-graph.ts
  detects drift and exits 1, but it is in neither npm test nor the gauntlet — the brief asked
  for the script as evidence rather than as a guard, so this is a deliberate limit. (2) Two
  docstrings were already orphaned on main and the split found them by making them cross a
  module boundary; both fixed, no sweep for others.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

**Inspected.** The largest structural change of the tranche: the whole reducer
moved, the state root moved, and the union's file went from 5,432 lines to 1,180.

**The oracle is byte-identity and it was independently re-derived.** All 88
declarations match their source with comment lines removed on both sides, and
with an empty transformation list exactly thirty-one differ, each by the seven
characters of its `export` prefix — which is what says nothing else moved. No
`.json` fixture is in the diff; I checked the file list directly.

**Both sweeps whose populations could silently shrink are pinned rather than
trusted.** `FOLD_SOURCE`'s key set is asserted outright, and a positive
assertion checks that `fold/apply.ts` actually contains a reducer `case` — so a
population that emptied would fail loudly rather than pass vacuously. Mutation
(c) is the one that matters: it proves the speed sweep would have gone quiet if
the fold modules had not joined its population.

**The merged commit is not the reviewed commit, and I verified the difference
myself.** The reviewer passed `87d825f`; the builder then made one edit on its
own initiative and the final `ba5dc74` differs by **`CLAUDE.md` prose only**, 1
file, +15/−5, no code. I read all twenty lines. It replaces a claim that "84 of
88 declarations match byte for byte" — a number the builder and the reviewer
measured as 84 and 66 over an identical diff, because the answer depends entirely
on which declaration a comment block is attributed to — with the reproducible
form, "all 88 identical with comment lines removed", which is what the reviewer
verified directly. That is this repository's own rule about a number two
measurements disagree about, applied by a builder to its own claim. Accepted, and
recorded here rather than sent back for a fourth round on prose.

**The seventh module is justified by the graph rather than by taste**, and the
mutation proves it: moving `sortedRecord` anywhere else produces a cycle the
script reports. It is `commands/command.ts`'s argument arriving in the fold.

Classification: **GREEN**.

## Architecture decision

None. The precondition the brief set — a value graph with no cycle across the
proposed boundaries — was met, so no YELLOW was needed. `scripts/fold-graph.ts`
is committed as the evidence and reports ACYCLIC on `main`.

## Merge record

Replayed onto `main` as `3190f91` and pushed; clean, despite `CLAUDE.md` having
been edited by both IE-044 and IE-045 since this branch was cut.

`main` verified **after** the merge: typecheck ✓, lint ✓, **7,936 tests across
117 files** ✓, both frozen logs and the scenario determinism explicitly ✓ (53
tests), `COVERAGE.md` regenerated and byte-clean ✓, `fold-graph.ts` reports
**ACYCLIC** ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence — on `87d825f`, with the prose-only delta to `ba5dc74` verified
by me at integration and recorded above; **4** no defects outstanding after three
rounds; **5** gauntlet green; **6** conformance green, fixtures untouched; **7**
no blocker; **8** one declared addition, justified by the graph and accepted;
**9** the primitives are the brief's own, moved by location only; **10** one file
outside the surface, `CONTRIBUTING.md`, whose ownership row the split falsified;
**11** integration valid, clean replay; **12** re-verified on `main`; **13** risk
gate inspected, GREEN.

## What it bought, and what it did not

**It did not buy wave 3's three-way concurrency, and that is worth stating
plainly rather than discovering at the next launch.** The audit predicted that
IE-040 and IE-041 would run beside each other *because* the split would put them
in different fold modules. They will not: `applyOne` stayed **one switch** with
its `never` default, which this brief mandated as the safer first pass and which
the audit itself offered as the safer of two options. So every task that changes
a reducer case still changes `fold/apply.ts` — IE-040 at the `creature-added`
case, IE-041 at the casting and turn cases, IE-047 at the `alsoOn` and
`withoutTarget` call sites — and this repository's one-owner-per-primitive rule
names exactly that situation.

Wave 3 is therefore **serialised on `fold/apply.ts`**, and the parallelism comes
from tasks that do not touch it. What the split did buy is real and is not this:
the helper seams are genuinely separable, `events.ts` is a schema again, and the
next cycle's obvious item is IE-027's move applied to `applyOne` — dispatch by
domain, each partial switch keeping its own `never` default — which is what would
actually make two reducer tasks concurrent.
