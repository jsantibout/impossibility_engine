# IE-020 — A held casting keeps the facts its caster stated

state: DONE
lane: mechanism
tranche: 5
parallel-safe: CONDITIONAL — owns `events.ts` and `commands/spell-resolution.ts` for wave 1; safe beside every conformance and tooling task in that wave
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

A casting declared with `hold: true` must settle with the damage type and the
unaffected list its caster stated at the declaration, exactly as the atomic
path already does. Today both are silently dropped.

### Why now

**This is a shipped correctness gap and it is the exact failure the feature it
breaks was built to prevent.** IE-014's builder found it: `PendingCasting`
carries no `damageType` and no `unaffected`, so a Spirit Guardians declared
Necrotic settles Radiant — against an Undead that is immune to one and not the
other — and a creature the caster designated unaffected is caught anyway.
`CLAUDE.md` states the rule it violates in two places: "Picking Radiant because
most clerics are good is where a Necrotic-immune Undead finds the engine out",
and "a Dispel Magic aimed at that goblin must not put the Cleric's weapon out"
is the same class of silent wrong answer.

It is wave 1's mechanism task because everything else in the chain builds on
`PendingCasting` and on the settlement path, and because a correctness gap
outranks every capability behind it.

### Current relevant architecture

- `PendingCasting`, `packages/engine/src/events.ts:486` — the declaration
  record. It already pins `targets`, `origin` and `area` for exactly this
  reason: "settlement takes no fresh request, so a Spiritual Weapon declared
  beside the goblins cannot settle beside the party."
- `resolveOnTargets`, `packages/engine/src/commands/spell-resolution.ts:472` —
  the atomic path. `ongoingWith()` at :499 writes `unaffected` (sorted, absent
  when empty) and `damageType` onto the ongoing record at :513–517; the effects
  themselves are substituted at :531 by
  `statedDamageType(definition.effects, request.damageType)`.
- `resolveDeclaredCast`, `packages/engine/src/commands/spell-resolution.ts:143`
  — the settlement. **It does not call `resolveOnTargets`**; it calls
  `resolveEffects` directly at :186 and builds its own `becomesOngoing` at
  :194–213 from `pending` alone. Neither stated fact is in `pending`, so
  neither reaches the record or the effects.
- The declaration writes `spell-declared` at
  `packages/engine/src/commands/casting.ts:520`.
- The readers that then go wrong: `events.ts:2727` filters the spared
  creatures out of a carried area, and `commands/turns.ts:539` substitutes the
  stated type into an area trigger's effects.
- `statedDamageType` and the definition's `damageTypeStated` are validated at
  `packages/engine/src/spell-schema.ts:1064`.

### Required behaviour

SRD Spirit Guardians: "When you cast this spell, you can designate creatures to
be unaffected by it." And: "3d8 Radiant damage (if you are good or neutral) or
3d8 Necrotic damage (if you are evil)." SRD Protection from Energy:
"Resistance to one damage type of your choice: Acid, Cold, Fire, Lightning, or
Thunder."

A casting states these once, at the casting. Whether that casting is settled in
one breath or held open for a Counterspell changes nothing about what the
caster said.

1. `PendingCasting` gains `readonly damageType?: string` and
   `readonly unaffected?: readonly CharacterId[]`, both optional.
2. The declaration writes them from the request it validated, with the same
   normalisation the atomic path uses — `unaffected` sorted, and absent rather
   than empty, so two declarations that mean the same thing fold to the same
   bytes.
3. Settlement reads them off `pending` and passes them on exactly as
   `resolveOnTargets` does: the effects through `statedDamageType`, and both
   fields onto the `becomesOngoing` plan.
4. Validation of both facts stays where it is — at the declaration, where
   refusing still costs nothing. Settlement re-validates neither, because
   settlement takes no fresh request.

### Architecture constraints

- **Optional fields, so both frozen logs fold unchanged.** A declaration
  written before this exists has neither field and means what it always meant.
  Never regenerate `golden-log.json` or `golden-log-2.json`.
- **No second normalisation.** If the sort and the empty-list elision are
  written twice they will disagree; extract or share the one the atomic path
  already performs.
- The settlement path keeps calling `resolveEffects`. Do **not** refactor
  settlement to go through `resolveOnTargets` — that is IE-027's file and a
  different change.
- A declaration whose spell does not print either clause is still refused at
  declaration by the existing guards (`targeting.ts:332` for `unaffected`,
  `:348` for the stated type). Do not move or duplicate those.

### Acceptance criteria

1. **Reproduce first**, and watch each fail for the right reason:
   - hold Spirit Guardians with `damageType: 'necrotic'` and one designated
     creature; settle; assert the area trigger's damage is Necrotic and the
     designated creature takes none.
   - hold Protection from Energy with `damageType: 'cold'`; settle; assert the
     granted Resistance is to Cold.
2. The same two spells cast atomically produce the same stated facts — the
   comparison that says the two paths agree.
3. A held casting that states nothing settles byte-identically to today.
4. Both frozen logs fold unchanged; `persistence.test.ts` and
   `persistence-2.test.ts` untouched.
5. `npm test`, `npm run typecheck`, `npm run lint` green; `npm run coverage`
   run and committed if anything it reads changed.

### Tests and conformance

New cases in the file that owns declared castings
(`packages/engine/src/counterspell.test.ts` holds the hold/settle fixtures; a
new file is fine if it is clearer). The mutation that must redden them:
delete either field from the settlement's plan.

### Dependencies

None. First mechanism task of the tranche.

### Likely file surface

`packages/engine/src/events.ts` (the record), `commands/casting.ts` (the
write), `commands/spell-resolution.ts` (the read), and one test file.

### Out of scope

Splitting `resolveEffects` (IE-027). Any change to how the two facts are
validated. Any new stated fact — IE-030 adds the third.

### Known risks

`PendingCasting` is folded by `ongoing-compatibility.ts:77`'s neighbour for the
*ongoing* record; check whether a pending record has a parallel upgrade path
before adding a field, and if it does, absent must keep meaning absent.


## Completion digest

Builder: **COMPLETE**. Reviewer: **PASS**, two rounds, confidence **high**.
Branch `worktree-agent-a720a755b59ce0aff`, commit `dbda54e`, built on base
`8cae095` and rebased by the foreman to `687331c`.

Tests **6712 passing / 6712**, 13 new in one new file,
`packages/engine/src/held-casting-facts.test.ts`. Gauntlet: typecheck ✓ lint ✓
test ✓ coverage diff ✓. Conformance PASS — `COVERAGE.md` regenerated and
unchanged, no spell definition or adjudication touched.

**Two mutations, reddening disjoint sets**, which is the evidence both halves
of the fix are load-bearing rather than one covering for the other:

- deleting `...stated` from the settlement's `becomesOngoing` plan reddened 8
  cases, including a Radiant-immune creature taking nothing from a casting
  declared Necrotic, and the designated creature caught anyway;
- replacing the settlement's `effects: statedDamageType(...)` with
  `definition.effects` reddened the other 2 — Protection from Energy granting
  Acid rather than the declared Cold.

Architectural deviations: **none**. New runtime special cases: **none**.

Foundational primitives touched: `events.ts` (`PendingCasting` gains two
optional fields — no reducer change, no new event type or union member);
`commands/casting.ts` (`CastingPlan` and the `spell-declared` write);
`commands/spell-resolution.ts` (the settlement read, plus one module-private
helper `statedFacts`). All three named in the brief's file surface.

Files outside that surface: `CLAUDE.md`, one paragraph in "A Casting Can Be
Interrupted", beside the "Settlement takes no fresh request" paragraph it
extends.

**Out-of-scope finding, not acted on:** the baseline `npm test` on arrival had
one failure — `persistence-2.test.ts`'s "round-trips at every prefix of the
log" timed out at 30s under the load of three concurrent builders. It passes
alone in ~13s and passed in every subsequent full run. The 30s budget was
chosen before three builders ran in parallel on one machine. Recorded in
`QUEUE.md` under LATER.

**Unresolved concern, declared by the builder:** a prose imprecision in its
`CLAUDE.md` paragraph — "one function, three call sites", where there are two
calls serving three readers. The reviewer saw it and declined to spend a third
round on one word.

Reviewer's own verdict, abridged: all five acceptance criteria met; both fields
optional; settlement still calls `resolveEffects` and was **not** refactored
through `resolveOnTargets` (IE-027's file); `targeting.ts:332/:348` untouched;
both frozen logs and both persistence suites unmodified and passing; key
insertion order on the ongoing record matches between the atomic and held
paths, so two records meaning the same thing serialise the same. No defects, no
escalation.

## Risk gate

**Inspected** — one risk signal: a foundational primitive changed
(`PendingCasting`, the payload of the `spell-declared` member of the
`GameEvent` union). The brief named `events.ts`, so condition 9 holds on its
face; the gate inspects because the signal is present, not because the digest
was suspect.

What the diff shows, read at `main...worktree-agent-a720a755b59ce0aff`:

- **Two optional fields, no reducer change, no new event type or union
  member.** `spell-declared` stores `event.casting` verbatim, so a declaration
  written before this has neither field and folds to exactly the state it
  always did. No upgrade path is needed and none was added — correctly:
  `upgradeOngoing` fills an *ongoing* record, and this is a pending one.
- **One normalisation, not two.** `statedFacts` **replaces** the inline sort
  and empty-list elision on the atomic path rather than sitting beside it, and
  is idempotent so the settlement can call it on an already-normalised record.
  The brief's "no second normalisation" constraint is met in the strong form —
  the old path was removed, not duplicated.
- **Key insertion order preserved** (`unaffected`, then `damageType`, spread
  last in both plans), so the atomic and held paths serialise identically and
  no existing log's bytes move.
- **The second substitution is the one that would have rotted**, and it is
  pinned separately: the stated type reaches the casting's own `effects`
  through `statedDamageType`, not only the ongoing record, because Protection
  from Energy states its type for an effect that lands at the cast.

Classification: **GREEN**. Merged under tranche 5 authority.

**One integration change by the foreman, recorded rather than silent.** The
builder declared a prose imprecision in its `CLAUDE.md` paragraph — "one
function, three call sites", where there are two calls serving three readers.
Corrected at integration to "one function, three **readers**", which is what
`statedFacts`' own docstring says, so the constitutional file and the code
agree word for word. Committed separately from the merge, so the reviewed
commit stands as reviewed.

## Architecture decision

None. No Fable involvement; GREEN throughout.

## Merge record

Merged to `main` as `687331c`, fast-forward, pushed to `origin/main`. Rebased
by the foreman over `a38ca78` (a docs-only commit, no conflict) before the
merge. Worktree retired and branch deleted.

`main` verified **after** the merge rather than only in the worktree:
`npm run typecheck` ✓, `npm run lint` ✓, `npm test` **6712 passing across 104
files** ✓, `npm run coverage` with `git diff --exit-code COVERAGE.md` ✓
byte-clean, working tree clean.

The thirteen conditions, asserted by name:

1. **Inside the brief** — four source files, all named in its surface.
2. **Builder `COMPLETE`** — yes.
3. **Independent reviewer `PASS`, confidence high** — yes, two rounds.
4. **Defects resolved** — none outstanding; round 2 raised none.
5. **Gauntlet in the worktree** — all five steps ✓.
6. **Conformance** — `COVERAGE.md` regenerated and byte-clean; no spell
   definition or adjudication touched, so no honesty or tracking claim moved.
7. **No architecture blocker** — none raised.
8. **No material deviation** — none declared, none found on inspection.
9. **Foundational primitives named by the brief** — nothing unannounced, no
   change to who owns any state, no new event type, no fold change.
10. **No scope expansion** — `CLAUDE.md` is the standing convention for a
    mechanism change and is declared with the section it extends.
11. **No non-mechanical conflict** — the rebase was clean.
12. **Integration still valid** — the base moved by one `docs/dev/` commit,
    which can change no assumption the review rested on, and the full gauntlet
    was re-run on `main` after the merge.
13. **Risk gate passed** — inspected, GREEN, above.

**Unblocks IE-027 and IE-028**, both launched on the merged `main`.
