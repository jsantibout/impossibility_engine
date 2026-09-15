# IE-047 — Derive `OngoingSpell.on`, and three tests the suite was missing

state: DONE
lane: conformance
tranche: 6
parallel-safe: CONDITIONAL — `fold/release`, `fold/expiry`, `commands/ongoing.ts`, `persistence-2.test.ts`; not beside IE-042 or IE-048
depends-on: IE-039
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6." (re-scoped: the measurement and the tests; the removal is a later tranche)

## Brief

### Objective

Stop maintaining `OngoingSpell.on` with three passes and derive it from the
rule it already obeys; make the frozen log's prefix test O(n); and write the
three tests that three surviving mutations proved were missing.

### Why now

`on` is a **stored derivation kept in step by three passes** — written at the
cast, grown by `alsoOn`, shrunk by `expireEffects`, edited by `withoutTarget`
— and CLAUDE.md records the bug that shape already produced: a stale name let a
creature dispel a spell no longer on them. The rule is one sentence — *a
casting is on a creature while it has a live effect there that the casting
owns* — and `holdsNothingOf` already computes exactly that.

Fable measured it: folding `golden-log-2.json` at every prefix and comparing
the stored `on` against the derivation gives **869 checkpoints, 0 mismatches**.

`persistence-2.test.ts` is 5.06 s of the suite's 23.9 s summed file time, for
sixteen tests, and carries a 30-second timeout it was given after failing
intermittently.

### Current relevant architecture

- `fold/release` (after IE-039) — `alsoOn`, `withoutTarget`, `holdsNothingOf`,
  `grantSourcesOf`.
- `fold/expiry` — where `on` shrinks when the last owned effect lapses.
- `commands/ongoing.ts` — `ongoingSpellsOn` and the Dispel readers.
- `persistence-2.test.ts:339` — 551 events folded at 552 prefixes, twice, once
  through a JSON round trip. `fold` is `events.reduce(applyEvent, …)`, so the
  claim is the same as "applying each round-tripped event to the previous equal
  state gives an equal state" — one pass, 551 applications.
- CLAUDE.md records three mutations that survive the whole suite: Dispel's
  inner `continue`, the state threading in the effect loop, and the `from`
  wiring.

### Required behaviour

1. **The gate first.** Write a test that folds both fixtures and the
   ongoing-spells suite and asserts stored-`on` equals derived-`on` after
   **every event**. It must pass before a single pass is removed.
2. Then remove the three maintenance passes. `on` **stays** on the record and
   in `spell-ongoing` as written at the cast — the caster half is the one bit
   the derivation cannot recover, and it is already there. `ongoingSpellsOn`
   and the Dispel readers ask the derived question.
3. Make `persistence-2.test.ts:339` O(n): the same property at the same 552
   points, one pass. Delete the timeout paragraph with the timeout.
4. Write the three missing tests:
   - a Dispel Magic at a target carrying **two** ongoing spells, failing the
     first check — the fixture that makes Dispel's inner `continue` load-bearing;
   - an effect list whose second effect reads the world the first left — the
     fixture that makes the state threading load-bearing;
   - Spiritual Weapon's Prone rule read **from the point** — the fixture that
     makes the `from` wiring load-bearing.
   Each must fail if its mutation is applied; the digest says so, mutation by
   mutation.

### Architecture constraints

- derivation over stored state, with the equality gate **before** the removal;
- `scheduledDamage` is deliberately **not** one of the links the derivation
  reads — a hit still owed is the casting's debt rather than something it is
  doing to the creature, which is what keeps a creature Insect Plague merely
  damaged off the list. Do not widen the rule while implementing it.

### Acceptance criteria

1. The stored-equals-derived test exists, is committed, and passed **before**
   the passes were removed — the commit order shows it.
2. Every Dispel Magic, `withheldEndings` and area-trigger answer is unchanged;
   both frozen logs fold identically.
3. `persistence-2.test.ts` asserts the same property at the same points, runs
   without a raised timeout, and the file drops below a second.
4. Each of the three new tests is shown to fail under its own mutation.
5. No reader of `on` wanted "on at the cast" rather than "on now" — the sweep
   for one is in the digest, with what it found.

### Tests and conformance

The gauntlet plus both frozen logs explicitly. CLAUDE.md: the `OngoingSpell.on`
paragraphs lose the three-pass description and gain the derivation and its
evidence; the `persistence-2` timeout paragraph goes.

### Dependencies

IE-039 (the fold modules). Not beside IE-042 or IE-048 — all three touch the
release path or the ongoing readers.

### Out of scope

`OngoingSpell`'s other fields. Any change to what Dispel Magic does. Further
abstraction of `resolveEffects` — the three tests are the answer to those
mutations, and Fable refused the refactor on that evidence.

### Known risks

Low-medium, and the risk is exactly one thing: a reader that wanted the stored
value's *history* rather than the present truth. None was found; the gate test
is what proves it over 869 checkpoints rather than by reading.

## Completion digest

```
IE-047 — Completion digest
Builder: ARCHITECTURE_BLOCKED
Commit: 58c8626 (reviewed at 9b84c35; replayed onto main as 62cb640)
Opus review: ESCALATE — rounds: 1, confidence high. Three ordinary defects raised and fixed
  after the verdict; the ESCALATE stands, because the fix addressed prose accuracy and not the
  blocking question.
Tests: 8413 / 8413 on the branch (baseline 8403); new: 10. On main after the replay: 8433
  across 122 files.
Mutations, four, each against the WHOLE suite: (1) Dispel's inner `continue` → `return
  ok(current)` — 1 failure, the new one; (2) the effect loop's `current = done.value` commented
  out — 1, the new one; (3) `from` dropped from EffectContext — 1, the new one; (4) `derivedOn`'s
  holdsNothingOf predicate inverted — the gate's 869-checkpoint assertion and all three
  counterexamples. **The first three each previously survived the entire suite.**
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓; both frozen logs run explicitly.
Conformance: PASS — COVERAGE.md byte-clean; both frozen logs fold unchanged; **no `src/` file
  changed at all.**
Architectural deviations: the removal was not performed, which is the brief's own instruction
  when the gate fails. Required behaviour 2 and acceptance criteria 2 and 5 are not met.
Foundational primitives touched: none. fold/release.ts, fold/expiry.ts and commands/ongoing.ts
  are untouched.
Reviewer confidence: high
Recommendation: ESCALATE
```

## Risk gate

**Inspected, and there was little to inspect**: no `src/` file is in the diff.
What merged is two new test files, one extended, `persistence-2.test.ts`
rewritten linear, and `CLAUDE.md`.

**The three defects the reviewer raised were fixed after its verdict and I
checked them myself**, since that delta was not re-reviewed: no unregenerated
count survives in the prose (the reviewer's first defect was arithmetic in
`CLAUDE.md` that did not sum and that nothing regenerates — this repository's
signature failure); the `grants` finding now states its latency in as many words
rather than reading as a live Dispel Magic bug; and the characterisation test
carries the sentence the next person needs — *"whoever fixes `fold/expiry.ts`
should expect this to go red, and that is the test doing its job rather than a
regression."*

**Fable's one merge condition is satisfied by that same sentence**, and is
recorded here as it asked: the gate's third case **asserts the disagreement**,
and the task that fixes `fold/expiry.ts` must **flip** it, never delete it.

Classification: **GREEN** for what merged; the blocked half is re-scoped below.

## Architecture decision — YELLOW, answered by Fable

**Decision: yes, derive it — option 1, restated by provenance — and not in this
tranche.**

`on` is **two facts of different provenance in one list**, and the split is
*store what only the cast knows, derive what the world already holds*:

| Bucket | Provenance | Disposition |
|---|---|---|
| the caster of a Range: Self spell | a cast-time declaration | **stored** |
| targets the casting reported nothing about, and the geometry did not choose | a cast-time declaration — the tracked-spell case | **stored** |
| whoever the casting hung a live effect on (`held`) | a world fact `holdsNothingOf` answers at every read | **derived** |

So the stored subset is `on \ held` at the cast, under a **new name** — `aimed`
or similar, so no reader can mistake it for "on now" — and "on now" is that
subset ∪ {creatures for which `holdsNothingOf` is false}.

**Why the gate measured what it did.** Its `derivedOn` reads the caster half
*off the stored list*, so it derives bucket 3 and half of bucket 1 and cannot see
bucket 2 at all — which is exactly why it reproduced 869/0 and exactly why it
fails on tracked spells. The seeded alternative fails in the other direction
because it keeps bucket 3 stored. **Neither is the derivation.**

**Two latent asymmetries are ended by construction rather than by a fourth hand
pass**, and they are why option 4 was rejected as an end state:

- growth is `alsoOn` with **one** call site, `condition-applied` — none of the
  five grant events grows `on`;
- expiry shrink is the **condition** branch only — the `grants` branch releases
  and does not shrink.

Both are the same defect from two directions: *a discipline over six grant
families and four timer kinds with no enumerator behind it* — precisely the
shape IE-028 replaced for the release walks. Option 4 keeps a maintained copy of
a derivable fact that has drifted once (CLAUDE.md's stale-name bug), is stale
again now, and would be stale a third time the first time an area trigger or
activation carries a `modifiers` rider.

**The version hazard is real and is one line, independent of all this.**
`upgradeOngoing`'s catalogue fill is keyed `casting.version !== ONGOING_RECORD_VERSION`,
so *any* future bump routes every version 2 record through the catalogue fill —
the exact hazard that file's own docstring names, one constant edit away
regardless of this task. The fix is to key it on `version === undefined`.

**Rejected, with reasons**: a second field beside `on` (option 1 with the
derivable half still stored, so it still drifts); deriving growth and keeping
both shrinks (the grants expiry must still hand-edit, so it does not remove the
defect it was measured against); leaving it (above); and making `holdsNothingOf`
count "ever touched" (inventing a rule — CLAUDE.md already decided Insect Plague
is not on the creature it bit).

## Merge record — re-scoped

**Re-scoped by the foreman under tranche authority, on Fable's decision and with
the reviewer's explicit consent** — it wrote that the delivered parts "could land
as a task in their own right, but that re-scoping is the foreman's to declare,
not mine to grant." What landed is the measurement and the tests; the removal is
briefed into a later tranche and is **not** this tranche's to build.

Replayed onto `main` as `62cb640`. `main` verified after the merge: typecheck ✓,
lint ✓, **8,433 tests across 122 files** ✓, both frozen logs, the scenario
determinism and the new gate run explicitly ✓, `COVERAGE.md` byte-clean ✓, tree
clean.

**What it bought, none of which depends on the derivation:**

- **The three mutations CLAUDE.md records as surviving the whole suite now have
  fixtures** — Dispel's inner `continue`, the effect-loop state threading, and
  the `from` wiring. That file has named them as a known hole since IE-027.
- `persistence-2.test.ts` is linear over the same 552 points; the 30-second
  timeout and the paragraph explaining it are gone.
- The gate itself is the **acceptance criterion** for the later task, and the
  instrument that found the blindness in the first place.

## For the later tranche, as Fable specified it

**One mechanism task, one builder, running alone** — it touches `events.ts` and
the fold, so it runs beside no other mechanism task. It owns `spells.ts`
(`OngoingSpell`), the `spell-ongoing` payload, `ongoing-compatibility.ts`,
`fold/release.ts`, `fold/expiry.ts`, `fold/apply.ts` and the four reader sites.

Compatibility is **two steps and the order matters**: key `upgradeOngoing`'s
catalogue fill on `version === undefined` and nothing else; *then*, for a record
below the new version, compute the stored subset **in the `spell-ongoing`
reducer case**, because it reads state — and it is correct there because the
record is written last in every resolution path, so everything held is already
on the creatures.

Acceptance: the existing gate at 869/0 with the engine's own function
substituted for the test-local one; **the third case flipped rather than
deleted**; and a hand-built version 2 record with a pinned area folded through
the bump and asserted untouched.

`alsoOn` is deleted, the expiry condition-branch shrink is deleted,
`withoutTarget` is **kept** — a dispelled Darkvision must still leave the stored
list. `holdsNothingOf`'s reading does not change: scheduled damage stays out.
