# IE-027 — `resolveEffects` split into per-kind resolvers, behaviour-preserving

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `commands/spell-resolution.ts` alone; safe beside IE-028 (`events.ts` only) and IE-029
depends-on: IE-020
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

Split `resolveEffects` into one resolver per effect kind over a shared context,
leaving the pre-flight and the loop in place. **No behaviour change of any
kind.**

### Why now

`resolveEffects` is **1,008 lines** —
`packages/engine/src/commands/spell-resolution.ts:969` to `:1976` — and it
grew by 94 lines during tranche 4 while the audit that named it was
recommending the opposite. Five more effect kinds are queued behind it in this
tranche and the next: each one adds a branch to the same function, and each
one makes every other mechanism task wait on the same file.

Paying this down **before** the five kinds land is the whole point. The
simplification audit is APPROACHING and should measure the engine after this,
not recommend it.

### Current relevant architecture

- `packages/engine/src/commands/spell-resolution.ts:969` — `resolveEffects`,
  the pre-flight (caster, targets, creature types, the generator) and then a
  loop with one branch per `SpellEffect` kind. Fourteen kinds today.
- `:472` `resolveOnTargets` and `:143` `resolveDeclaredCast` are its two
  callers inside this file.
- `applyRiders` — the three rider loops, reached once an affirmative outcome
  is decided, containing no branch of its own. That ordering is fixed in one
  place and must stay fixed in one place.
- **The precedent is IE-005**, which split `commands.ts` into a directory:
  declaration-level equivalence, no behaviour change, the reviewer verifying
  the move rather than re-reviewing the logic.

### Required behaviour

1. One function per effect kind, over a **shared context object** carrying what
   every kind needs — the caster, the target, the level, the pinned numbers,
   the generator, the event sink, the stamp.
2. `resolveEffects` keeps the pre-flight, the loop and the dispatch. It gets
   materially shorter; the *sum* of the parts does not have to.
3. **Not one behaviour changes.** Same events, same order, same generator
   consumption, same refusals, same `unverified` lines.
4. The rider order — conditions, then modifiers, then delayed — stays decided
   in `applyRiders` and nowhere else.

### Architecture constraints

- **This is a move.** A bug found on the way is reported in the digest and not
  fixed here: a behaviour-preserving refactor whose diff also contains a fix
  cannot be verified by its oracle.
- Do not change the effect union, the definition format, or any signature the
  barrel exports.
- Do not touch `events.ts` — IE-028 owns it this wave.
- Do not fold `resolveDeclaredCast` into `resolveOnTargets`. They are
  deliberately different callers; IE-020 has just made the first carry the
  stated facts.

### Acceptance criteria

The oracle is the existing suite, and it is strong enough to be the whole
acceptance test:

1. Every spell test passes unchanged — no test file edited except for an
   import path, and say in the digest exactly which were edited and why.
2. **Both frozen logs fold byte-identically.** Never regenerate either.
3. `scenario.test.ts`'s three assertions hold, including the load-bearing one:
   re-running the script from the same seed produces the same log.
4. `COVERAGE.md` byte-identical.
5. `npm test`, `npm run typecheck`, `npm run lint` green.
6. The digest reports the before and after line counts of `resolveEffects` and
   the list of extracted functions.

### Tests and conformance

No new tests are required and none should be needed; if the split makes a new
test *possible* that was not before, say so in the digest rather than adding
it — that is a finding for the next tranche.

### Dependencies

**IE-020**, which adds the stated facts to the settlement path in this same
file. Splitting first would make IE-020's small change a merge conflict
against a 1,000-line move.

### Likely file surface

`packages/engine/src/commands/spell-resolution.ts` only, plus import paths if
any resolver moves to a new module.

### Out of scope

`events.ts`. Any behaviour change. Splitting `events.ts` itself, which the
delta audit deliberately deferred: a 4,800-line split would stall every
mechanism task behind it.

### Known risks

The two callers pass overlapping but not identical context. The shared context
must not quietly give one path a field the other did not have — that is a
behaviour change wearing a refactor's clothes, and it is exactly what the
frozen logs are there to catch.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
