# IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts

state: DONE
lane: mechanism
tranche: 3
parallel-safe: NO beside IE-001 — both are in `commands/spell-resolution.ts` and the fold; YES beside IE-008 (`creation.ts`) and IE-009 (tests and prose)
depends-on: IE-005, IE-001
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 3"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 3" (tranche 3 authority; 13/13 conditions green)

## Re-brief note (2026-09-13, after tranche 2)

Re-checked against `main` at `ceb11e6`. Every claim below still holds:
`events.ts` still imports `definitionFor` (`:103`) and still calls it through
`areaDefinitionOf` at **five** sites (`:2479`, `:2635`, `:2768`, `:2852`,
`:2936`), so the fold still consults the live catalogue; `route` is still
written by `commands/casting.ts` at `:530`, `:553` and `:596` and still read
by nobody on the record.

**Two things changed that the brief must now carry.**

- **The `resolveCast` `mayAct` guard rides here, not with IE-001.** The
  queue has said since IE-003 that it rides with "the next mechanism task in
  the command layer", and named IE-001. The split settles it differently:
  `resolveCast` is `commands/casting.ts:1051`, which IE-001 does not touch
  and this task does. It is one guard plus the allowlist entry in
  `invariants.test.ts:1249`, whose text already calls itself "**a named debt
  rather than a settled exemption**".
- **There is now a second frozen log**, and it is the one with teeth here:
  `golden-log-2.json` carries five ongoing castings, two origins and eight
  timers. Item 2's event-shape change is exactly what it exists to catch.

## Brief

### Objective

Make the fold independent of the spell catalogue by pinning a casting's
`area` and `areaTrigger` on `OngoingSpell` at the cast, exactly as its
numbers already are; derive or drop the record's two dead fields; and close
the four documented ongoing-record debts.

### Why now

`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.2: `events.ts`
calls `definitionFor` at five sites to learn an area and its clauses, so a
replay consults the current catalogue and a transcription fix rewrites
history — the hazard the event-log section of `CLAUDE.md` names. §3.6 and
§3.10: `OngoingSpell.concentration` and `.route` have no reader; `on` does
not shrink on expiry; "until dispelled" spells leave no record; a
`spell-ongoing` for an ended casting is accepted.

### Required behaviour

1. `OngoingSpell` carries `area` and `areaTrigger` (as cast); the reducer's
   `areaDefinitionOf` reads the record; `events.ts` no longer imports
   `definitionFor`. A test folds a log with a definition deliberately changed
   after the cast and asserts the fold is unchanged.
2. `concentration` derived (whoever holds the casting) and removed from the
   record; `route` removed; the event shape versioned so the frozen fixtures
   still fold (absent means what it always meant).
3. `expireEffects` shrinks `on` when an independently timed condition of a
   casting lapses on a creature (through `withoutTarget`).
4. `persists()` records "until dispelled" spells (no duration, no
   Concentration) as ongoing without a timer, so Dispel Magic reaches them;
   Arcane Lock and Continual Flame are the proving spells.
5. The reducer refuses (corrupt log) a `spell-ongoing` for a casting that
   has ended — which needs the fold to remember ended castings, or the id
   check to consult the log; the builder proposes the smaller of the two.
6. `PendingMove.feet` and `OwedAreaEffect.turn` dropped, or given a reader
   with a reason.
7. **`resolveCast` is guarded by `mayAct`**, and its entry in
   `UNGUARDED_ON_PURPOSE` (`invariants.test.ts:1249`) is removed rather than
   reworded — the sweep asserts the allowlist in both directions, so a stale
   exemption fails it. The refusal must come **after** the duplicate check,
   which this file records eight prior instances of getting wrong, and
   `once` now makes structurally hard: put the guard inside the callback.

### Architecture constraints

- Pinned at the cast, read live for the target — the rule the pinned numbers
  set.
- No new second identity for a casting's area; it is a field on the record.
- Both frozen fixtures fold unchanged.

### Acceptance criteria

1. `events.ts` has no value import of the spell catalogue; the fold of a
   fixture is unchanged when a definition is edited under it.
2. Each of items 3, 4 and 5 has a failing test first.
3. The whole gauntlet passes; both fixtures fold.

### Dependencies

IE-005 (`4f829e9`, merged — it lands in the split layout). **Sequential
after IE-001**, which shares `commands/spell-resolution.ts` and the
`SpellEffect` union; this task rebases over it.

### Likely file surface

`spells.ts`, `events.ts`, the spell-resolution module, `spell-definitions.ts`
(the two definitions' notes), `ongoing-spells.test.ts`, `persistence.test.ts`,
`CLAUDE.md` ("A Casting Is History; What It Left Behind Is State").

### Out of scope

The equipment catalogue read in the fold (named, lower risk); the `cause`
link on events; multiple scenes.

### Known risks

- Event-shape compatibility: the frozen fixtures decide it.


## Completion digest

```
IE-007 — Completion digest
Approved architectural intent: Make the fold independent of the spell catalogue by pinning a casting's `area` and `areaTrigger` on `OngoingSpell` at the cast, exactly as its numbers already are; derive or drop the record's two dead fields; and close the four documented ongoing-record debts.
Builder: COMPLETE
Worktree: .claude/worktrees/agent-a595388509ad143a3   Branch: worktree-agent-a595388509ad143a3   Commit: 45f9596 (rebased by the foreman to b80e0d5)   Rebased on main at: not rebased by the builder, per the tranche-3 launch instruction; built on 7592efe
Opus review: 3 builder-launched rounds, then a foreman-authorised bounded fourth pass — PASS at the fourth
Tests: 5578 passing / 5578 total; new tests: 20; mutation run: eight, each failing the test that should catch it — the `mayAct` guard hoisted above `once` (the retry is told `area_effect_owed` instead of `ok`); `upgradeOngoing` returning the record unchanged (golden-log-2 throws `cannot apply area-effect-settled: cast:11 owes thug nothing at entry`); `area`/`areaTrigger` not pinned at the cast (75 area tests); the `on` shrink removed; the same shrink with the `holdsNothingOf` check removed (the foe is dropped while still Paralyzed); `untilDispelled` dropped from `persists` (5 tests); the ended-casting refusal deleted (2 tests); Continual Flame untagged (the oracle catches it); and `pendingMove: event.move` stored verbatim (the legacy-shape fold test).
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — `COVERAGE.md` regenerated byte-identical; both frozen fixtures fold untouched; the oracle now holds `untilDispelled` against the printed duration in both directions.
Architectural deviations: none, but two readings the foreman should see — (1) acceptance criterion 1's second clause holds for a **versioned** log only, because a pre-versioned record was never written with the fact and `upgradeOngoing` must fill it from the book; (2) `events.ts` has no *value* import of the catalogue, and the fold still reaches it transitively, once, for a pre-versioned record, through a module named for that job.
Foundational primitives touched: `GameState` (new `castingsEnded`); the `events.ts` reducer (`spell-ongoing` corrupt-log branch, `movement-declared`, `releaseCasting`, `expireEffects`, five `areaDefinitionOf` sites); `OngoingSpell`, `OwedAreaEffect`, `PendingMove`; the `spell-ongoing` and `movement-declared` event payloads; the types at the top of `spell-definitions.ts` (`untilDispelled`) and `persists()`; `spell-schema.ts`; `commands/casting.ts` (`resolveCast`), `commands/attacks.ts`, `commands/movement.ts`, `commands/spell-resolution.ts`. Every one named or entailed by the brief.
New runtime special cases: none keyed on a spell, feature, creature or item. `upgradeOngoing` branches on a record **version**, not on content.
Files outside the brief's surface: `ongoing-compatibility.ts` — new, and the only way to satisfy acceptance criterion 1 while both fixtures fold; `commands/casting.ts` and `commands/attacks.ts` — item 7's guard, and the reroute of `castOnHit` to `resolveCastWith` so the held-attack settlement keeps its exemption; `commands/movement.ts` — item 6; `invariants.test.ts` — named by item 7; `spell-schema.ts` and `spell-oracle.test.ts` — the direct consequence of adding a definition field; five area/AC test files — assertions the dropped `turn` and the new tombstone forced.
Out-of-scope findings (not acted on): (1) **`alsoOn` cannot grow `on` at the cast**, because `spell-ongoing` is pushed at the end of `resolveEffects` and every `condition-applied` in the batch folds before it — so Sunbeam blinds a creature, is not recorded as being on them, and a Dispel Magic aimed at that creature finds nothing. Pre-existing; `CLAUDE.md`'s "now applied at the cast as well" overstates it for this case. (2) **Settlement is still catalogue-driven**: `settleAreaEffects` resolves the trigger's `effects` through `definitionFor`, so the pinned `areaTrigger.effects`/`label` have no reader. Stated in `spells.ts` and `CLAUDE.md` rather than fixed — it is a second change with its own compatibility question, because a pre-versioned record has no effects to restore. (3) `castingsEnded` grows one entry per ended casting, like `appliedCommands`.
Unresolved concerns: none after the bounded pass.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

The fourth-pass verdict is `PASS`, confidence high, no defects. It is quoted
in full on the risk gate below where it settles something, because two of its
rulings are worth more than the task.

## Risk gate

The tranche's largest and riskiest task: a persisted record's shape changed
while two frozen logs had to keep folding, `GameState` gained a field, the
reducer changed at nine sites, and an eight-times-recorded ordering trap was
in the brief. Three review rounds ended `DEFECTS`, the trajectory qualified
under the corrected round-exhaustion rule — **two documentation defects per
round, never the same one twice** — and a bounded fourth pass was authorised
and returned `PASS`.

**The reviewer settled the thing the foreman was uneasy about, with a
distinction neither the builder nor the foreman had drawn.** The commit
*deletes* `route` and `concentration` for being stored with no reader and
*adds* `areaTrigger.effects` and `.label`, which are also stored with no
reader. That looked like the same failure arriving in the same breath. It is
not:

| | Duplicates | Can disagree with what is read |
|---|---|---|
| `route`, `concentration` | **live state** — `creature.concentration.castingId`, and what `numbers` had already resolved | **yes, today** |
| `effects`, `label` | **the catalogue** — the thing this task decouples from | **no** — settlement ignores them for a version-2 record, and `upgradeOngoing` fills them from the same catalogue settlement then reads |

And the rejected alternative is real: storing only the four read fields would
make the record carry a `Pick<AreaTrigger, …>` that is not an `AreaTrigger`,
so the follow-up would need a *second* event-shape change and a second version
bump. Storing the clause whole makes the follow-up a read-site change with no
compatibility question of its own. Documented in three places that agree —
the docstring, the test comment, and `CLAUDE.md` — which is the standard this
repository applies to an `unmodelled` note.

**Both declared readings are ruled, and reading two is the sharper result.**

*Criterion 1's second clause holds for a versioned log only*, and that is the
only honest reading. The alternatives are each worse in a way the doctrine
names: treating an absent `version` as "no area" would silently stop
`golden-log-2.json`'s Web and Moonbeam raising debts — a rule switching itself
off, which is exactly what that fixture exists to catch — and migrating or
regenerating the fixture is the rubber stamp `CONTRIBUTING.md` forbids. The
fact was never written in those logs, so the catalogue is the only place it
can come from. Two things make it safe rather than merely unavoidable: the
exposure is bounded to two frozen files written before the field existed, and
it is now **asserted** — `persistence-2.test.ts:222` pins Web's Cube at 20 off
the upgraded record, so a transcription fix that would move that fold fails
loudly. Every log written from now on is immune, which is the property the
criterion protects.

*Reading two is the brief's own consequence rather than a departure from it*,
and the reviewer's reasoning is the part to keep: item 1 requires the fixtures
unchanged, item 2 requires the event shape versioned with "absent means what
it always meant" — **those two together entail exactly one catalogue lookup
somewhere on the fold's path for a pre-versioned record.** No implementation
satisfies both without it. The residual was verified to be genuinely one:
`upgradeOngoing` is called at the single `spell-ongoing` reducer case, and the
three other writes to `state.ongoing` spread an already-upgraded record. The
letter holds too — the brief said no *value* import, and the import is
`import type`.

**The guard the brief was most worried about is pinned in both directions.**
`resolveCast` now asks `mayAct` from **inside** the `once` callback, its
`UNGUARDED_ON_PURPOSE` entry is deleted rather than reworded, and the derived
sweep asserts the allowlist both ways so a stale exemption fails. The mutation
that hoists the guard above `once` makes a retry report `area_effect_owed`
instead of `ok` — the ninth instance of that trap in this repository, and the
first caught by a test written before it could happen.

GREEN. Merging under tranche 3 authority.

## Merge record

Merged to `main` as `b80e0d5`, fast-forward, pushed. Worktree retired and
branch deleted. Rebased twice by the foreman, both clean, the second crossing
IE-001's and IE-009's `CLAUDE.md` edits — the reviewer confirmed neither
predecessor's prose was lost, IE-009's deliberately count-free amendment and
its seventeen-types paragraph included.

The thirteen conditions, asserted by name:

1. **Inside the brief** — yes; every file outside the named surface is
   entailed by a required behaviour, and the reviewer checked each entailment
   rather than accepting the list.
2. **Builder COMPLETE** — yes.
3. **Independent reviewer PASS, confidence high** — yes, at the bounded fourth
   pass, after three rounds of `DEFECTS`.
4. **Defects resolved** — yes; the two round-three fixes were the bounded
   pass's whole scope and it verified both against their call sites.
5. **Gauntlet in the worktree** — typecheck ✓ lint ✓ test 5578/5578 ✓
   coverage ✓ `git diff --exit-code COVERAGE.md` ✓. The reviewer reconciled
   the 20-test delta exactly rather than accepting the number.
6. **Conformance** — `COVERAGE.md` byte-identical; the oracle now holds
   `untilDispelled` against the parsed book in both directions, and the schema
   refuses a definition carrying both "until dispelled" and a deadline.
7. **No unresolved architecture blocker** — none. The persistence-compatibility
   question the brief flagged as a possible Fable escalation was answered
   inside the architecture rather than against it.
8. **No material deviation** — none declared; two readings, both ruled above.
9. **No unexpected authority-boundary or foundational-state change** — the
   changes to `GameState`, the reducer and two event payloads are the brief's
   own items 1, 2, 5 and 6. Versioned, with a single upgrade entry point.
10. **No meaningful scope expansion** — none; `SpellDefinition.untilDispelled`
    is entailed by item 4, since `persists()` cannot tell "Until dispelled"
    from Instantaneous without it.
11. **No non-mechanical merge conflict** — none across two rebases.
12. **Integration did not invalidate the review** — full gauntlet re-run on
    `main` after the fast-forward: typecheck ✓ lint ✓ test 5578/5578 ✓
    coverage byte-clean ✓, both frozen fixtures untouched.
13. **Risk gate** — GREEN, above.

Verified on `main` at `b80e0d5` and pushed to `origin/main`.
