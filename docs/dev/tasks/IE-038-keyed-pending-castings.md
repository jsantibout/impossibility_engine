# IE-038 — `pendingCastings`, keyed by casting id

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 6
parallel-safe: NO — `events.ts`, `commands/spell-resolution.ts`, `commands/casting.ts`; the whole casting primitive
depends-on: none
worker: none
approved: none
merge-approved: none

## Brief

### Objective

Replace the single global `pendingCasting` slot with a record keyed by casting
id, so that two castings may be open at once and every reader addresses **a**
casting rather than **the** casting.

### Why now

The engine refuses **every other creature's** casting and activation for the
whole of a ten-minute rite. IE-034 recorded that as a structural accident of a
one-instant user surfacing as a rules refusal, and four tests pin it as known
debt. SRD lets the cleric cast Cure Wounds while the wizard performs a Ritual;
Counterspell is the proof case — casting B must be able to begin and resolve
while casting A is still pending. Three later tasks build on this record
(IE-041's in-combat obligation, IE-036's fixtures, the Counterspell-on-
Counterspell lift), and nothing else in tranche 6 may land on the slot.

### Current relevant architecture

Verified against `main` at `7f503c2`: **26 references in 9 runtime files**.

- `events.ts:962` — `GameState.pendingCasting: PendingCasting | null`;
  `:1052` `initialState`; `:1583` `spell-declared` carries the whole record as
  `event.casting`; `:2451` `releaseCasting` clears on id match; `:4422`
  `spell-declared` throws if any casting is pending; `:4535`
  `spell-interrupted`; `:4572` `spell-cast`'s settling branch already matches
  on id.
- `commands/spell-resolution.ts:172` the `settle-cast` idempotency kind,
  `:177` `resolveDeclaredCast` (takes **no** casting id), `:358`
  `castOrRelease`'s `casting_pending` refusal, `:2393`
  `resolveInterruptCastingEffect`.
- `commands/activation.ts:133` the same global refusal, with no exemption.
- `commands/casting.ts:168` `triggerRefusal`'s `casting-a-spell` window.
- `commands/turns.ts:740` `resolveTurn`'s refusal.
- `commands/reactions.ts:892` `reactionOpportunities`.
- `commands/holds.ts:59` `settleHoldsInvolving`, `:219` `pendingCastingOf`.
- `commands.ts` the barrel; `spell-definitions.ts:177` prose.

### Required behaviour

1. `GameState.pendingCastings: Readonly<Record<string, PendingCasting>>`,
   iterated in **casting-number order** wherever order is observable — the
   ordering `castingsEnded` already uses, so serialisation is byte-identical
   whatever order two castings were declared in. `PendingCasting`'s own shape
   does **not** change.
2. The **global refusal is deleted** from `castOrRelease` and from
   `activation.ts`. It is replaced by the per-caster rule: the caster of an
   open casting may not begin another casting that spends the **Magic
   action**; a Reaction and a Bonus Action are permitted. Another creature's
   casting is simply legal.
3. The reducer enforces **one open casting per caster**: `spell-declared`
   throws only if *that caster* already has one. The sequential-id check stays.
4. `resolveDeclaredCast` takes a `castingId` and refuses `no_casting_pending`
   naming it. Its idempotency kind becomes `settle-cast:<castingId>` with the
   id in the fingerprinted inputs; the replayed answer still recovers the
   casting id through `commandOutcome`. **Public API change** — say so in the
   digest.
5. `resolveInterruptCastingEffect` and `triggerRefusal`'s `casting-a-spell`
   window address the casting **by its caster** (the forced target is the
   caster). `no_trigger` when none is open; `forced_target` naming the casters
   who are, when the request named somebody else — preserving the split
   IE-029 made between "wait" and "re-send".
6. `reactionOpportunities` yields offers for **every** pending casting, to
   every creature other than that casting's own caster.
7. `settleHoldsInvolving` interrupts every pending casting by a departing
   caster. `pendingCastingOf` becomes `pendingCastingsOf(state)` (sorted) and
   `pendingCastingBy(state, caster)`; the barrel and `index.ts` follow.
8. `resolveTurn` **keeps** a global refusal, now reading the record's size,
   and its reason names the casting(s). In combat every pending casting is
   still an instant window; IE-041 makes it per-casting.
9. The nesting limit — a Counterspell answered by a Counterspell — **stays
   refused, under its own distinct code**, as an explicit per-casting rule
   rather than a consequence of there being one slot. `casting_pending` is
   left carrying one rule.
10. The `nothing_to_interrupt` exemption in `refusal-sweep.test.ts:127`
    argues its unreachability *from the slot*. Rewrite the reason to argue it
    from the keyed record: the resolver looks the casting up by the forced
    target's caster, so the re-read agrees with the trigger by construction.

### Architecture constraints

Settled by Fable (IE-034) and by the owner; a deviation from any of these is
`ARCHITECTURE_BLOCKED`:

- keyed by casting id; several castings may be pending concurrently; there is
  **no** global "one pending casting prevents another casting" rule;
- one open casting **per caster**, enforced in the reducer as the corrupt-log
  backstop for the command-layer rule;
- the four tests that pin the global refusal are **debt markers to invert**,
  not semantics to preserve;
- **neither frozen log is regenerated.** `spell-declared` already carries the
  record as `event.casting`, so both fold into the keyed record unchanged.

### Acceptance criteria

1. Two creatures hold two castings open at once; each settles by its own id;
   neither refuses the other. A fixture drives Counterspell *against* one of
   them while the other stands.
2. A caster with an open casting is refused a second Magic-action casting, and
   **permitted** a Bonus Action casting and a Reaction.
3. These four tests are **inverted** and say so in their prose:
   `long-casting.test.ts:815`, `:848`, `counterspell.test.ts:641`,
   `ongoing-spells.test.ts:1235`. `long-casting.test.ts:404` and
   `counterspell.test.ts:215` are **kept** (the turn refusal), with the reason
   string naming the casting.
4. `counterspell.test.ts:668` and `:726` (the nesting limit) still refuse,
   under the new distinct code, which is asserted by name.
5. Both frozen logs fold to the same state with no fixture edit;
   `persistence-2.test.ts:174`'s end-state assertion becomes "the record is
   empty"; `scenario.test.ts`'s re-run determinism is untouched.
6. A retried `resolveDeclaredCast` under one command id is a no-op; the same
   id re-used for a **different** casting id is refused, as everywhere else.
7. `refusal-sweep.test.ts`'s exemption reason no longer mentions the slot, and
   every new or changed refusal code is asserted by name.
8. `long-casting.test.ts:318`'s assertion that cannot fail is tidied (same
   file, one line — IE-034's recorded leftover).

### Tests and conformance

The gauntlet, plus both frozen logs and `scenario.test.ts` run explicitly.
CLAUDE.md: rewrite "A Casting Can Be Interrupted"'s "one pending casting, no
stack" and the whole "A casting in process is one engine-wide" paragraph — the
limit it describes is what this removes. The sentence "the reducer branches on
the id, not on 'is anything pending'" was already right and stays.

### Dependencies

None. It is wave 1, and everything else in the casting primitive waits on it.

### Out of scope

The in-combat long casting (IE-041). The Counterspell-on-Counterspell **lift**
— it needs a settle-order rule over the keyed record and is a semantic change;
keep the refusal. Any change to `PendingCasting`'s fields.

### Known risks

Sixteen sites, six command modules and the reducer in one diff. The reducer
sites are already id-shaped or one line from it; the command sites hold the
behaviour that is changing. The guard against a silent miss is the fold: a
site left reading "the" casting fails the two-castings fixture.
