# IE-041 — The in-combat long casting

state: DONE
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `commands/{casting,spell-resolution,turns,scene}.ts`, `fold/casting`, `fold/turns`; not beside IE-038, IE-042, IE-046 or IE-048
depends-on: IE-038, IE-039
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Finish IE-034's other half: a casting of a minute or more, **in combat**, as a
per-turn Magic-action obligation on the keyed pending record.

### Why now

It is the second half of the largest blocker in the book — `a-long-casting-time`
blocks 54 spells — and it discharges a recorded wedge: a rite declared before a
fight and still open when one starts leaves `resolveTurn` refusing and the
settlement refusing until a clock that only turns can advance. It builds
directly on IE-038's record and is the reason that record is keyed.

### Current relevant architecture

- `commands/casting.ts:482` — the in-combat refusal, whose reason already names
  what is missing: SRD requires the caster to take the Magic action on each
  turn of the casting, "and that per-turn obligation is not modelled".
- `PendingCasting.completesAt` — pinned at declaration; `isDue` is the reading
  (IE-034 decided this deliberately against `hasExpired`).
- `commands/turns.ts` — `resolveTurn`, and the turn-boundary pipeline:
  `raiseTurnEnd`, `pendingTurnStart`, `reachStartOfTurn`.
- `releaseCasting` — the single door every Concentration exit already routes
  through, and the door a failed rite leaves by.

### Required behaviour

1. `continueCasting(state, caster, castingId, …)` — a barrel command spending
   the **Magic action** on the caster's own turn against a named pending
   casting. Guarded by `mayAct` like every other spender, through `once`.
2. **The declaring turn's action is that turn's Magic action.** A caster who
   declares on their turn does not also owe a `continueCasting` that turn.
3. At the caster's **turn end**, a pending casting with `completesAt` whose
   turn saw no `continueCasting` **fails, derived** — through `releaseCasting`,
   no event, the slot never spent, exactly as a lost Concentration does. SRD:
   "If your Concentration is broken, the spell fails, but you don't expend a
   spell slot."
4. Settlement is permitted once the clock reaches `completesAt` — `isDue`,
   unchanged. In combat the clock is derived from turns wrapping, which is what
   this unblocks.
5. `resolveTurn` stops refusing for a casting that has a turn to be pending
   across: a pending casting **with `completesAt` set** no longer blocks the
   turn. An instant Counterspell window (no `completesAt`) still does — and
   with IE-038's record that is per casting rather than per record count, so a
   rite pending beside an unsettled window still blocks on the window alone.
6. **The in-combat half of IE-038's invariant test.** A wizard mid-rite, on
   another creature's turn, casts Shield as a Reaction held open: two pending
   castings for one caster, the rite's Concentration untouched, the rite's
   per-turn obligation unaffected because it is not the wizard's turn, and no
   slot conflict because "on a turn you can expend only one spell slot" and the
   rite expends none. IE-038 pins this outside combat; this is where it becomes
   the sequence the owner named.
7. `beginCombat` with an open rite simply enters the obligation — no special
   case, no wedge. The recorded wedge and the in-combat
   `unsupported_casting_time` refusal both fall.

### Architecture constraints

Settled; a deviation is `ARCHITECTURE_BLOCKED`:

- the failure is **derived**, with no event, through `releaseCasting`;
- the slot is never expended by a failed rite;
- `isDue` is the reading of `completesAt`, not `hasExpired`.

**One bounded question, with its answer pre-stated:** where the derived failure
sits in the turn-boundary ordering relative to `raiseTurnEnd` and
`pendingTurnStart`. Decide it as **before the end-of-turn area debts are
raised**, and escalate to Fable (YELLOW) only if a fixture shows a save owed to
a spell the same boundary failed.

### Acceptance criteria

1. A wizard declares a ten-minute rite in combat, takes the Magic action each
   turn, and the casting settles when the derived clock reaches `completesAt`.
2. A wizard who skips one turn's Magic action loses the rite at that turn's
   end: no event records the failure, the slot is unspent, the Concentration is
   gone, and the pending record is gone.
3. Another creature acts, casts and takes its turn throughout, with nothing
   refused — the behaviour IE-038 made possible, asserted here in combat.
4. A rite open when `beginCombat` fires continues into the obligation, and the
   fight advances. The recorded wedge has a test that would have caught it.
5. `resolveTurn` still refuses for an instant window (Counterspell held open),
   and that test is kept, not inverted.
6. Both frozen logs fold unchanged; `scenario.test.ts` determinism holds.
7. `commands/casting.ts:482`'s refusal is deleted, and
   `refusal-sweep.test.ts` stays green in both directions (a code that no
   longer exists must leave the assertion set with it).

### Tests and conformance

The gauntlet plus both frozen logs explicitly. `missing-shapes.ts`:
`a-long-casting-time`'s description loses the "outside combat only" caveat —
re-read entry by entry, not find-and-replaced. CLAUDE.md: "A Casting Of A
Minute Or More Runs On The Clock" loses its deferred half and its wedge
paragraph.

### Dependencies

IE-038 (the keyed record; a per-casting obligation on a global slot is the
thing this must not build). IE-039 (fold modules).

### Out of scope

The SRD-literal alternative where a second Magic action *fails* the rite rather
than being refused — that policy stays as-is. Ritual casting in combat beyond
what the same rules give it. IE-036's twelve definitions.

### Known risks

Medium: it is a new derived failure inside the turn-boundary pipeline, which
is the most order-sensitive code in the fold. The pre-stated ordering answer
and the frozen logs are the guard; a fixture that owes an area save on the same
boundary is the case to write deliberately rather than hope for.

## Completion digest

```
IE-041 — Completion digest
Builder: COMPLETE
Commit: 8510cea (replayed onto main as c8b6ae1)   Branch: worktree-agent-af2e97deeb699f641
Opus review: PASS — rounds: 1, confidence high, no defects
Tests: 7959 / 7959 on the branch (baseline 7936); new: 23. On main after the replay: 8354
  across 118 files.
Mutations, four biting:
  (a) neutralising failUnsustainedCastings so it never releases — 4 fail;
  (b) dropping sustainedOnTurn from spell-declared — 12 fail across 2 files, including the
      idempotency sweep's own continueCasting case;
  (c) making resolveTurn's filter match every pending casting — 16 fail across 3 files;
  (d) removing the combat-ended forgetting — the aliasing case alone fails.
  A fifth — moving failUnsustainedCastings to AFTER raiseTurnEnd — **survives the whole
  suite**, and is recorded in the function's own docstring rather than dressed up as tested:
  a casting that has taken no effect owns no area, timer or condition, so it can owe nothing
  and be owed nothing.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓; fold-graph.ts reports ACYCLIC with the
  new fold/turns.ts → fold/release.ts edge, and fold-layout.json carries both new declarations.
Conformance: PASS — both frozen logs fold unchanged and are untouched on disk, run explicitly;
  scenario.test.ts determinism explicit and green; missing-shapes.ts's a-long-casting-time
  description re-read and rewritten, its CLAUDE.md citation resolving against a sentence that
  now exists.
Architectural deviations: none. The failure is derived with no event, through releaseCasting,
  slot never spent; isDue untouched; the pre-stated ordering answer taken as given and no
  escalation trigger fired.
Foundational primitives touched: events.ts (new casting-continued member); state.ts
  (PendingCasting.sustainedOnTurn); fold/apply.ts (the new case, turn-advanced and
  combat-ended wiring); fold/turns.ts (failUnsustainedCastings, forgetSustainedTurns);
  commands/casting.ts; commands/turns.ts; the barrel.
New runtime special cases: none. Two new refusal codes, both asserted: not_a_long_casting and
  duration_not_a_span.
Files outside the brief's surface: events.ts and state.ts (the new event member and record
  field, which IE-039 moved out of the file the brief named); fold/apply.ts and fold/turns.ts
  (the brief named fold/casting, which does not exist — the launch message gave the real
  layout); fold-layout.json; and four derived sweeps plus one inverted refusal test that a new
  command, a new event type and a deleted refusal all force.
Out-of-scope findings: none.
Unresolved concerns: two, both prose, both judged by the reviewer as not worth a return round.
  (1) no_casting_pending's reason string is now spelled identically in commands/casting.ts and
  commands/spell-resolution.ts. (2) duration_not_a_span's reason reads awkwardly. The reviewed
  commit was left unchanged rather than spending a round on prose the reviewer passed.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

**Inspected, and the deepest inspection of the tranche after IE-038.** A new
event type, a new field on a persisted record, two new declarations in the fold,
and changes to the most order-sensitive code in the engine.

**I read the derived failure myself.** `failUnsustainedCastings` filters to
`completesAt !== undefined` — so an instant Counterspell window is owed nothing
on a turn — then to *this caster*, then skips any casting sustained on this turn,
and releases through `releaseCasting`. One door, no event, exactly as a lost
Concentration. **And I read `resolveTurn`'s new filter**, which is
`completesAt === undefined`: a rite no longer blocks the turn and an unsettled
instant window still does. Both are what the brief required, and the reason
string names the window rather than the rite.

**The pre-stated ordering answer held, and the honest finding is that the
ordering is not observable.** The brief named one bounded question — where the
derived failure sits relative to `raiseTurnEnd` — decided it in advance, and said
to escalate only if a fixture showed a save owed to a spell the same boundary
failed. The builder took the pre-stated answer, then *measured* it: moving the
pass after `raiseTurnEnd` **survives the whole suite**, because a casting that
has taken no effect owns no area, timer or condition, so it can owe nothing and
be owed nothing. That is recorded in the function's own docstring rather than
presented as tested, and a deliberate Grease fixture shows the save owed at such
a boundary belongs to a *different* casting — which it must. No escalation, and
the right kind of honesty about what a passing suite does and does not prove.

**The declared addition is a necessary consequence, not a widening.** Deleting
the in-combat refusal opened a hole the refusal had been hiding: while a long
casting was refused in combat, a **turn-anchored** `Duration` could never reach
the declaration's deadline branch, because `resolveDuration` refuses one
*outside* a fight. In combat it resolves perfectly well — and the branch would
then pin it at the declaration, giving a spell whose Duration ends at the
caster's next turn a deadline scheduled a minute before the spell exists. That is
precisely the bug `PendingCasting.lastsSeconds` was built against, recorded in
CLAUDE.md in those words. `duration_not_a_span` refuses it before the slot, the
action and the first die, so a span remains the only kind that can reach the
settlement and *settlement still cannot fail*. It changes no previously reachable
behaviour, it is asserted by its own test, and the reviewer reached the same
judgement independently. **You cannot delete a refusal without owning what it was
hiding**, and finding that is the task rather than an excursion from it.

Classification: **GREEN**.

## Architecture decision

None. The one bounded question the brief named was answered in advance and its
escalation trigger did not fire. No Fable involvement.

## Merge record

Replayed onto `main` as `c8b6ae1`. **Two genuine semantic conflicts**, both
resolved by me at integration and neither a matter of taking one side:

- `missing-shapes.ts`'s `a-long-casting-time` description had been rewritten by
  **both** IE-036 and IE-041, and neither text is true after both merges. IE-036's
  said the in-combat half was what remained of the shape; IE-041's said the
  twelve definitions were still to come. The merged description carries both
  facts — the mechanism is whole, *and* the twelve are written, so the shape
  blocks forty-two spells that name it and something else, finishing none. I took
  IE-041's **citation** deliberately: it quotes a CLAUDE.md sentence that now
  exists, where IE-036's quoted one this commit deletes, and the citation guard
  is what would have caught the wrong choice.
- CLAUDE.md's Known Pending Work bullet, the same collision in prose: the
  "outside combat" qualifier goes (IE-041 is right) and the twelve-spells clause
  stays (IE-036 is right).

`main` verified **after** the merge: typecheck ✓, lint ✓, **8,354 tests across
118 files** ✓, both frozen logs, the scenario determinism, the keyed-pending
suite and the long-casting suite run explicitly ✓ (127 tests), `COVERAGE.md`
regenerated and byte-clean ✓, `fold-graph.ts` **ACYCLIC** ✓, tree clean. The
citation guard passing is what says my merged descriptions quote sentences that
exist.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence in one round; **4** no defects; **5** gauntlet green; **6**
conformance green; **7** no blocker; **8** no deviation — the duration guard is a
declared consequence and I agree with the framing; **9** the primitives are the
brief's, under their real names after IE-039; **10** files outside the surface
are the fold modules the brief misnamed and four derived sweeps a new command and
event force; **11** integration valid, two semantic conflicts resolved above;
**12** re-verified on `main`; **13** risk gate inspected, GREEN.

**What it discharges.** The recorded wedge — a rite open when a fight starts —
is driven end to end and no longer wedges. The in-combat `unsupported_casting_time`
refusal is deleted. **The owner's own proof sequence is now a test**: a wizard
mid-rite, on another creature's turn, casting Shield as a held Reaction, two
pending castings for one caster, the rite's Concentration and its obligation
untouched.
