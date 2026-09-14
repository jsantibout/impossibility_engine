# IE-049 — A readied spell can state a stated fact

state: DONE
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `state.ts` (the readied type), `commands/actions.ts`; optional slot, launched only if the window allows
depends-on: IE-039
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Let a readied casting carry the four facts a casting states, so that a spell
which *requires* one can be readied at all.

### Why now

`ReadiedResponse` (verified at `events.ts:817`) carries a spell id, a casting
id and a level — and nothing else. Four facts a casting must state have no
place on it, so **the three Dominates cannot be readied**: `fought` is
required by the spell and refused as missing before the Ready is taken. It is
the correctness leftover IE-035 named and the audit recorded as C4, and it is
the smallest real correctness gap in the queue.

### Current relevant architecture

- `events.ts:817` `ReadiedResponse`, `:855` the response on its event — after
  IE-039 these live in `state.ts`.
- `commands/actions.ts` — `holdSpell` and the Ready action.
- `declaredFacts` / `statedFacts` — the one validation and the one
  normalisation the atomic cast, the declaration and the settlement all share.
  IE-020's rule: **whether a casting is settled in one breath or held open
  changes nothing about what the caster said.** A readied casting is the third
  door into the same sentence.
- The four facts: `damageType`, `fought`, `unaffected`, `teleportTo`.

### Required behaviour

1. `ReadiedResponse`'s spell arm carries the stated facts the request carried.
   Every field is **optional and absent-means-absent**, so every readied spell
   in every existing log means exactly what it meant and neither frozen log
   changes.
2. `holdSpell` validates them **through `declaredFacts`**, exactly as a casting
   does — not a second copy of the four validators. A spell that prints the
   clause and a Ready that says nothing is refused with the same code; a spell
   that prints none and is told the fact is refused with the same code.
3. The release path applies them exactly as the settlement does, through
   `statedFacts`, so a readied Spirit Guardians spares who it said it would.
4. The three Dominates become readiable, driven end to end.

### Architecture constraints

- one validator, one normaliser, three doors — no second spelling of any of
  the four rules;
- absent means absent; no field gains a default.

### Acceptance criteria

1. Dominate Person is readied with `fought` stated, released on the trigger,
   and the save carries the Advantage the fact gives — asserted on the roll's
   `modeSources`, not on the outcome.
2. Readying it **without** the fact is refused, and readying a spell that
   prints no such clause **with** it is refused; both codes asserted by name.
3. A readied Misty Step carries its `teleportTo` and lands where it said.
4. Both frozen logs fold unchanged.
5. `refusal-sweep.test.ts` green in both directions.

### Tests and conformance

The gauntlet. CLAUDE.md: the stated-facts paragraphs gain the third door.
`missing-shapes.ts` re-read for any entry blocked only on this.

### Dependencies

IE-039 (the type moves). It is the **optional slot**: the foreman launches it
only if the window allows after wave 4, and defers it otherwise — a deferral,
not a withdrawal, exactly as IE-036 was.

### Out of scope

A fifth stated fact, and generalising the stated-fact plumbing — the audit
defers that until Hex's chosen ability is briefed, and that is the right
moment for it.

### Known risks

Low. The only trap is duplicating a validator instead of reusing
`declaredFacts`, which a mutation emptying that function must catch on the
readied path as well as the other two.

## Completion digest

```
IE-049 — Completion digest
Builder: COMPLETE
Commit: d597c2b (replayed onto main as 12adff7)   Branch: worktree-agent-a2da98ccb6ea767bb
Opus review: PASS — rounds: 2, confidence high, no defects
Tests: 7953 / 7953 on the branch (baseline 7936); new: 17. On main after the replay: 8331
  across 118 files.
Mutations, all four biting and all reverted clean:
  (1) declaredFacts returning ok(null) immediately — reddens the seven readied refusal cases
      beside being-fought.test.ts's four and teleport.test.ts's two, which is the reuse proof
      the brief asked for;
  (2) dropping ...statedOf(response) from the release — reddens eight cases, every one
      reporting the wedged hold itself;
  (3) dropping damageType from statedOf — reddens the Ready refusal and both Spirit Guardians
      cases;
  (4) dropping unaffected from the release — the aura owes an effect it should have spared.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓; both frozen logs run explicitly and
  separately, 29/29, neither fixture touched.
Conformance: PASS — COVERAGE.md byte-clean, no definition touched, no new refusal code.
Architectural deviations: one, declared — acceptance criterion 3 names Misty Step, which
  SRD 5.2.1 casts with a Bonus Action against Ready's "a casting time of an action", so it
  cannot be readied at all. The readied teleport is driven through Dimension Door and Misty
  Step's not_readiable refusal is pinned as its own case.
Foundational primitives touched: ReadiedResponse in state.ts (four optional fields on the
  spell arm — a persisted record the fold stores verbatim, absent-means-absent, no upgrade
  path); ReadyResponse, holdSpell and releaseSpell in commands/actions.ts. No change to the
  GameEvent union, to fold/, or to commands/spell-resolution.ts — IE-041's surface,
  deliberately untouched.
New runtime special cases: none.
Files outside the brief's surface: none.
Out-of-scope findings: the four optional fields are declared twice — StatedFacts in
  commands/actions.ts and inline on ReadiedResponse in state.ts. TypeScript does not
  excess-property-check spread properties, so a fifth fact added to one and not the other
  would be silently carried or silently dropped. The two sets are exactly equal today.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

**Inspected on the two signals that matter**: a persisted state record gained
fields, and the brief's premise turned out to be wrong.

**The declared deviation is mine, and the builder was right.** Acceptance
criterion 3 named **Misty Step** as the readied-teleport fixture. SRD 5.2.1
casts Misty Step with a **Bonus Action**, and Ready requires "a spell must have
a casting time of an action" — so it cannot be readied at all, and my criterion
asked for a case the rules forbid. The builder drove the readied teleport
through **Dimension Door** instead and pinned Misty Step's `not_readiable`
refusal as a case of its own, which discharges the criterion's intent and proves
its letter false. That is this repository's own precedent — *when the brief and
the paragraph disagree, the paragraph wins* — so it follows established
architecture rather than inventing any. **Sixth brief line this tranche
corrected by somebody reading the source.**

**The premise about the old failure was wrong in the direction that makes the
task worth more, not less.** The brief said the three Dominates were "refused on
the readied path". They were not: `holdSpell` asked `declaredFacts` nowhere and
`castSpell` never sees a definition, so **the Ready succeeded and spent the
action and the slot**, and every release then came back `fought_fact_required`
until the hold's own deadline lifted it. A wedged hold that consumed resources
and could never be released is a worse bug than a refusal, and the builder's own
pre-implementation run is the evidence. Both `CLAUDE.md` and the test docstring
record that rather than the softer version I wrote.

**The absent-means-absent claim was checked rather than asserted.** Both frozen
logs fold unchanged and were run separately; the one frozen readied-spell
response carries none of the new fields.

**Reuse, not re-implementation, is proved by mutation (1)**: emptying
`declaredFacts` reddens the readied path *and* the two doors that already used
it. That is the one thing this task could have got wrong by writing a second
copy of four rules, and it is the mutation the brief demanded.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement.

## Merge record

Replayed onto `main` as `12adff7`; `CLAUDE.md` auto-merged, nothing else
overlapped.

`main` verified **after** the merge: typecheck ✓, lint ✓, **8,331 tests across
118 files** ✓, both frozen logs and the scenario determinism explicitly ✓ (53
tests), `COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence; **4** no defects; **5** gauntlet green; **6** conformance
green; **7** no blocker; **8** one deviation, **declared**, and it is a
correction of the brief against the SRD rather than a departure from approved
architecture; **9** the primitives are the brief's own; **10** no file outside
the surface; **11** integration valid; **12** re-verified on `main`; **13** risk
gate inspected, GREEN.

**This was the optional slot**, taken because a slot genuinely existed rather
than because scope grew, and it closes the correctness leftover IE-035 named.
