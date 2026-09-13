# IE-008 — Every pool a level grants, granted at advancement

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 3
parallel-safe: YES beside a spell-resolution task — it is `creation.ts` and the resource pools, touching no spell, no event type and no fold; NO beside another task in `creation.ts` or resource authority
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 3"
merge-approved: none

## Brief

### Objective

Make `advanceCharacter` grant every pool the new level grants, and resize
every pool whose maximum the new level moves — the two kinds it already does
for hit dice and spell slots, applied to the two kinds it silently omits.
Leave what has been spent spent, as the existing path already does.

### Why now

**This is a wrong number in a shipped path, not a missing feature**, and it
is the class of failure this repository calls its worst: it looks like a
rules bug forever after.

`creation.ts:2423` — `poolEvents`, run at creation — declares four kinds of
pool: the Hit Die pool, the spell slot pools, **a feat's free-casting pool**,
and **a feature's own pool, "sized by the class table at the level it is read
at"**. `advanceCharacter` (`creation.ts:2661`, emission at `:2735-2768`)
emits `hit-point-maximum-raised`, one `resource-pool-resized` for the hit
dice, a declare-or-resize for each slot pool, and `character-advanced`. The
last two kinds are not there at all — neither declared when the new level
grants one, nor resized when the new level moves one.

The comment sitting above that block says "Pools that already exist grow;
pools that did not exist are declared." That is true of the two kinds below
it and false of the other two, which is why it reads as complete.

What it costs, in printed SRD numbers:

| Feature | Sized by | A character advanced 3 → 4 has |
|---|---|---|
| Lay On Hands | "five times your Paladin level" | 15 hit points in the pool, not 20 |
| Sorcery Points | the Sorcerer level | 3, not 4 |
| Monk's Focus | the Monk level | 3, not 4 |
| Rage, Channel Divinity, Wild Shape, Second Wind, Bardic Inspiration | a column of the class table | whatever the table printed at the level they were *created* at |

And a pool that arrives later never arrives at all: a Fighter advanced to 9
has Indomitable on the sheet and nothing to spend, so `takeTestReaction`
refuses a Reaction the character is entitled to. That is the symptom IE-006's
builder hit — it created its fighter at level 9 to work around it — and the
worked-around bug is the smaller half of what is actually here.

### Current relevant architecture

- `poolEvents` (`creation.ts:2423`) — the creation-time declarer, and the
  specification this task is matching. Its four loops are hit dice, slot
  pools, `plan.spellcasting.granted[].freeCastPool`, and features whose
  `grants.kind === 'activated'` with a non-null `pool`. Arcane Recovery is
  matched by id there, because its single use is not a column in any table.
- `advanceCharacter` (`creation.ts:2661`), emission at `:2735-2768`. It
  already holds `plan.value` — a full `CharacterPlan` at the new level — and
  `creature.resources.pools`, which is everything the declare-or-resize
  decision needs. **The facts are already in hand; only the loops are
  missing.**
- `resource-pool-declared` and `resource-pool-resized` already exist and are
  already emitted by this function. **No new event type**, and
  `resource-pool-resized` is documented in `CLAUDE.md` as changing a maximum
  and leaving what has been spent spent — which is exactly the required
  semantics for a pool that grows with a level.
- `poolSizeOf` in `progression.ts` — the three SRD sizings (a table column,
  an ability modifier with a floor, a multiple of the class level), each read
  at *that class's* own level. A multiclassed Bard's Inspiration must not
  grow with their Fighter levels; `CLAUDE.md` records that and it is the
  fixture that discriminates.

### Required behaviour

1. `advanceCharacter` emits, for every feature pool the character has at the
   new level: `resource-pool-declared` where `creature.resources.pools` has
   no such key, `resource-pool-resized` where it does and the maximum has
   moved, and **nothing at all** where it has not. The last clause matters —
   a resize to the number already stored is a no-op event, and the log should
   not carry one per level per feature.
2. The same for a feat's free-casting pool, for a feat gained at an Ability
   Score Improvement level.
3. Spent is never touched. A Barbarian who has used two Rages and levels up
   has a larger maximum and the same two spent.
4. A pool whose maximum would *shrink* is out of scope and must not be
   emitted silently: no SRD progression shrinks one, so if the builder finds
   a case it is a finding for the digest.
5. The shared derivation is one function used by both callers, or
   `poolEvents` is refactored so both reach it. Two lists of four pool kinds
   that must agree is the bug this task is fixing, arriving again.

### Architecture constraints

- No new event type, no change to `events.ts`, the reducer or the fold.
- No change to `poolSizeOf` or to any class table. If a size looks wrong,
  that is a separate finding, not this diff.
- Declared, never derived, stays the rule: the engine does not compute a pool
  the class definition did not declare.
- Both frozen logs must fold unchanged. `golden-log-2.json` **contains a real
  advancement** (Nyx 4 → 5), so this task is squarely in its path: if that
  character has a feature pool, the frozen log will now disagree with a fold
  that emits more events than it did. **That is not a reason to regenerate
  the fixture.** The fixture is a log, and folding a log that was written
  without those events must still give the state it always gave; if the
  builder finds it does not, the task stops and reports, because it means the
  change is not backward-compatible and that is an architectural question
  rather than an implementation one.

### Acceptance criteria

1. A failing test first, for each of: a pool that grows with the level
   (Sorcery Points 3 → 4 is the cleanest, being a bare class level), and a
   pool that does not exist until a later level (Fighter 8 → 9, Indomitable,
   ending in a `takeTestReaction` that now succeeds where it previously
   refused).
2. Spent is preserved across the advancement, asserted.
3. A multiclass fixture asserts a pool is sized by *its own class's* level
   and not the character level — the mutation that reads the character level
   must fail it.
4. No redundant `resource-pool-resized` is emitted for a pool whose maximum
   did not move, asserted on the event list.
5. Both frozen logs fold to the state they have always folded to.
6. The whole gauntlet passes; `COVERAGE.md` regenerated.

### Tests and conformance

`creation.test.ts` or the advancement test file beside it; a `class-pools`
assertion if that file already owns the pool population. The class-table
suites run unchanged.

### Dependencies

None. It is `creation.ts` and the resource pools; nothing in this tranche
touches either.

### Likely file surface

`packages/engine/src/creation.ts`, its advancement test file,
`packages/engine/src/class-pools.test.ts` if the population assertion lives
there, `CLAUDE.md` (the progression section, which currently says "Pools grow
rather than being re-declared" and describes only the half that worked).

### Out of scope

Ability Score Improvements taken as score increases; per-class spell
preparation; any change to what a class table prints; the nine unreachable
event types; `restoreResourcesOn`.

### Known risks

- **The frozen fixture crossing this path** is the one real risk, and the
  constraint above says what to do rather than leaving it to judgement.
- A shared derivation refactor is where a behaviour change hides; the guard
  is that creation's emitted events for an unchanged character are identical
  before and after, which is worth asserting directly.
