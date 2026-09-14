# IE-050 — Dispatch `applyOne` by domain

state: IMPLEMENTING
lane: mechanism
tranche: 7
parallel-safe: NO — it *is* `fold/apply.ts`; nothing that touches the reducer runs beside it
depends-on: none
worker: qb-builder, launched 2026-09-14 from `f00742a` (wave 1)
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: none

## Brief

### Objective

Split `applyOne`'s single 99-case switch into per-domain partial reducers, so
that two tasks changing different reducer cases stop colliding — preserving one
authoritative fold entry and an exhaustiveness guarantee at least as strong as
the `never` default it replaces.

### Why now

**Measured on tranche 6, not assumed.** `fold/apply.ts` is 1,796 lines with 99
cases, and three of tranche 6's twelve merges touched it. More to the point, it
is what forced wave 3's three-way serialisation: IE-040 at the `creature-added`
case, IE-041 at the casting and turn cases, and IE-047-as-briefed at the
`alsoOn` and `withoutTarget` call sites — three tasks in three different domains
that had to run one after another because the one-owner-per-primitive rule names
the module.

IE-039 deliberately left this undone — its brief mandated one switch as the
safer first pass, and the audit offered it as the safer of two options. That was
right then and the debt is now measured.

**This is not aesthetic file splitting.** If the analysis below shows it does not
remove that collision, say so and stop: the owner's instruction is explicit that
a split which merely moves lines is not wanted.

### Current relevant architecture

- `fold/apply.ts` — `applyOne` (one switch, `never` default), `applyEvent`,
  `fold`, `historyOf`, the derived passes, and the module's own helpers.
- `fold/` — `common.ts`, `release.ts`, `areas.ts`, `turns.ts`, `expiry.ts`,
  `endings.ts`, and `index.ts` as the barrel. The graph is acyclic and
  `scripts/fold-graph.ts` checks it against `scripts/fold-layout.json`.
- IE-027's precedent: thirteen per-kind resolvers over one `EffectContext`,
  each destructuring exactly what its rule reads, with a `switch` rather than a
  lookup table **because the `never` binding in its default is the guarantee**.
- `invariants.test.ts` — the emitted-event-type sweep, which reads every runtime
  module and must keep excluding the reducer.

### Required behaviour

1. **One authoritative entry.** `applyEvent` and `fold` are unchanged in
   behaviour and remain the only way a log becomes state. Event ordering,
   derived-pass order and the sorted iteration that keeps folds byte-identical
   are all untouched.
2. Per-domain partial reducers, each in its own module under `fold/`, each
   owning a disjoint set of event types. Domains are chosen from the **measured
   collision**, not from taste — the tranche-6 evidence groups them as casting,
   creatures, combat/turns, effects-and-timers, world/scene, and inventory.
   Name and justify the partition you choose in the digest.
3. **Exhaustiveness must be at least as strong as the `never` default.** A
   partial switch cannot carry one on its own, so the guarantee moves: a derived
   test reads the `GameEvent` union and asserts every declared type is claimed by
   **exactly one** domain — no type unclaimed, no type claimed twice. Drive it
   over a synthetic type it must catch in each direction.
4. **An unhandled event stays loud.** Whatever a domain returns for "not mine",
   the top-level must throw or fail compilation for a type nothing claims —
   never silently return the state unchanged, which is how a dropped event
   becomes a wrong number with no symptom.
5. **Domain reducers are not competing authorities.** None may be exported from
   `index.ts` or reachable from `commands/`; the barrel exposes what it exposes
   today and nothing more.
6. Every moved case body is **byte-identical** to its source after a short,
   declared list of mechanical transformations — the IE-027 and IE-039 oracle.
   The digest names the list.
7. `scripts/fold-layout.json` is updated and `fold-graph.ts` reports acyclic.
   **Additionally, wire that script into the gauntlet or the suite** — it is
   currently in neither, so its drift detection only runs when somebody
   remembers, which is the hand-kept-list failure this repository keeps
   recording.

### Architecture constraints

Settled; a deviation is `ARCHITECTURE_BLOCKED`:

- one authoritative `applyEvent`/`fold`; no second path from a log to state;
- exhaustive, disjoint domain ownership, asserted by a derived test;
- byte-identity of moved bodies is the oracle, not "the suite passed";
- no behaviour change of any kind, including event order and refusal codes.

### Acceptance criteria

1. Both frozen logs fold to byte-identical state; `scenario.test.ts`'s re-run
   determinism holds. Run both explicitly and say so.
2. The exhaustiveness test exists, is derived from the union, and fails in
   **both** directions over synthetic input — a type claimed by nobody, and a
   type claimed twice.
3. A type that no domain handles does not fold silently: demonstrate it.
4. `npm run typecheck`, `npm run lint`, the full suite, `COVERAGE.md`
   byte-clean, `fold-graph.ts` acyclic **and now run by the suite or the
   gauntlet**.
5. **The contention claim is checked rather than asserted.** In the digest,
   take tranche 6's three colliding tasks — IE-040 (`creature-added`), IE-041
   (casting and turn cases), IE-047-as-briefed (`alsoOn` / `withoutTarget` call
   sites) — and state which domain module each would now touch. If two of the
   three still land in one module, the split has not done its job and that is
   the finding.
6. The digest records the domain map, because later tasks are briefed against
   it.

### Tests and conformance

No new behavioural tests. The frozen logs, the exhaustiveness sweep and the
byte-identity oracle are the conformance. **`docs/design/event-log.md`** gains a
short paragraph naming the domains, in the shape IE-039 wrote for the seams.
That document — not `CLAUDE.md` — is now authoritative for the reducer and the
fold; `CLAUDE.md` is the constitution and the router, and its router table
points here. Read `docs/design/event-log.md` before touching `fold/`.

### Dependencies

None. It runs in wave 1 and everything touching the reducer waits for it.

### Out of scope

Any change to the `GameEvent` union's members. The command-stamp envelope
(deferred — it is a whole-union edit and would collide with this). Moving the
derived passes out of `fold/apply.ts`.

### Known risks

Low with the oracle; the real risk is the exhaustiveness guarantee being weaker
than the `never` it replaces, which is why criterion 2 demands both directions
over synthetic input. The second risk is partitioning by taste rather than by
the measured collision — criterion 5 is what makes that visible.
