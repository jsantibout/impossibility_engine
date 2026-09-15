# IE-028 — One enumerator for a creature's sourced grants

state: DONE
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `events.ts` alone; safe beside IE-027 (`spell-resolution.ts` only) and IE-029
depends-on: IE-020
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

Give the four sourced grant families on `CreatureState` one enumerator, so that
a fifth grant cannot be added to three of the five places that walk them.

### Why now

`CreatureState` carries four sourced grant arrays — `bonuses` (`events.ts:254`),
`armorClasses` (`:270`), `rollModifiers` (`:286`) and `grantedDefenses`
(`:308`) — and **five functions enumerate them by hand**: `releaseCasting`
(`:1999`), `releaseOnTarget` (`:2230`), `releaseGrants` (`:2344`),
`expireEffects` (`:3351`) and `holdsNothingOf` (`:3452`). The fourth array
arrived in tranche 4 and had to be threaded through all five.

Two more are queued: IE-033's Speed modifier and IE-035's weapon-attack rider.
Adding a fifth and sixth to a hand-enumerated set is how a grant ends up
released by a dispel and not by a deadline — silently, because each site is
correct on its own terms. This repository has recorded that exact failure
twice: the two lists of pool kinds IE-008 collapsed, and the four readers
`roll-modifiers.ts` replaced.

### Current relevant architecture

- The four arrays and their keys. `rollModifiers` is the one whose identity is
  **not** the bare source: `rollModifierKey` keys on the source *and the rolls
  it reaches*, because Beacon of Hope grants two modifiers from one casting.
  Any enumerator must preserve that.
- `releaseCasting` — the single place an ongoing record is removed, and the one
  door a broken Concentration, a deadline, a dispel and a departing caster all
  converge on.
- `releaseOnTarget` — releases a casting on one creature. `CLAUDE.md` records
  that it "computed the surviving bonuses and never applied them" for as long
  as it existed; that bug is fixed and is the reason this enumerator matters.
- `expireEffects` — reads the four in reverse to shrink `OngoingSpell.on`:
  a casting stops being on a creature when the **last** thing it owned there
  lapses.
- `holdsNothingOf` — the same four asked of one creature and one casting.

### Required behaviour

1. `grantSourcesOf(creature)` — every grant source the creature carries, across
   the four families.
2. `withoutGrants(creature, predicate)` — one removal, applied to all four.
3. The five functions above route through them. **Keys and readers are
   unchanged**, and `rollModifierKey`'s two-part identity is preserved.
4. Iteration order is fixed and deterministic, because condition sets and
   serialised state reach the log.

### Architecture constraints

- **Behaviour-preserving.** Same events, same state, both frozen logs fold.
- Do not collapse the four arrays into one. They are read by different rules
  and `CLAUDE.md` is explicit that a mode is not a bonus: folding them would
  make Blur a negative number.
- Do not touch `commands/spell-resolution.ts` — IE-027 owns it this wave.
- `scheduledDamage` is **not** a grant and does not join the enumerator: a hit
  still owed is the casting's debt, not something it is doing to the creature
  — the same reading that keeps a creature Insect Plague merely damaged out of
  `on`. Say so in the enumerator's docstring.

### Acceptance criteria

1. **The mutation that must redden two suites at once**: drop one family from
   the enumerator and watch the bonuses suite **and** the granted-defences
   suite fail. Report that result in the digest — it is the evidence that this
   is one enumerator rather than two spelled alike, and it is the same evidence
   `defendingModes` was held to.
2. Both frozen logs fold byte-identically; never regenerate either.
3. A Beacon of Hope granting two roll modifiers from one casting still ends
   both, and re-granting the same rolls still replaces rather than stacks.
4. `COVERAGE.md` byte-identical; `npm test`, `npm run typecheck`,
   `npm run lint` green.

### Tests and conformance

Existing suites are the oracle. Add one test that the enumerator sees all four
families — driven so that it fails if a fifth is ever added to the state and
not to the enumerator, if that is expressible without a hand-kept list; if it
is not, say so plainly rather than writing a list.

### Dependencies

**IE-020**, which adds two fields to `PendingCasting` in `events.ts`.

### Likely file surface

`packages/engine/src/events.ts` only, plus tests.

### Out of scope

Adding a fifth grant — IE-033 does that, through this enumerator. Splitting
`events.ts`. Any change to how a grant is keyed.

### Known risks

`expireEffects` reads the four to decide whether a casting still owns anything
on a creature. An enumerator that reports a grant the old code skipped would
keep a finished casting in `on`, which is a wrong answer to Dispel Magic and
is not caught by the frozen logs.


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence on round one**, no
defects, no rework. Branch `worktree-agent-aa6095a1b720ab3be`, commit
`45c4705`, rebased by the foreman to `7e7717b`.

Tests **6721/6721** in the worktree, 9 new in `grant-enumerator.test.ts`.
Gauntlet green; `COVERAGE.md` byte-identical; **both frozen logs fold and
neither was regenerated.**

**The acceptance criterion I wrote could not be satisfied, and the builder was
right to substitute.** Criterion 1 asked that dropping one family from the
enumerator redden the bonuses suite *and* the granted-defences suite. It
cannot: dropping `grantedDefenses` leaves the bonuses walk intact, so only the
defences suite moves — and under the derived `GrantFamily` the brief itself
asked for, dropping a family is a **compile error** before any test runs. The
substitute is stronger and is what the `defendingModes` precedent actually
describes: break the **shared walk**, and 25 tests across 10 files go red
together — `spell-buffs`, `granted-defenses`, `roll-modifiers`,
`armor-class-spells`, `ongoing-spells`, `counterspell`, `reaction-triggers`,
`outcome-riders`, the new suite and `persistence-2`. The builder ran both
mutations and reported both; the reviewer reproduced them independently and
verified the compile guard **in both directions** — a fifth sourced-grant field
added to `CreatureState`, and a family removed from the `grantsOf` literal,
each failing the build by name.

Foundational primitives touched: `events.ts` release paths — `releaseCasting`,
`releaseOnTarget`, `releaseGrants`, `holdsNothingOf`, and `expireEffects`
through them. The `GameEvent` union and `CreatureState`'s shape are unchanged.
`grantSourcesOf` and `withoutGrants` join `@ie/engine`'s surface through
`export * from './events.js'` — declared, since the brief named the file but
not the surface addition.

Out-of-scope finding: `releaseGrants`'s predicate parameter is still named
`held` while it now receives a source string. The reviewer raised it as a
non-defect and the builder left the reviewed commit untouched rather than
amending after a PASS — the right instinct. One word, for whoever next opens
that function.

## Risk gate

**Inspected** — one signal: a foundational primitive changed (`events.ts`, the
reducer's release paths).

What the diff shows:

- **`GrantFamily` is derived from `CreatureState`'s own shape**, not listed —
  a mapped type selecting the keys whose value is a `readonly SourcedGrant[]`,
  with `initiativeBonuses` excluded and the exclusion argued: creation derives
  it from the character's feats, nothing hangs it on them, and no casting,
  deadline or dispel takes it away. It was in none of the five walks, and
  putting it in one would end a feat the rules never end.
- **`grantsOf` is annotated with a mapped type over `GrantFamily`**, so a fifth
  family declared on `CreatureState` makes *that literal* a compile error
  naming the property it lacks. That is a stronger guard than the test I asked
  for, and it is the answer to the brief's "if it is not expressible without a
  hand-kept list, say so plainly" — it turned out to be expressible.
- **`scheduledDamage` is excluded with the reason the brief required**, and the
  docstring goes further than asked: it is not even per-creature, being dropped
  at state level by `withoutScheduledDamage`.
- **The by-reference early return is preserved**, and the docstring says why it
  is load-bearing rather than an optimisation: `releaseCasting` compares
  identity to decide whether a derived pass touched anybody.
- **The `expireEffects` hazard the brief named is discharged by reading, not
  only by the suite** — `grantSourcesOf` reports exactly the union the five
  sites already read, so `holdsNothingOf` cannot report a grant a release
  would skip and no finished casting can be kept in `OngoingSpell.on`. The
  frozen logs would not have caught that, which is why the brief named it.

Classification: **GREEN**. The one declared correction is to my criterion's
*text*, not to the approved design, and it is the second brief error of this
tranche — see the merge record.

## Architecture decision

None. No Fable involvement.

## Merge record

Merged to `main` as `7e7717b`, fast-forward, pushed. Rebased by the foreman
over three commits including IE-025's `CLAUDE.md` addition; clean.

`main` verified after the merge: typecheck ✓, lint ✓, **6767 tests across 105
files** ✓, `COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS`,
high, one round; **4** no defects; **5** gauntlet green; **6** conformance,
both frozen logs folding; **7** no blocker; **8** no material deviation — the
one declared correction is to an acceptance criterion I wrote wrongly, verified
above; **9** `events.ts` was the brief's whole named surface, and the public
surface addition is declared; **10** no scope expansion; **11** the rebase was
clean; **12** re-verified on `main` after the merge; **13** risk gate
inspected, GREEN.

**This is my second mistaken acceptance criterion in one tranche** — IE-025's
rule 5 asserted a rules fact the SRD contradicts, and this one described a test
outcome the design it asked for cannot produce. Both were caught by the builder
and confirmed by the reviewer, which is the system working; the pattern is that
I wrote each by analogy to a precedent without checking the analogy held in the
new design. Recorded here rather than only noticed.

**Unblocks IE-030** (wave 3) and, with IE-027, **IE-032** (wave 4).
