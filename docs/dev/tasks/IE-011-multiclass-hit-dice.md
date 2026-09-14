# IE-011 — Multiclass Hit Dice: call the function that is already right

state: DONE
lane: mechanism
tranche: 4
parallel-safe: YES — `creation.ts` and `multiclass.ts`, touching no spell, no event type, no fold and no command module
depends-on: none
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 4"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 4" (tranche 4 authority; 13/13 conditions green)

## Brief

### Objective

Make `poolsFor` declare the Hit Dice pools a multiclassed character actually
has, by calling `hitDicePools` — which is correct, tested against both SRD
worked examples, and called by nothing.

### Why now

**A wrong number, shipped and reachable.** `poolsFor` (`creation.ts:2439`)
declares exactly one Hit Die pool, from the *starting* class, sized at the
character's total level. So a Paladin 4 / Fighter 1 has four d10 and **no d8
at all**, and a Cleric/Paladin gets no d8 either.

This is the foreman's own rule from IE-008 applied to a finding IE-008 made:
*a silently wrong number outranks a new capability.* It was queued to `LATER`
at the time because IE-008's brief forbade touching pool sizing and no task
joins an approved roster. The fourth whole-engine audit (§3.6) re-confirmed it
and puts it in tranche 4.

**It is also the eleventh recorded instance of this repository's most
persistent finding** — a pure function that is correct, tested and unreachable.
`hitDicePools` (`multiclass.ts:142`) has been right since it was written;
`multiclass.test.ts:203` drives it against both of the SRD's worked examples.
Nothing calls it.

### Current relevant architecture

- `hitDicePools` (`multiclass.ts:142`) — the correct derivation, "Hit Dice pool
  by die type", with its tests at `multiclass.test.ts:203`.
- `poolsFor` (`creation.ts:2439`) — the shared derivation IE-008 extracted, and
  the single place both creation and advancement now get their pools. Its first
  entry is the single Hit Die pool this task replaces.
- `hitDieKey`, and `CLAUDE.md`'s Multiclassing section, which **claims the
  implemented behaviour** and must be corrected: "Hit Dice pool by die type" is
  described there as though it were reached.
- `resource-pool-declared` and `resource-pool-resized` already carry
  everything needed; IE-008's declare-or-resize loop at advancement reads
  whatever `poolsFor` returns, so advancement follows for free.

### Required behaviour

1. `poolsFor` returns one Hit Die pool **per die type** the character's classes
   grant, each sized by the number of levels in classes using that die.
2. Advancement follows with no change of its own: a character who levels into
   a second class with a different die gains that pool through IE-008's
   existing declare-or-resize loop, and one who levels in a class they already
   have grows the existing pool. Spent is untouched, as now.
3. A single-class character's pools are **byte-identical** to today's — same
   key, same label, same maximum, same `recovers`. This is the whole
   compatibility story and both frozen logs depend on it.

### Architecture constraints

- Do not reimplement the derivation. `hitDicePools` is the function; call it.
  If its signature does not fit `poolsFor`'s caller, adapt at the call site.
- No new event type, no change to `events.ts`, the reducer or the fold.
- Both frozen logs must fold unchanged. Their characters are single-class, so
  item 3 is what protects them — assert it directly rather than relying on it.
- Do not change any class table or `poolSizeOf`.

### Acceptance criteria

1. A failing test first: a Paladin 4 / Fighter 1 has a d10 pool of 4 and a d8
   pool of 1. It must fail on `main` for the right reason — one pool, wrong
   size.
2. Advancement into a second class with a different die declares the new pool;
   advancement within an existing class resizes it; spent is preserved across
   both, asserted.
3. A single-class character's declared pools are asserted byte-identical to
   the current output.
4. Both frozen logs fold to the state they have always folded to.
5. `CLAUDE.md`'s Multiclassing section says what the code now does.
6. The whole gauntlet passes; `COVERAGE.md` regenerated.

### Tests and conformance

`class-pools.test.ts` and the advancement tests beside it; `multiclass.test.ts`
keeps its existing assertions on `hitDicePools` unchanged — they are what makes
this a call rather than a rewrite.

### Dependencies

None. IE-008 (`601774c`) built the shared derivation this edits, and is merged.

### Likely file surface

`packages/engine/src/creation.ts`, `packages/engine/src/multiclass.ts` (only if
the signature needs adapting), `class-pools.test.ts`, `CLAUDE.md`.

### Out of scope

Per-class spell preparation; anything else in the multiclass rules; the other
dead functions the audit lists (`spellOfSource`, `pendingDamageOf`,
`pendingTestOf`) — each needs its own evidence.

### Known risks

- A character with two classes sharing a die type must get **one** pool of the
  combined level, not two pools or one of the wrong size. That is the case
  `hitDicePools` already handles and the fixture should pin.

## Completion digest

```
IE-011 — Completion digest
Approved architectural intent: Make `poolsFor` declare the Hit Dice pools a multiclassed character actually has, by calling `hitDicePools` — which is correct, tested against both SRD worked examples, and called by nothing. Do not reimplement the derivation.
Builder: COMPLETE
Worktree: .claude/worktrees/agent-a2f4e1019f7a6f93a   Branch: worktree-agent-a2f4e1019f7a6f93a   Commit: ebc5acb (rebased by the foreman to ded4e71)   Rebased on main at: not rebased by the builder, per the wave-1 launch instruction; built on base 4b22823
Opus review: PASS — rounds: 1
Tests: 5583 passing / 5583 total; new tests: 5; mutation run: two, each failing all four multiclass tests — (a) sizing every pool at `choices.level` instead of the counted levels, (b) passing only `classLevelsOf(choices).slice(0, 1)` to `hitDicePools`. Reverted both. Before implementation all five new tests failed for the right reason: `{d10: 4}` where `{d10: 4, d12: 1}` and `{d10: 5}` were owed — one pool, wrong size — and no hit-die pool declared or resized at advancement.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — COVERAGE.md regenerated, `git diff --exit-code COVERAGE.md` clean. SRD lines quoted beside every number, in the docstring and the tests.
Architectural deviations: one, declared. The brief's acceptance criterion 1 asks for a Paladin 4 / Fighter 1 to have a d10 pool of 4 and a d8 pool of 1. SRD `classes.md` prints D10 for both classes, so that pair pools into five d10 and has no d8. I implemented Required Behaviour item 1 as written and covered both shapes with discriminating fixtures (Fighter 4 / Barbarian 1 for differing dice; Paladin 4 / Fighter 1 for the shared die). No design change — the derivation called is the one the brief names.
Foundational primitives touched: resource-pool declaration at creation and advancement — `poolsFor` and `poolEvents` in `creation.ts`, both private, signatures narrowed by dropping `definition`. These declarations reach the event log, which is why single-class byte-identity is asserted directly. No event type, reducer, fold, or command module changed.
New runtime special cases: none
Files outside the brief's surface: none — `creation.ts`, `class-pools.test.ts`, `CLAUDE.md`; `multiclass.ts` needed no signature adaptation
Out-of-scope findings (not acted on): the baseline `npm test` on a fresh worktree showed one failure in `persistence-2.test.ts` ("round-trips at every prefix of the log", 5876ms against a 5000ms limit). It passes in isolation and passed in every subsequent full run; it is vitest's default 5s timeout under load from three concurrent builders, not a logic failure. If CI ever runs builders concurrently, that test is the one that will flake first.
Unresolved concerns: none
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

The reviewer's verdict was `PASS` at high confidence with no defects, at the
first round. Its fixture analysis is the part worth keeping: the shared-die
case kills a starting-class-only mutation's plausible cousin, the
differing-die case kills a naive total-level mutation, and the single-class
case plus the pre-existing exact-ordered-declaration guard is what protects
the frozen logs.

## Risk gate

**The signal was a declared deviation against an acceptance criterion, and
the criterion was wrong.** Checked directly against the SRD rather than taken
on either party's word: `packages/srd/raw/classes.md:4591` prints "D10 per
Fighter level" and `:5302` prints "D10 per Paladin level". A Paladin 4 /
Fighter 1 therefore pools into **five d10 and no d8**. The brief's acceptance
criterion 1 asked for a d10 pool of 4 and a d8 pool of 1, which is not the
SRD's answer.

**That is a foreman error, and a worse one than the two before it.** IE-008's
brief undercounted the pool kinds and IE-001's file surface was stale; both
were inventories that the work had overtaken. This one is different in kind:
**a D&D rules fact asserted from memory, in a brief, in a repository whose
central discipline is that rules are checked against the SRD text and never
recalled.** `CLAUDE.md` opens its rules section with exactly that sentence.
The builder caught it, said so plainly, implemented the *required behaviour*
rather than the mistaken example, and pinned both shapes — differing dice and
shared die — rather than the one the brief named.

GREEN on the work. The lesson is recorded in `QUEUE.md` rather than here: a
brief may not assert a rules fact without quoting the SRD line it came from,
which is what every definition in the catalogue is already held to.

Nothing else signalled: no new event type, no reducer or fold change, no
command module, no special case, reviewer PASS at the first round.

## Merge record

Merged to `main` as `ded4e71`, fast-forward, pushed. Worktree retired and
branch deleted. Rebased by the foreman over the wave-1 launch commit, which
is `docs/dev/` only — conflict-free.

The thirteen conditions, asserted by name:

1. **Inside the brief** — yes; three files, all on its named surface, and
   `multiclass.ts` was not even needed.
2. **Builder COMPLETE** — yes.
3. **Independent reviewer PASS, confidence high** — yes, first round, no
   defects.
4. **Defects resolved** — none were raised.
5. **Gauntlet in the worktree** — typecheck ✓ lint ✓ test 5583/5583 ✓
   coverage ✓ `git diff --exit-code COVERAGE.md` ✓.
6. **Conformance** — `COVERAGE.md` byte-clean; SRD lines quoted beside every
   number, in the docstring and in the tests.
7. **No unresolved architecture blocker** — none.
8. **No material deviation** — one declared, and it is the brief that was
   wrong rather than the implementation. The derivation called is the one the
   brief names.
9. **No unexpected authority-boundary or foundational-state change** — pool
   declaration changed what creation and advancement *emit*, not how anything
   folds; no event type, reducer, fold or command module moved.
10. **No meaningful scope expansion** — none.
11. **No non-mechanical merge conflict** — none.
12. **Integration did not invalidate the review** — full gauntlet re-run on
    `main` after the fast-forward: typecheck ✓ lint ✓ test 5583/5583 ✓
    coverage byte-clean ✓, both frozen fixtures untouched.
13. **Risk gate** — GREEN, above.

Verified on `main` at `ded4e71` and pushed to `origin/main`.

**Wave 2 is not launched by this merge.** IE-011 has no dependants; IE-014
waits on IE-010 and IE-016 on IE-012, both still building.
