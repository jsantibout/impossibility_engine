# IE-026 — Every context request names the command that satisfies it

state: IMPLEMENTING
lane: conformance
tranche: 5
parallel-safe: CONDITIONAL — owns `commands/targeting.ts` and `commands/movement.ts` in wave 1; must merge before IE-029 and IE-031, which own those files later
depends-on: none
worker: qb-builder · .claude/worktrees/agent-a0a79c1bf3e2c5c74 · worktree-agent-a0a79c1bf3e2c5c74
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

A `needs-context` refusal must name a **command** a caller can send, not an
event nobody above the engine may write — and a sweep must keep it that way.

### Why now

`CLAUDE.md` states the rule: "A `ContextRequest` says what is missing, which
rule wanted it, and the event that would establish it… A request names the
command that satisfies it, and every command-level request has one." IE-012
then built the eight scene commands, and IE-016 the nine declarations — so
every fact now *has* a command — and three requests still say "a scene-set
event" and two say "a creature-placed event". A tool surface branching on
`satisfyWith` is told to append an event, which is the one thing the layer
above the engine must never do.

IE-012's builder reported it and left it alone because `targeting.ts` was
adjacent to another task's surface. This tranche has the slot.

### Current relevant architecture

The sites, all verified on `main`:

- `commands/targeting.ts:529`, `:602`, `:735` — "a scene-set event"; the
  command is `setScene`.
- `commands/targeting.ts:553`, `:619`, `:751` — "a creature-placed event for
  `<caster>`"; the command is `placeCreatureInScene`.
- `commands/attacks.ts:470`, `commands/movement.ts:145` — the same event
  phrasing.
- `commands/features.ts:215` and `commands/reactions.ts:757` — bare
  `'creature-placed'` and `'placeCreature'`; `placeCreature` is the **pure
  function**, not the command.
- `commands/command.ts:52` — "a creature-added event for `<id>`". There is no
  command for adding a creature: `createCharacter` in `creation.ts` emits it
  and is not published through the barrel. Say so honestly rather than naming
  a command that does not exist.
- The good examples to match: `commands/movement.ts:457` "a setScene command",
  `:537` "a placeCreatureInScene command for …", `commands/scene.ts:194`.
- `resolveMove` answers `no_scene` with a **bare** `needsContext` carrying no
  request at `commands/movement.ts:132`, while `:451` has the helper that
  carries one. `:443` even documents the gap.

### Required behaviour

1. Every `satisfyWith` that names an event for which a command exists names
   the command instead, in the phrasing the existing good sites use.
2. `resolveMove`'s `no_scene` at `:132` carries a request naming `setScene`,
   through the helper at `:451`.
3. A sweep in `invariants.test.ts` asserts that every `satisfyWith` string in
   `commands/` names something the `commands.ts` barrel exports — with a
   written exemption for the genuine exceptions, each naming the fact that
   would end it. **Driven over a synthetic source it must catch**, like every
   other sweep in that file.
4. The two `route` requests (`commands/ongoing.ts:164` and `:347`) are the
   documented odd ones: satisfied by re-sending the same command with a field
   filled in. They name a command already; the sweep must accept them without a
   special case that would accept anything.

### Architecture constraints

- **Do not invent a command.** `creature-added` has none from the barrel; the
  exemption says that and names `createCharacter` in `creation.ts`, which is
  exactly how `invariants.test.ts` already exempts five event types.
- Do not change any refusal **code**, only the `satisfyWith` prose and the one
  missing request.
- `ContextRequest.kind` is untouched. This is not a vocabulary change.
- Keep the request payloads identical. A caller branching on `kind` sees no
  difference.

### Acceptance criteria

1. No `satisfyWith` in `commands/` names an event for a fact that has a
   command.
2. `resolveMove` with no scene returns a request naming `setScene`, asserted
   through the public API.
3. The sweep fails against a synthetic `satisfyWith: 'a scene-set event'`.
4. Every exemption names a fact a test can check, and the test checks it.
5. `npm test`, `npm run typecheck`, `npm run lint` green; `COVERAGE.md`
   unchanged.

### Tests and conformance

The sweep in `packages/engine/src/invariants.test.ts` beside the existing
`needs-context` invariant. Behavioural cases for the `resolveMove` change.

### Dependencies

None. **IE-029 and IE-031 both edit `movement.ts` and `actions.ts` later in
the tranche and wait on this.**

### Likely file surface

`commands/targeting.ts`, `commands/movement.ts`, `commands/attacks.ts`,
`commands/features.ts`, `commands/reactions.ts`, `commands/command.ts`,
`packages/engine/src/invariants.test.ts`.

### Out of scope

Any new `ContextRequest.kind`. Any change to what is refused rather than
requested — the three-valued discipline is unchanged.

### Known risks

`features.ts:215` and `reactions.ts:757` name a pure function rather than a
command; the correct name is the command, and a builder who does not check the
barrel will copy the wrong one.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
