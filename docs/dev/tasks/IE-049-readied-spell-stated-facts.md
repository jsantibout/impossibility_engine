# IE-049 — A readied spell can state a stated fact

state: IMPLEMENTING
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `state.ts` (the readied type), `commands/actions.ts`; optional slot, launched only if the window allows
depends-on: IE-039
worker: qb-builder in .claude/worktrees/agent-a2da98ccb6ea767bb, branch worktree-agent-a2da98ccb6ea767bb
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: none

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
