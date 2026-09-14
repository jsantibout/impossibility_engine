# IE-036 — The twelve spells a long casting time alone blocked

state: DONE
lane: content
tranche: 6
parallel-safe: CONDITIONAL — content only; collides with IE-043 on registry lines alone
depends-on: IE-038
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Write the twelve spells whose **only** blocker was a casting time of a minute
or more, now that IE-034 has built it.

### Why now

The derived map names them, and the list is a query rather than a claim:
`consumersOf('a-long-casting-time').unblocks` returns exactly

> alarm, clairvoyance, commune-with-nature, fabricate, find-the-path,
> hallucinatory-terrain, identify, illusory-script, instant-summons,
> legend-lore, magic-mouth, mending

— twelve spells, each of which the engine could cast the moment the casting
time exists. This is the content half of the largest blocker in the book, and
it is the cheapest coverage in the tranche because the mechanism is already
paid for.

### Current relevant architecture

- `packages/engine/scripts/missing-shapes.ts:1175` — `BLOCKED_ON`, where each
  of the twelve currently names `a-long-casting-time`.
- `packages/engine/src/spell-definitions.ts` — the catalogue and the registry.
- `spell-tracking.test.ts` — the adjudication map for a tracked spell, with its
  three values and the marker scan over the spell's **own SRD prose**.
- `COVERAGE.md` — regenerated, never hand-edited.

### Required behaviour

1. Each of the twelve is **read against its own SRD paragraph** and given a
   definition: tracked where what it does is not arithmetic, executed where the
   existing effect kinds fit the whole of it.
2. Every tracked spell carries adjudications for every clause the honesty
   guard's markers catch, and each is `table` or names an **enumerated missing
   shape**. A shape invented in a note is an architecture decision smuggled
   past review.
3. **The ten "Ritual casting option is not modelled" clauses are removed**,
   because IE-034 modelled it. Check each rather than deleting the phrase
   wholesale.
4. The map entries move: a spell that is now defined leaves `BLOCKED_ON` and,
   if it is tracked with clauses, enters `TRACKED_ADJUDICATED`.

### Architecture constraints

- **`unmodelled` means "this belongs to the fiction", never "nobody has built
  it yet".** That line is drawn by `spell-tracking.test.ts` rather than by
  review, and a clause the engine's own resolution path would reach is debt,
  not narration.
- A definition **may not assert a rules fact without quoting the SRD line**.
  Every duration is quoted in the docstring; the oracle checks name, level,
  school, casting time, Concentration, range and duration.
- **Check the registry before adding a spell.** Two parallel sessions once both
  wrote Vitriolic Sphere and only a duplicate-symbol error caught it.
- Do not extend the marker set. It is a stated floor.
- Alarm prints "you can designate creatures to be unaffected by it" — the same
  clause Spirit Guardians carries. If it is expressible, express it; if its
  *trigger* is not, adjudicate that half and say so.

### Acceptance criteria

1. All twelve have definitions; `consumersOf('a-long-casting-time').unblocks`
   no longer names any of them.
2. At least one is driven **past its casting time** end to end — declared, the
   clock advanced, settled — so the twelve are not merely data.
3. Every removed ritual clause is removed because the spell carries the parsed
   Ritual tag and IE-034 now handles it, not because the phrase was found.
4. `spell-tracking.test.ts` and `spell-honesty.test.ts` pass in both
   directions; no shape is left unclaimed and none is invented.
5. `npm run coverage` run and committed; the tracked and executed counts move.

### Tests and conformance

The guards are the conformance. Add a driven case per executed spell; a tracked
spell needs its cost driven — action, slot, Concentration, duration — which is
what tracked *means*.

### Dependencies

**IE-034.** Runs beside **IE-035**; the only shared lines are in the registry,
which is mechanical to resolve.

### Likely file surface

`spell-definitions.ts` (definitions and registry),
`scripts/missing-shapes.ts`, `COVERAGE.md`, test files.

### Out of scope

The other 42 spells a long casting time touches; each is blocked on something
else besides. Any change to the casting machinery — that is IE-034's, and if
one of the twelve needs more, report it rather than widening the mechanism.

### Known risks

Twelve spells is twelve chances to file a real rule as narration. The guard
catches a clause whose words it knows; it reads English and is a floor, not a
proof. Where a clause is genuinely the table's, say **why** the engine's
resolution path never arrives at it.

## Completion digest

## Risk gate

## Architecture decision

## Merge record

## Deferred by the foreman — 2026-09-14

**Not launched, and not withdrawn.** The owner approved this task and it stays
on tranche 5's roster; what the foreman is exercising is the authority to
*defer an approved task that evidence shows is premature*, recorded here and
reported at `TRANCHE_COMPLETE`.

**The evidence is Fable's, from IE-034's YELLOW.** The engine's single
`pendingCasting` slot turns out to be an accident of its first user — a
Counterspell window open for an instant — and Fable's decision replaces it with
a record keyed by casting id, enforcing one open casting per *caster*. That
change is **outside IE-034's approved brief** and is therefore the owner's to
authorise, so it cannot happen in this tranche.

This task writes **twelve ritual and long-casting definitions with their
fixtures**. Fable was explicit about the cost of running it first:

> IE-036 would otherwise stack twelve ritual fixtures on a slot that is about
> to change.

And on sequencing:

> the shape change becomes the task in front of IE-036, not behind it. The one
> thing that may not happen is the guard changing meaning twice.

So the honest order is: the owner authorises the record's shape; that lands;
then these twelve spells are written against the shape they will keep. Writing
them now means writing them twice, and the second writing would be done by
somebody who did not read the twelve SRD paragraphs the first time.

**Nothing about the brief is wrong** — it needs no re-scoping, and its
dependency on IE-034 is satisfied the moment IE-034 merges. It is proposed
first in tranche 6, behind the record change.

## Re-rostered to tranche 6 — 2026-09-14

Carried forward by the foreman when tranche 6 was assembled. The brief is
**unchanged**; three bookkeeping lines are not.

- `depends-on` becomes **IE-038**, not IE-034. IE-034 has merged; what this now
  waits on is the keyed pending-casting record, which is the shape the twelve
  fixtures will be written against and the reason the task was deferred.
- `parallel-safe` names **IE-043** rather than IE-035 — the same registry-line
  collision, with tranche 6's types-side task in the same file.
- The tranche 5 approval lapses with tranche 5, so the file returns to
  `OWNER_APPROVAL_REQUIRED` and is re-approved as part of tranche 6. This is
  bookkeeping, not a reversal: the deferral note below stands, and the owner's
  reason for approving it has not changed.

Two things the brief should be read with, now that IE-044 exists:

- IE-044 re-anchors `BLOCKED_ON` entries to clause phrases from each spell's
  SRD paragraph. It merges first; these twelve then **leave** the map, so they
  need no backfill — but the entries removed are the new shape, not the old.
- Acceptance criterion 2 — one spell driven past its casting time — is the
  fixture that exercises IE-038's settlement by id. Make it a **second creature
  acting during the rite**, which is the behaviour IE-038 corrects and the most
  natural demonstration of the twelve.


## Read this before starting — added by the foreman at launch, 2026-09-14

**IE-044 merged first, and its instrument says something about your twelve.**
`BLOCKED_ON` entries are now clause-anchored — a distinctive phrase from the
spell's own parsed SRD paragraph, matched exactly once — and `COVERAGE.md`
reports two `finishes` numbers rather than one: the spells whose paragraph has
been read sentence by sentence, and the rest.

`a-long-casting-time` reports **finishes (read) 0, finishes (unread) 12**. Your
twelve are the unread ones. That is not a fault in the brief; it is the
instrument saying that nobody has yet checked whether those paragraphs contain a
*second* blocker. Every wrong prediction this map has made — Mind Blank,
Protection from Energy, Enthrall, Magic Weapon, True Strike — was an unread
sentence rather than a wrong entry.

So requirement 1 is the load-bearing one and it has not changed: **read each of
the twelve against its own SRD paragraph.** What this note adds is what to do
with what you find:

- A spell whose whole printed content the engine can now express gets its
  definition and leaves `BLOCKED_ON`, as the brief says.
- **A spell whose paragraph yields another blocker does not get a definition.**
  It gets a clause-anchored entry in IE-044's new shape — `{ clause, why, note }`
  with the phrase quoted from its own paragraph — naming the blocker you found.
  That is a **success of the task**, not a failure of it: it is exactly the
  finding the instrument exists to surface, and it should be prominent in your
  digest with the SRD sentence that forced it.
- Acceptance criterion 1 should be read with that in mind: what must be true is
  that no spell is left claiming `a-long-casting-time` *alone* when its paragraph
  says otherwise. If fewer than twelve get definitions, say which and why, and
  the criterion is met in substance.

Do not widen the task to build whatever the new blocker needs. Record it and
move on — that is the map working.

Two smaller notes:

- The entry type in `scripts/missing-shapes.ts` changed under you. Read it as it
  now stands rather than as the brief describes it.
- `a-long-casting-time`'s description was corrected by IE-034's merge and again
  by IE-038's; its "outside combat only" caveat is IE-041's to remove, not
  yours.

## Completion digest

```
IE-036 — Completion digest
Builder: COMPLETE
Commit: 8d78303 (replayed onto main as fe42caf)   Branch: worktree-agent-a1188d0edebcc7f38
Opus review: PASS — rounds: 3 (PASS, DEFECTS, PASS; the middle round caught a real false claim)
Tests: 8287 / 8287 on the branch; new: 472 lines in long-casting-spells.test.ts (62 cases),
  two pinning cases in the generalised sweeps, one new describe in blocked-on.test.ts.
  On main after the replay: 8314 across 118 files.
Mutations, three by the builder and five independently by the reviewer, all biting:
  (a) castingOf's Ritual sum → the bare constant — which survived the entire suite before this
      task, because all ten tagged catalogue spells print "Action or Ritual" so 0+600 and 600
      are the same number — now reddens 3 tests in 2 files;
  (b) Alarm's castingSeconds 60 → 600 reddens 6 across 3 files including the printed-
      casting-time oracle;
  (c) dropping Hallucinatory Terrain's `check` reddens 2, one in each direction of the tracked
      map's `engine` guard.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — every `unmodelled` clause read against its own SRD paragraph.
Architectural deviations: none
Foundational primitives touched: none in substance — no declaration, type, field or runtime
  line changed anywhere. Two comment-only edits, both correcting claims this task falsified.
New runtime special cases: none
Files outside the brief's surface: commands/spell-resolution.ts (comment only — castingOf's
  docstring said "Exported so a fixture can reach the arithmetic no registered spell does" and
  "a mutation replacing the sum with the constant survives the whole suite", both of which the
  twelve make false); CLAUDE.md; and three guards the brief did not list — long-casting,
  spell-schema and blocked-on tests — which carried IE-034's handover or had to learn that a
  long casting is two events.
Out-of-scope findings: (1) the tracked guard's marker set cannot see "the spell ends" — see
  below. (2) COVERAGE.md's shape buckets are a different vocabulary from missing-shapes.ts —
  **already obsolete**: IE-045 deleted that classifier while this branch was in flight.
  (3) Brief requirement 3 is satisfied vacuously: IE-034 removed all ten "Ritual casting option
  is not modelled" clauses when it made the tag mean something. Verified against main rather
  than by deleting a phrase; the honest answer is zero.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

**Light in mechanism, heavy in content, and inspected accordingly.** No runtime
line changed anywhere — the two edits outside the stated surface are both
comments correcting claims the twelve definitions falsify, which is the same
call IE-043 made about a tested note and the right one.

**The mutation worth recording is (a).** `castingOf`'s Ritual arithmetic —
ten minutes *added to* the spell's own casting time — could not be
distinguished from a bare constant by any test in the suite, because every one
of the ten catalogue spells carrying the Ritual tag prints "Action or Ritual",
so the sum and the constant are both 600. IE-034 knew this and hand-built an
Alarm fixture to reach it. **Alarm is now a real definition**, printing "1
minute or Ritual" and coming to 660, so the rule is pinned by the catalogue
rather than by a fixture standing in for it. That is a guard graduating from
synthetic to real.

**All twelve were defined**, which is worth stating against my own prediction:
when IE-044's instrument reported these twelve as *unread*, I told the owner
the task might return ten or eleven definitions and a finding or two. It
returned twelve — as **tracked** spells, which is the brief's own disposition
for a spell whose content is not arithmetic. Tracked 45 → 57; executed
unchanged at 97; `a-long-casting-time` 54 blocks / 12 finishes → **42 blocks /
0 finishes**.

**But the concern was not misplaced, and it landed somewhere the instrument
cannot reach.** Two of the twelve — Instant Summons and Magic Mouth — print a
dismissal clause that is **engine debt** rather than fiction: it is
`a-casting-dismissed-early`, the shape IE-048 builds. Neither could be filed in
`TRACKED_ADJUDICATED`, because an entry there must name a marker its own
sentence trips and **no `MECHANICAL_MARKER` fires on the phrase "the spell
ends"**. The brief forbids extending the marker set and calls it a stated
floor, so the builder reported rather than extended, and both spells say so in
`unmodelled`. That is the right behaviour and it is also a real hole: an
instrument that reads English has a blind spot, and this is one of its edges
found by use rather than by argument.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement.

## Merge record

Replayed onto `main` as `fe42caf`. The branch was cut before IE-045 and IE-039
merged; `COVERAGE.md` was the only conflict, regenerated as
`.gitattributes` requires, and every other file auto-merged.

`main` verified **after** the merge: typecheck ✓, lint ✓, **8,314 tests across
118 files** ✓, both frozen logs and the scenario determinism explicitly ✓ (53
tests), `COVERAGE.md` regenerated and byte-clean ✓, tree clean.
Top line: `339 | 57 tracked | 97 executed | 48 partial | 75 verified`.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence, the middle of three rounds having caught a real false claim;
**4** defects resolved; **5** gauntlet green; **6** conformance green, every
clause read against its own paragraph; **7** no blocker; **8** no deviation;
**9** no primitive touched in substance; **10** files outside the surface are
comments and three guards that had to learn a long casting is two events;
**11** integration valid, one expected conflict; **12** re-verified on `main`;
**13** risk gate inspected, GREEN.

**Nothing was waiting on this task**, and nothing can launch behind it: every
remaining task in the tranche is gated on `fold/apply.ts` or on
`commands/spell-resolution.ts`, both of which IE-041 owns while it runs.
