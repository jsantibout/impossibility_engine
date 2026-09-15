# IE-050 — Dispatch `applyOne` by domain

state: DONE
lane: mechanism
tranche: 7
parallel-safe: NO — it *is* `fold/apply.ts`; nothing that touches the reducer runs beside it
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 7."

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

## Completion digest

**Merged `26a47d7`**, 13/13 auto-merge conditions, reviewer PASS at high
confidence on the first round. `main` green at **8,511 tests across 124 files**.

### The declared deviation: thirteen domains, not six — accepted

The brief named six candidate domains and said *"name and justify the partition
you choose"*. The builder used **thirteen**, under one rule applied uniformly:
**a seam owns a region of `GameState`**.

**Criterion 5 is what forced the granularity, not taste.** Under the brief's own
six-way grouping, **two of the three tranche-6 colliders still collide** —
`creature-added` beside `condition-applied` in "creatures", and
`casting-continued` beside `spell-ongoing` in "casting". The six would have
*failed* criterion 5, which says in as many words that two of three landing
together is the finding. Refining `creatures`→`roster`/`vitals` and
`casting`→`casting`/`ongoing` is the minimum that separates them, and both are
cuts the layer above already makes (`commands/casting.ts` vs
`commands/ongoing.ts`). Applying the rule everywhere rather than only where the
measurement bit is what keeps it a rule.

**The foreman accepts it as GREEN**: it is inside the brief's explicit
delegation, it invents no architecture, and it is the reason the acceptance
criterion passes rather than an evasion of it.

### Criterion 5, re-verified by the foreman against the code

| Tranche-6 collider | Now lands in |
|---|---|
| IE-040 (`creature-added`) | `fold/roster.ts` |
| IE-041 (casting and turn cases) | `fold/casting.ts`, `fold/combat.ts` |
| IE-047-as-briefed (`alsoOn` / `withoutTarget`) | `fold/ongoing.ts`, `fold/vitals.ts` |

**No two of the three share a module.** The split did its job.

**The caveat the builder recorded rather than glossed:** IE-047-as-briefed also
*reads* the `withoutTarget` call site in `roster.ts`, which IE-040 changes.
`withoutTarget` is **kept** by IE-047's own final specification, so it changes
nothing there and the three remain concurrent — but had the design deleted it,
that pair would have queued behind each other again, in the one module a
creature entering and a creature leaving both have to be in.

### The partition, verified mechanically in the main checkout

- **95 event `type:` literals declared in `events.ts`; 95 claimed by a seam;
  0 claimed by more than one; 0 claimed by nobody.** Exactly exhaustive and
  exactly disjoint, checked against the union itself rather than against the
  digest.
- **Of 1,545 non-blank lines below the import blocks in the thirteen seams,
  1,257 are lines identical to lines in `main`'s `apply.ts`** — and every one of
  the remaining 288 is scaffolding: the thirteen `X_EVENTS` declarations with
  their type lists, `export type XEvent = Extract<…>`, `isXEvent = seamOf(…)`,
  `switch (event.type) {`, `return unhandledEvent(event);`, 99 new doc comments,
  14 signatures and 4 braces. **No moved logic line is unaccounted for.**
- The seam list is declared **once** per seam; the type is `Extract`ed from that
  array and the guard is built from the same array, so the list, the type and
  the runtime guard cannot drift apart.

**The brief said "99 cases"; the union has 95 members.** `apply.ts` held two
switches and the count was of `case` lines in the file. The same stale-count
class as IE-051's "thirteen resolvers" — neither is a scope change.

### Exhaustiveness is strictly stronger than the `never` it replaced

Per-seam `never`, a dispatch-level `unhandledEvent(event: never)` that only
narrows when the thirteen cover the union, **and** a derived exactly-one test
for the double-claim the compiler cannot see. An unclaimed type throws
`CorruptLogError` with the identical message; it never returns state unchanged.
Four mutations, each failing for the right reason: returning `next` for an
unclaimed type (2 red), a type claimed by a second seam (compile error, then 1
red with **the whole rest of the suite green**, which is the claim the new test
exists to make), a type removed from a seam list (compile error at the `never`),
and a neutralised `healed` case (12 red across 7 files).

### Reported, and one of them is a real catch

1. **`invariants.test.ts`'s "the fold holds the reducer's case labels" assertion
   had become satisfiable by `interruptedRests`** — a derived pass that branches
   on three types and is not the switch the exclusion is about. Re-pointed at
   `fold/casting.ts` rather than left vacuous. **The foreman hit this exact
   ambiguity independently** while verifying byte-identity: a naive search for
   `case 'spell-cast':` in `apply.ts` finds the derived pass first. The builder
   was right to fix it.
2. The `speedOf` import docstring said `standing.ts` "imports `GameState` from
   here", untrue since IE-039; corrected to `state.ts` as it moved to
   `combat.ts`.
3. `docs/design/event-log.md` gained ~105 lines where the brief asked for "a
   short paragraph" — over-delivery inside the file the brief names. Its only
   removal is IE-039's now-superseded "**`applyOne` stays one switch**", which
   is precisely the sentence this task supersedes.

### Outside the brief's surface

`scripts/fold-graph-data.ts` and `scripts/fold-graph.test.ts` — new, required by
criterion 7. The measurement was split out with no top-level effect, in the
`coverage-data.ts`/`coverage.ts` shape and for its reason, and `SOURCES` became
a directory listing because the hand-kept list had **already gone stale** against
the thirteen seams. **Both files run in the suite**, verified explicitly: 15
tests green. The fold graph is no longer checked only when somebody remembers.

Four test assertions that pinned `fold/apply.ts` by path were re-pointed to the
seam that now holds the code — two in `invariants.test.ts`, two in
`spell-schema.test.ts`. The latter is nominally maintainer A's lane; the foreman
read all four and they are path pins with their reasons recorded, nothing
weakened.

### Domain map, for later briefs (criterion 6)

| Seam | Owns |
|---|---|
| `fold/roster.ts` | creature-added, creature-removed, character-created, character-advanced, creature-side-declared, spellcasting-declared, creature-type-declared |
| `fold/vitals.ts` | damage-taken, healed, temporary-hp-granted, temporary-hp-cleared, death-save-recorded, stabilised, condition-applied, condition-removed, exhaustion-set, creature-died, hit-point-maximum-raised |
| `fold/upkeep.ts` | resource-pool-declared, resource-spent, resource-regained, resource-pool-resized, resources-restored, time-advanced, rest-begun, rest-ended |
| `fold/casting.ts` | spell-declared, spell-interrupted, spell-cast, casting-continued |
| `fold/ongoing.ts` | spell-ongoing, spell-ended, spell-activated, area-effect-settled, spell-origin-moved, concentration-started, concentration-ended |
| `fold/timers.ts` | effect-scheduled, effect-check-resolved, damage-scheduled, scheduled-damage-collected, effect-save-resolved |
| `fold/combat.ts` | combat-started, combat-ended, turn-advanced, action-spent, bonus-action-spent, attack-made, dash-taken, disengage-taken, reaction-spent, movement-spent, free-interaction-used, combatant-removed, initiative-swapped, feature-used, reaction-taken |
| `fold/scene.ts` | scene-set, landmark-added, creature-placed, creature-moved, creature-unplaced, sight-declared, cover-declared, mounted, dismounted |
| `fold/features.ts` | feature-activated, feature-ended, readied-declared, readied-released |
| `fold/holds.ts` | movement-declared, opportunity-answered, movement-completed, attack-landed, attack-damage-dealt, damage-rolled, damage-reaction-answered, damage-settled, test-rolled, test-reaction-answered, test-settled |
| `fold/inventory.ts` | items-gained, items-lost, coins-changed, item-equipped, item-unequipped |
| `fold/grants.ts` | bonus-applied, armor-class-granted, roll-modifier-granted, damage-defense-granted, speed-modifier-granted, attack-rider-granted, bonus-removed |
| `fold/rolls.ts` | roll-recorded, rolls-issued |

One new intra-fold edge, `fold/roster.ts → fold/inventory.ts` for
`withEquipment`, taken so `character-advanced` does not keep a second copy of
the armour-derivation rule. Declared in the layout; the graph is acyclic.
