# IE-033 — A Speed an effect changes

state: DONE
lane: mechanism
tranche: 5
parallel-safe: NO — a union task touching `events.ts`, `spell-resolution.ts` and `standing.ts`; runs alone
depends-on: IE-031, IE-032
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

A fifth sourced grant: a Speed an effect changes, read by IE-031's `speedOf`
and ended through the door every other grant already leaves by.

### Why now

`speed-and-movement-modes` blocks 16 spells and **finishes none** — which is
exactly why it needs splitting rather than building whole. The modifier half is
a rule the engine owns and does not have; the modes half (Fly, Spider Climb,
Gaseous Form) is a vocabulary with no reader, which the audit refused twice.
This builds the first and retires its id, leaving `movement-modes` as the
honest remainder.

It is also **the first production writer of `EffectTarget.grants`** — verified
on `main`: `duration.ts:170` declares the member, `:399` reads it in the
reducer, and the only constructions of it anywhere are four in
`granted-defenses.test.ts`. IE-017 built the member for Superior Hunter's
Defense and no runtime path creates one. Ray of Frost does.

### Current relevant architecture

- `packages/engine/src/duration.ts:170` — the `grants` `EffectTarget` member;
  `:399` its reducer case.
- IE-031's `speedOf` in `standing.ts` — the one reader.
- IE-028's `grantSourcesOf` / `withoutGrants` — the enumerator the fifth family
  joins.
- `checkGrantLifetimes` in `spell-schema.ts` — the rule that a casting-owned
  grant must have something that ends it.
- `ModifierRider` — which carries no `lasts` today, because nothing ended a
  grant before its casting did. `EffectTarget.grants` is what changed that.

### Required behaviour

1. A fifth sourced grant on `CreatureState`:
   `{ source, change: add(feet) | halve | zero }`, event
   `speed-modifier-granted`, ended through the existing door. `speedOf` reads
   it in IE-031's decided order.
2. A standalone `speed` effect kind. SRD Longstrider: "The target's Speed
   increases by 10 feet until the spell ends."
3. A `ModifierRider` kind `speed` that **may carry `lasts`**. SRD Ray of Frost:
   "On a hit, it takes 1d8 Cold damage, and its Speed is reduced by 10 feet
   until the start of your next turn." A cantrip is Instantaneous, so the
   casting cannot own the rider — this is what `EffectTarget.grants` exists for,
   and `checkGrantLifetimes` must read it.
4. Hypnotic Pattern's Speed 0 rides its Charmed save. SRD: "While Charmed, the
   creature has the Incapacitated condition and a Speed of 0."

### Architecture constraints

- **The shape id splits.** The modifier the engine now owns retires;
  `movement-modes` keeps Fly, Spider Climb, Gaseous Form and the rest as the
  gap the audit refused to build. Record the split in `SPLIT_BUNDLES` with its
  `[spellId, clause, wentTo]` triples, so the arithmetic is checked — IE-015's
  instrument, and the reason a bundle cannot quietly lose a clause.
- A rider is a **leaf**: it rolls no d20, names no target, spends nothing,
  opens no window. A Speed change qualifies; that is why it may be a rider.
- `halve` and `zero` are **presence, not count** — the reading Resistance and
  Advantage already take, and the order IE-031 fixed.
- Do not add a movement mode. Do not add a `Duration` member.

### Acceptance criteria

1. Longstrider moves from tracked to executed, and its +10 reaches the
   allowance, the Dash and the mounting cost through `speedOf`.
2. Ray of Frost's reduction expires at the start of the caster's next turn,
   with the casting long over — driven end to end, and it is the **first**
   production exercise of the `grants` timer.
3. Hypnotic Pattern's Speed 0 lands on a failed save and lifts with the
   condition; the spell leaves `PARTIAL_SPELLS` on this clause.
4. Two halving effects halve once; a zero beats an add.
5. `checkGrantLifetimes` refuses a `speed` rider on an Instantaneous definition
   that says neither `lasts` nor `outlivesCasting`.
6. The split bundle's arithmetic passes; `npm run coverage` run and committed.
7. Both frozen logs fold unchanged.

### Tests and conformance

`blocked-on.test.ts` checks the split in both directions. Slow stays undefined
on its other clauses and must still be blocked — a shape that empties is
**removed**, not renamed, and if this one empties, remove it.

### Dependencies

**IE-031** (the reader) and **IE-032** (the previous union wave).

### Likely file surface

`events.ts`, `spell-definitions.ts`, `spell-schema.ts`,
`commands/spell-resolution.ts`, `standing.ts`, `duration.ts`,
`scripts/missing-shapes.ts`, `COVERAGE.md`.

### Out of scope

Movement modes. Slow's other clauses. Freedom of Movement, which is condition
immunity and a different shape.

### Known risks

`EffectTarget.grants` has never been exercised by a runtime path. If its
reducer case turns out to assume something only the test fixtures provide, that
is a finding worth reporting rather than working around.


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence** — on a
**foreman-launched confirming review**, after three rounds that each returned
ordinary defects and never a `PASS`. Branch `worktree-agent-a5cb96033d87e4449`,
commit `574d4b4`, rebased to `fcf40cc`. Tests **7276 → 7318 on `main`**, 42 new.
Gauntlet green; `COVERAGE.md` byte-clean, **Longstrider moved tracked →
executed and verified**, 45 tracked / 92 executed / 46 partial / 70 verified,
all derived.

**It is the first production writer of `EffectTarget.grants`** — the member
IE-017 built for Superior Hunter's Defense and nothing had ever created. Ray of
Frost's "until the start of your next turn" on an Instantaneous cantrip is what
finally writes one, and its reducer case turned out to need nothing the
fixtures had been hiding.

Two naming decisions forced by existing invariants and declared: the rider kind
is **`speed-change`, not `speed`**, because `RIDER_KINDS ∩ EFFECT_KINDS = ∅` is
asserted — the same rule that makes `buff`'s rider `bonus`; and `combineSpeed`
gained a `zeroed` parameter, which is the only way to apply zero last as
IE-031's decided order requires.

### Three rounds, no PASS, and the block was procedural

The builder said so itself and was right: all three verdicts recorded
*"Architectural violations: none"*, *"Escalation reason: none"* and
*"Confidence: high"*, and every finding was GREEN — two fixtures that could not
fail for the reason their names gave, then **six stale docstrings the change had
falsified** plus one dead branch. **Round exhaustion is not a failed review**,
so the foreman authorised the confirming pass rather than an escalation Fable
had no question to answer. Same structural gap IE-026 hit three times: *a fix
that closes a review's findings is not itself reviewed.*

The confirming reviewer verified all three round-3 items **by mutation, not by
reading**:

- the six prose corrections each hold against the code they describe, and it
  found **no false sentence and no two that disagree** — including the
  `CLAUDE.md` pair that had contradicted each other fifty lines apart;
- **`grantCarried`'s `case 'speed'` is now live**: mutating it to `return null`
  fails a case that asserts `grant_without_lifetime` **by name**, on a fixture
  built so that nothing short-circuits on `bad_speed_change` first. Round 3
  found that branch dead with all 7,316 tests green;
- the replacement Longstrider sentence is true — `targeting.ts:869` refuses a
  self-target for any definition lacking `targets.self`, and a tracked spell
  reaches `namedTargets`, so the missing flag really was observable.

It then ran four further mutations of its own and re-derived the
`SPLIT_BUNDLES` arithmetic: **16 triples over 16 spells**, reconciling exactly
against the old coverage row, including the two re-filings a hand reading would
miss — Gust of Wind to `difficult-terrain-an-area-creates` (a movement *cost*,
not a Speed) and Haste to `a-speed-an-effect-multiplies`.

## Risk gate

**Inspected**, across the escalation and the merge: the `GameEvent` union gains
a member, `CreatureState` gains a fifth grant family, and `EffectTarget.grants`
is exercised by a runtime path for the first time.

The derived `GrantFamily` guard IE-028 built **forced the one edit** that adds
the family to the enumerator — which is that guard doing exactly what it was
built for, one tranche later. `speedModifiers` is sorted by source in the
reducer, so serialised state is order-independent. Both frozen logs and
`scenario.test.ts` were run explicitly — 53 tests — with an empty fixture diff.

Classification: **GREEN**.

### One behaviour narrowing, carried to the owner rather than decided

**Ray of Frost is now refused outside combat**, because its rider is
turn-anchored and a turn-anchored duration outside combat is refused rather
than approximated. The confirming reviewer's independent read is the best
statement of why it is both right and worth raising:

> It is correct — inventing six seconds is the thing the engine exists not to
> do, a grant with no deadline is what `checkGrantLifetimes` refuses, and
> silently skipping the rider is a rule dropped with no `unverified` line to
> say so. **What makes it worth mentioning is that this is the first time the
> refusal reaches a cantrip, and the shape of the cost inverts.** Color Spray's
> whole printed content *is* the rider, so refusing it out of combat denies
> nothing a player wanted. Ray of Frost's primary content is 1d8 Cold damage
> and the slow is incidental — so the refusal denies the player the part they
> asked for in order to protect the part they did not, and a human DM would
> simply not do that.

**The honest fix is a `RiderDuration` member for a moment that does not exist
outside combat — the same missing `Duration` member Superior Hunter's Defense
wants** — in a task of its own, and nothing in this diff. Recorded in
`QUEUE.md` for the owner and for the next tranche.

## Architecture decision

None. No Fable involvement — the confirming pass was procedural, and the
builder's own judgement that it was procedural rather than architectural is
what kept a third escalation off Fable's desk tonight.

## Merge record

Merged to `main` as `fcf40cc`, fast-forward, pushed. Rebased by the foreman;
the confirming reviewer had checked in advance that everything `main` added over
the merge base was confined to `PROGRESS.md`, `QUEUE.md` and two task files,
none of which this branch touches.

`main` verified after the merge: typecheck ✓, lint ✓, **7318 tests across 113
files** ✓, both frozen logs and the scenario determinism explicitly ✓,
`COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief, all seven acceptance criteria met;
**2** `COMPLETE`; **3** `PASS` at high confidence **on the commit merged** —
the condition three rounds failed for a procedural reason; **4** every defect
resolved and each fix verified by mutation; **5** gauntlet green; **6**
conformance, every number derived; **7** no blocker — the escalation was
procedural and the foreman answered it; **8** no deviation, two forced naming
decisions declared; **9** the primitives are the brief's; **10** files outside
the surface are the guards' own consequences; **11** clean rebase; **12**
re-verified on `main`; **13** risk gate inspected, GREEN.

**Wave 5 complete. Unblocks IE-034.**
