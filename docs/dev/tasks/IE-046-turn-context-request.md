# IE-046 — A turn-anchored rider outside combat asks for turn context

state: DONE
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `packages/shared/src/result.ts`, `commands/spell-resolution.ts`, `commands/conditions.ts`, `commands/casting.ts`; not beside IE-038, IE-041, IE-042 or IE-048
depends-on: IE-038, IE-043
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: 2026-09-14 — "APPROVE TRANCHE 6."

## Brief

### Objective

Convert the command-layer refusal a turn-anchored rider gives outside combat
into a `needs-context` request for turn context, so the caller establishes the
turn timeline and casts again.

### Why now

**This is an owner decision, taken 2026-09-14**, and it is the disposition of
the one RED the audit named:

> A rule such as Ray of Frost's "until the start of your next turn" requires an
> actual turn timeline. Outside combat there is no turn whose start can define
> that duration. Do not silently convert that duration to six seconds and do
> not have the engine invent combat fiction. Return/request the required
> combat/turn context so the caller/Maestro can establish the appropriate
> scene/initiative state. Once turn context exists, adjudicate normally.

The engine today refuses `no_turns`, which is honest and useless: a cantrip
that cannot be cast in a corridor is a hole the layer above cannot repair,
because the refusal does not say what would repair it. This is exactly the
three-state discipline the engine already has — the rules say no, the record is
thin, or fine — applied to a fact that is thin rather than forbidden.

### Current relevant architecture

- `duration.ts:91` — the **only** `no_turns` site in the engine:
  `resolveDuration` refusing a turn-anchored duration outside combat. It is a
  pure helper and keeps returning a bare refusal.
- `commands/spell-resolution.ts:389` — `riderDurations` in `castOrRelease`'s
  pre-flight, before the slot and the first die. This is the Ray of Frost path.
- `commands/casting.ts:616` and `:628` — the casting's own Duration resolved,
  with the comment recording that refusing outside combat still costs nothing.
- `commands/conditions.ts:141` — the same refusal reaching a caller of
  `applyConditionTo`.
- `packages/shared/src/result.ts:43` — `ContextRequest`, six kinds today:
  `creature`, `position`, `visibility`, `creature-type`, `scene`, `route`.
- `commands.ts` publishes **`beginCombat`** (not `startCombat`) and
  `rollInitiativeFor` — verified; IE-026's sweep requires `satisfyWith` to name
  a published barrel command.

### Required behaviour

1. A seventh `ContextRequest.kind`: `turn-order`. `subject` is the creature the
   turn-anchored moment is about (the rider's anchor); `need` says a turn
   timeline is missing; `because` quotes the printed rule ("until the start of
   your next turn"); `satisfyWith` names **`beginCombat`** — and
   `rollInitiativeFor` where the fight exists and the anchor is not in the
   order, which is the second, distinct thin record.
2. **Every command-layer site that turns a `no_turns` into a caller-visible
   refusal** raises the request instead. Enumerate them from the source rather
   than from this list — the three named above are what was found on `main`,
   and the builder must sweep for the rest and say in the digest what it found.
3. `resolveDuration` is **unchanged**: a pure helper returns the bare refusal,
   and the command that knows which rule wanted the fact attaches the request.
   That is the rule CLAUDE.md already states for every other request kind.
4. **Nothing is spent.** The request is raised in the pre-flight, before the
   slot, the action and the first die — which is where `riderDurations` already
   sits, deliberately.
5. Once the turn context exists, the same casting resolves normally with no
   further change — asserted, not assumed.
6. The member IE-043 adds is covered by the same conversion; its own refusal
   behaviour is unchanged at the pure layer.
7. The anchor that is **not in the Initiative order** during a fight is a
   distinct request (satisfied by `rollInitiativeFor`), not the same one.

### Architecture constraints

Settled by the owner; a deviation is `ARCHITECTURE_BLOCKED`:

- **no conversion of a turn-anchored duration to seconds, anywhere, ever**;
- the engine does not start combat, roll Initiative, or invent an order —
  it asks;
- the request is addressed to the orchestrator and never to a player, like
  every other `needs-context`.

### Acceptance criteria

1. Ray of Frost cast outside combat returns `needs-context` carrying a
   `turn-order` request naming `beginCombat`, with **no slot spent, no die
   thrown and no state change** — asserted on the state, not only on the
   `Result`.
2. `beginCombat` is then called and the same casting resolves, the rider lands,
   and it expires at the moment it names.
3. An anchor outside the Initiative order in a running fight gets the second
   request, naming `rollInitiativeFor`.
4. The three command-level tests that pin `no_turns` —
   `speed-grants.test.ts:455`, `turn-anchored-riders.test.ts:216`, `:431` —
   are converted to assert the request. `duration.test.ts:109` is **kept**: the
   pure helper still refuses.
5. `invariants.test.ts`'s `satisfyWith` sweep passes with the new kind naming
   a published barrel command, and its synthetic negative case still fails.
6. `refusal-sweep.test.ts` stays green in both directions.

### Tests and conformance

The gauntlet. CLAUDE.md: "A missing fact is a request, not a refusal" gains the
seventh kind and the sentence about why a turn timeline is a thin record rather
than a rule saying no; the "Durations Are Two Different Things" section records
that the *command layer* asks while the conversion still refuses.

### Dependencies

IE-038 (it rewrites `castOrRelease`, where the pre-flight lives). IE-043 (the
fifth member must exist to be covered).

### Out of scope

- **`commands/spell-resolution.ts:972`** — a delayed-damage rider outside
  combat is reported in `unverified` and not scheduled, rather than refused.
  That is a different existing decision and changing it is semantic. **Do not
  change it; do report in the digest whether it belongs in this family**, with
  the SRD sentence, for the owner.
- Any change to what a turn-anchored duration *means*.
- Making `beginCombat` or `rollInitiativeFor` do anything new.

### Known risks

Low in mechanism, medium in scope discovery: the value of the task is that
**every** such site converts, and a site left refusing is invisible until a
caller meets it. The sweep in requirement 2 is the acceptance, not a nicety.

## Completion digest

```
IE-046 — Completion digest
Builder: COMPLETE
Commit: 391b358 (replayed onto main as 09a52de)   Branch: worktree-agent-a0499dbc79bb08aa5
Opus review: PASS — rounds: 2, confidence high, no defects
Tests: 8423 / 8423; new: 20 (17 in the new turn-context.test.ts, 3 converted in
  speed-grants.test.ts and turn-anchored-riders.test.ts). On main after the replay: 8423
  across 120 files.
Mutations, five, each red: (1) `schedule` handing back the bare refusal — 4 cases;
  (2) the pre-flight doing so — 7 across 3 files; (3) collapsing not_in_combat into the
  no_turns branch — the case that separates them; (4) `subject = holder`, dropping the
  duration's own anchor — the anchor-vs-holder fixture; (5) deleting a member from the clause
  table — the membership sweep.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — COVERAGE.md byte-clean; no spell definition or adjudication touched.
Architectural deviations: none.
Foundational primitives touched: ContextRequest.kind in packages/shared/src/result.ts (widened
  by one member, additive; no exhaustive switch over it exists); commands/command.ts (one new
  exported helper); the duration-scheduling path at three sites. **duration.ts, the GameEvent
  union, the fold and persistence are all untouched; both frozen logs untouched.**
New runtime special cases: none.
Files outside the brief's surface: commands/command.ts — the conversion lives there rather
  than in three copies, beside unknownCreature and sceneFor, which is that module's stated
  purpose. Requirement 2 directed a source sweep rather than the brief's file list, and three
  modules needed it.
Reviewer confidence: high
Recommendation: READY FOR MERGE
```

## The requirement-2 sweep, which is the point of the task

Enumerated from source rather than from my brief's three sites. **Six**
`resolveDuration` call sites exist across `commands/` and `rest.ts`:

| | |
|---|---|
| Converted | `spell-resolution.ts` (the `riderDurations` pre-flight — my brief's site); `casting.ts` (the held declaration — my brief's two); `conditions.ts`'s `schedule` — which is the **single door** and therefore subsumes my brief's third site *and* three my brief never named: the atomic cast's timer, `features.ts`'s `featureTimer`, and the `speed-change` grant timer |
| Exempted, behaviourally | two whose argument is a **span** and so cannot be turn-anchored (`castingSeconds`, `mustResolve`); and `scheduleDelayed`, the site I put out of scope |

So the brief named three and the truth was six, three of which were reached for
free because one of them is a single door. That is requirement 2 doing exactly
what it was written to do.

## Risk gate

**Inspected, and the owner's constraint verified by me directly rather than read
off the digest**, because this task exists to implement a decision:

- **`duration.ts` is not in the diff at all** — the pure helper still returns a
  bare refusal, which is requirement 3 and the rule CLAUDE.md states for every
  other request kind.
- **No conversion to seconds anywhere.** Grepped the whole diff for one; there
  is none.
- `turnContextFor` reads the **duration's own anchor** (`'of' in duration ?
  duration.of : holder`) rather than the turn holder, which is what mutation (4)
  exists to catch and what the differing-creatures fixture discriminates.
- The `because` line quotes the **printed** clause out of a table keyed on the
  `Duration` union's own members — and that table's population is read out of
  `resolveDuration`'s switch, so a sixth member fails *here* rather than in a
  corridor.
- It preserves `refused.code`, so `no_turns` and `not_in_combat` keep their
  codes, every existing assertion on them still passes, and no new code enters
  the refusal sweep's population.

**Nothing is spent, asserted on folded state rather than on the `Result`** —
which is the claim my brief demanded be tested that way, because a `Result` that
says "needs-context" while the slot is gone is the failure this whole channel
exists to prevent.

Classification: **GREEN**.

## Architecture decision

None at build time. The architecture is the **owner's decision of 2026-09-14**,
quoted in the brief and carried into the launch message verbatim, with a
deviation from it declared `ARCHITECTURE_BLOCKED` in advance. No Fable
involvement.

## Merge record

Replayed onto `main` as `09a52de`; clean, no conflict.

`main` verified **after** the merge: typecheck ✓, lint ✓, **8,423 tests across
120 files** ✓, both frozen logs and the scenario determinism explicitly ✓,
`COVERAGE.md` regenerated and byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence; **4** no defects; **5** gauntlet green; **6** conformance green;
**7** no blocker; **8** no deviation — the owner's constraint is honoured to the
letter; **9** the primitives are the brief's, plus one shared helper; **10**
`commands/command.ts` is outside the declared list and is the *right* home — the
alternative was three copies, and `sceneFor`'s third copy is the precedent this
repository already recorded; **11** integration valid, and I confirmed the
reviewer's open question — IE-047 does not touch `commands/command.ts`; **12**
re-verified on `main`; **13** risk gate inspected, GREEN.
