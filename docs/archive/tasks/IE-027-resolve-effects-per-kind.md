# IE-027 — `resolveEffects` split into per-kind resolvers, behaviour-preserving

state: DONE
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `commands/spell-resolution.ts` alone; safe beside IE-028 (`events.ts` only) and IE-029
depends-on: IE-020
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

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

Builder **COMPLETE**, reviewer **PASS at high confidence on round one**, no
defects. Branch `worktree-agent-ad3cd09c3ca5ed758`, commit `8d5ab13`, rebased
by the foreman to `71bf406`.

**`resolveEffects`: 1,008 lines → 214**, of which 63 are its signature and
docs, with **thirteen per-kind resolvers** over a shared `EffectContext`. The
reviewer verified both counts itself rather than accepting them.

**Zero new tests, which the brief required**, and zero test files edited — so
no import path changed either. The oracle is the existing suite plus
byte-identity: every one of the thirteen resolver bodies equals its original
branch **line for line, comments included**, after reversing the three declared
transformations. The builder proved it by reversing them and diffing; the
reviewer reproduced the check with its own normalisation and independently
surfaced the one exception the code correctly preserves.

Frozen logs fold unchanged, neither regenerated. `scenario.test.ts`'s three
assertions hold, including the load-bearing one — re-running the script from
the same seed produces the same log.

One mutation caught, three **survived and are reported rather than fixed**:

- Wiring the context's `saveDc` one point high failed three tests in three
  files across *both* the atomic and the settled path, so the shared context is
  guarded — the thing most worth guarding in a shared-context refactor.
- **Dispel Magic's inner `continue`** survives being rewritten as its
  twenty-two neighbours are. No fixture aims a Dispel Magic at a target
  carrying **two** ongoing spells and fails the first check, so `continue` and
  `return` are indistinguishable to the suite. That line now looks exactly like
  its neighbours and means something else.
- `current = done.value;` — the state threading the split introduced — can be
  commented out and everything passes. No registered definition has one effect
  reading the world another left.
- The `from` wiring can be dropped and everything passes. This is the brief's
  own named risk: the Prone rule read from a casting's held point has no
  fixture with a prone target.

Two things the split made newly visible, both recorded in `CLAUDE.md`: a
resolver's destructure line now states exactly what its rule reads —
`resolveEndConditionEffect` two bindings, `resolveAttackEffect` sixteen — and
`resolveDispelEffect` takes **no `effect` parameter at all**, so
`noUnusedParameters` turned this file's long-standing claim that Dispel Magic's
definition "carries no numbers at all" into something the compiler checks.

Process note for the record: an early mutation applied with Python rewrote the
file CRLF and broke `invariants.test.ts`'s source sweeps. It was caught, the
file re-assembled LF-clean, and every reported result is from the LF file.
`persistence-2.test.ts` did not flake at any point.

## Risk gate

**Lightweight.** The digest reports no architectural deviation, no new runtime
special case, no file outside the surface but `CLAUDE.md`, and the one
foundational primitive it names — `resolveEffects` — *is* the brief's whole
subject. The reviewer passed it at high confidence on the first round having
re-run the byte-identity check independently, which is a stronger oracle than
anything an inspection by me would add: the claim is that the bodies are
unchanged, and two parties verified it mechanically.

Classification: **GREEN**. Merging under tranche 5 authority.

The three surviving mutations are **findings, not defects**: each names a real
line the suite cannot see fail, and all three are pre-existing gaps in fixture
coverage that the split *exposed* rather than created. They are recorded in
`QUEUE.md` under LATER, and the Dispel Magic one is the sharpest — it is a
line that reads like its neighbours and does not mean what they mean.

## Architecture decision

None. No Fable involvement.

## Merge record

Merged to `main` as `71bf406`, fast-forward, pushed. Rebased by the foreman
over IE-025's and IE-028's commits, including two `CLAUDE.md` additions;
clean.

`main` verified after the merge: typecheck ✓, lint ✓, **6767 tests across 105
files** ✓, `COVERAGE.md` byte-clean ✓, tree clean. The count is unchanged from
IE-028's merge, which is what a move with no new tests should do.

**Condition 12 deserves its own sentence here**, because this is a
behaviour-preserving move whose oracle is the suite, and IE-028 landed in
`events.ts` between the review and the merge. Nothing IE-028 changed is read by
a resolver: `grantSourcesOf` and `withoutGrants` are internal to the reducer's
release paths, which `spell-resolution.ts` reaches only through events it
emits. The full gauntlet was re-run on the combination, both frozen logs fold,
and `scenario.test.ts`'s re-run determinism passes on `main` — which is the
assertion that would catch a move that had smuggled in a decision.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS`,
high, one round; **4** no defects; **5** gauntlet green; **6** conformance;
**7** no blocker; **8** no deviation; **9** the one primitive named is the
brief's subject, and `events.ts`, the union, the reducer, the barrel and the
definition format are untouched; **10** no scope expansion; **11** clean
rebase; **12** above; **13** risk gate lightweight, GREEN.

**Unblocks IE-032** (wave 4), together with IE-028.
