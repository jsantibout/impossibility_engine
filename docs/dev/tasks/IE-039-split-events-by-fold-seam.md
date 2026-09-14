# IE-039 — Split `events.ts` along the fold's own seams

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 6
parallel-safe: NO — it *is* `events.ts`; nothing that touches the fold runs beside it
depends-on: IE-038
worker: none
approved: none
merge-approved: none

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
