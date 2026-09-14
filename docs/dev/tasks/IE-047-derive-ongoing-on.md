# IE-047 — Derive `OngoingSpell.on`, and three tests the suite was missing

state: OWNER_APPROVAL_REQUIRED
lane: conformance
tranche: 6
parallel-safe: CONDITIONAL — `fold/release`, `fold/expiry`, `commands/ongoing.ts`, `persistence-2.test.ts`; not beside IE-042 or IE-048
depends-on: IE-039
worker: none
approved: none
merge-approved: none

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
