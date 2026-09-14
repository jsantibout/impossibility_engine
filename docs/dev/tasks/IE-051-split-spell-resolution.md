# IE-051 — Move the per-kind resolvers out of `commands/spell-resolution.ts`

state: DONE
lane: mechanism
tranche: 7
parallel-safe: NO — it *is* `commands/spell-resolution.ts`
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 7."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 7."

## Brief

### Objective

Move IE-027's thirteen per-kind resolvers out of the 3,043-line
`commands/spell-resolution.ts` into their own modules, behaviour-preserving,
with declaration-level byte-identity as the oracle.

### Why now

**This file is a larger measured bottleneck than the reducer, and that is a
correction to the plan rather than a preference.** Across tranche 6's twelve
merges:

| | touched by | lines |
|---|---|---|
| `commands/spell-resolution.ts` | **4** merges | 3,043 |
| `fold/apply.ts` | 3 merges | 1,796 |

And it is what **lost a task**. IE-042 could not launch beside IE-046 or IE-047
because all three wanted this file, was correctly held out of two waves, and was
then never picked back up — the tranche closed over it. Three of tranche 7's own
tasks want it too: the `OngoingSpell.on` readers, the Acid Arrow pre-flight, and
IE-042's new resolver.

IE-027 already did the hard half: the resolvers are thirteen separate functions
over one `EffectContext`, and the difference between two of them is visible in
what each destructures. They simply still live in one file.

### Current relevant architecture

- `commands/spell-resolution.ts` — `resolveEffects` (the pre-flight, the loop
  and the dispatch, ~214 lines), thirteen `resolve*Effect` functions,
  `castOrRelease`, `resolveDeclaredCast`, `imposeCondition`, `scheduleDelayed`,
  `creatureTypeNeeds` and the ongoing-record writer.
- IE-005 (`commands.ts`), IE-027 (`resolveEffects`) and IE-039 (`events.ts`) are
  three precedents for exactly this move, each with the same oracle.
- `commands.ts` is the barrel; `invariants.test.ts` reads it to know which
  exports are commands.

### Required behaviour

1. **Verify the value graph first**, as IE-039 did: build the
   declaration-level graph of the file and confirm it is acyclic across the
   boundaries you intend. A cycle is `ARCHITECTURE_BLOCKED`, not something to
   route around. Commit the script; it is the evidence for the layout.
2. The thirteen resolvers move to their own module or modules under
   `commands/`; `resolveEffects` — the pre-flight, the loop and the dispatch —
   stays where it is.
3. **The dispatch stays a `switch` with its `never` default.** That binding is
   the guarantee IE-027 kept deliberately and a lookup table would lose it.
4. Every moved body is **byte-identical** to its source after a short, declared
   list of mechanical transformations. The digest names the list.
5. `EffectContext` moves with the resolvers or stays, whichever leaves the
   import graph acyclic — say which and why.
6. No public name changes: the barrel and `index.ts` expose exactly what they
   expose today.

### Architecture constraints

- behaviour-preserving, byte-identity as the oracle;
- one dispatch, one `never`;
- no resolver becomes reachable from outside the effect loop.

### Acceptance criteria

1. Both frozen logs fold byte-identically and `scenario.test.ts`'s determinism
   holds — run explicitly.
2. The value-graph script is committed and reports no cycle.
3. `npm run typecheck`, `npm run lint`, the full suite, `COVERAGE.md`
   byte-clean.
4. **The contention claim is checked**: in the digest, state which module each
   of tranche 7's three would-be colliders now touches — the `OngoingSpell.on`
   readers, the Acid Arrow pre-flight, IE-042's new resolver. If two of the
   three still land in one module, say so.
5. The digest records the module map; later tasks are briefed against it.

### Tests and conformance

No new behavioural tests. The frozen logs and the sweeps are the conformance.
`invariants.test.ts`'s populations — the idempotency sweep, the action-economy
closure, the `satisfyWith` sweep — read modules under `commands/` as one string
and must keep seeing every file; check that the closure still finds the same
spenders, because a population that silently shrinks is this repository's
most-repeated failure.

### Dependencies

None. Wave 1, beside IE-050 — they share no file.

### Out of scope

`castOrRelease`'s own logic, the ongoing-record writer, and anything about what
a resolver does. The `spell-definitions.ts` split, which is IE-058.

### Known risks

Low with the oracle. The one thing to watch is `invariants.test.ts`'s module
populations, which are directory listings rather than hand lists precisely so a
move like this is safe — confirm that in the digest rather than assuming it.

## Completion digest

**Merged `402ecf4`**, 13/13 auto-merge conditions, reviewer PASS at high
confidence on the **first** round. `commands/spell-resolution.ts` 3,043 → 1,485
lines; sixteen resolvers into eight sibling modules under `commands/`.

**The oracle held, and the foreman verified it independently.** Of the 22
top-level declarations in the eight new files, **22 are byte-identical** to a
run in `main`'s `spell-resolution.ts` after removing exactly one `export `
keyword — the single mechanical transformation, and the only one. The builder
and the reviewer each proved this separately; this is a third, mechanical check
run in the main checkout against `git show main:`.

The value graph was run **both ways** — against the unsplit file and against the
split — and prints the same 35 declarations and the same module graph, ACYCLIC
both times. The anticipated YELLOW (a cycle in the value graph) did not arrive.

**Two mutations, both reverted:** turning off halving on a successful save in
the moved `resolveSaveDamageEffect` reddened 5 tests across 4 files; inverting
`outlivesCasting` in the moved `resolveConditionEffect` reddened 7 in
`casting-end-triggers.test.ts`.

**The brief said "thirteen resolvers" and there are sixteen** — a stale IE-027
count carried forward, not a scope change. All sixteen dispatch arms moved.

### Acceptance criterion 4, answered — and the residual

The three would-be colliders land in three different modules, none shared:

| Task | Lands in |
|---|---|
| IE-053 (`OngoingSpell.on` readers) | `commands/spell-effect-magic.ts` |
| IE-054 (Acid Arrow pre-flight) | `commands/spell-effect-riders.ts` |
| IE-042 (a `condition-immunity` resolver) | `commands/spell-effect-grants.ts` |

**But all three still need a small edit in `commands/spell-resolution.ts`
itself** — `landedOn`, `castOrRelease`'s pre-flight, and one `case` line in
`resolveOneEffect`: three non-adjacent declarations of a now-1,485-line file.
Read at **file** granularity the one-owner-per-primitive rule still serialises
all three; read at **declaration** granularity it does not. The builder raised
this as the foreman's call rather than deciding it, which is correct.

**The foreman's ruling: nothing changes in tranche 7, and no rule is loosened.**
The approved wave plan already places those three tasks in three *different*
waves — IE-053 in wave 2, IE-042 in wave 3, IE-054 in wave 4 — so they never run
concurrently under the roster the owner approved, and the question is moot for
this tranche. Loosening "one owner per primitive" from module to declaration
granularity is a **workflow** change, not an engine one; it wants its own
evidence and its own gate, and making it here to solve a problem this tranche
does not have would be exactly the improvisation the owner's approval forbade.
Recorded as evidence for the next cycle's planning.

### Reported, not acted on

1. **Neither frozen log caught either mutation.** They exercise no halved
   save-damage branch and no Concentration-owned condition's `held`. The logs
   fold byte-identically, which is the acceptance criterion — but their coverage
   of the resolvers is thinner than "the frozen logs are the conformance"
   implies. The honest disclosure is the valuable half of this digest.
2. An **orphaned docstring** sits at the old lines 986–993 of
   `spell-resolution.ts` — "What a spell does, once it has been paid for",
   attached to no declaration. Left exactly where it is: moving or deleting it
   is not byte-identity.
3. `invariants.test.ts`'s `COMMAND_MODULES` is a **non-recursive**
   `readdirSync`, so any future `commands/` subdirectory leaves both sweeps
   silently. This is why the new modules are flat siblings rather than
   `commands/spell-effects/`.

### Outside the brief's surface, each with its reason

`turn-context.test.ts` — one `EXEMPT` key, which is `"<file>: <code line>"` and
therefore follows `scheduleDelayed` to its new file; IE-046's reason text is
unchanged verbatim. `CLAUDE.md` — **one router row**, now naming
`commands/spell-effect-*.ts`; no subsystem architecture written back into it,
which is the discipline the refactor was for. `docs/design/casting.md` — the
document the router points at, gaining the module map.
