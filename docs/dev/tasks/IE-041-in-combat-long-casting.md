# IE-041 — The in-combat long casting

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `commands/{casting,spell-resolution,turns,scene}.ts`, `fold/casting`, `fold/turns`; not beside IE-038, IE-042, IE-046 or IE-048
depends-on: IE-038, IE-039
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: none

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
