# IE-051 — Move the per-kind resolvers out of `commands/spell-resolution.ts`

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 7
parallel-safe: NO — it *is* `commands/spell-resolution.ts`
depends-on: none
worker: none
approved: none
merge-approved: none

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
