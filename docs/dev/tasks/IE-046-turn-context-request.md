# IE-046 — A turn-anchored rider outside combat asks for turn context

state: IMPLEMENTING
lane: mechanism
tranche: 6
parallel-safe: CONDITIONAL — `packages/shared/src/result.ts`, `commands/spell-resolution.ts`, `commands/conditions.ts`, `commands/casting.ts`; not beside IE-038, IE-041, IE-042 or IE-048
depends-on: IE-038, IE-043
worker: qb-builder in .claude/worktrees/agent-a0499dbc79bb08aa5, branch worktree-agent-a0499dbc79bb08aa5
approved: 2026-09-14 — "APPROVE TRANCHE 6."
merge-approved: none

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
