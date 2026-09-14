# IE-029 — Refusal-code hygiene, before a caller can branch on one

state: APPROVED_FOR_IMPLEMENTATION
lane: conformance
tranche: 5
parallel-safe: CONDITIONAL — owns `commands/actions.ts`, `commands/movement.ts`, `resources.ts` and `rest.ts`; after IE-026, before IE-031
depends-on: IE-026
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: none

## Brief

### Objective

Fix the unreachable, shadowed and remapped refusal codes IE-018 reported
outside the casting path, and assert each one in `refusals.test.ts`.

### Why now

**A refusal is a value so the layer above can read it** — that is the
inviolable-rule side of the design, not a nicety. IE-018 swept every code and
correctly *reported* rather than fixed these, because a refusal code is
observable behaviour and a caller may branch on it. Fixing them is a task of
its own, and it has to happen before M2 gives a model a tool surface that
branches on them.

### Current relevant architecture

The sites, verified on `main`:

- `packages/engine/src/combat.ts:466` — `not_a_combatant`, shadowed at the
  `dash` path: the caller reports something else first.
- `packages/engine/src/resources.ts:109` — `bad_key`, reached only where a key
  cannot be empty, so it is a refusal no caller can see.
- `packages/engine/src/commands/casting.ts:1209` — `slot_not_allowed`: **in the
  casting path, and out of scope here** (IE-034 owns that file).
- `packages/engine/src/rest.ts:251` and `:276` — `bad_hit_die`, the second site
  unreachable.
- `packages/engine/src/attack.ts:438` — `no_damage`.
- `packages/engine/src/commands/movement.ts:204`, `:484` — `spendMounting`
  remaps **any** non-movement refusal to `not_enough_movement`, copied verbatim
  from `resolveMove`. So mounting on somebody else's turn reports
  `not_enough_movement` with a reason that says "not X's turn".
- `packages/engine/src/refusals.test.ts` and `refusal-sweep.test.ts` — the two
  halves of IE-018's instrument. The sweep excludes its own file deliberately.

### Required behaviour

For each site: **either** make the code reachable and assert it, **or** remove
it and say why in the commit, **or** record a written exemption naming the
facts that make it unreachable — the shape IE-018 used for
`nothing_to_interrupt`, whose exemption names two facts a test holds.

Specifically:

1. `spendMounting` stops remapping. A refusal from the economy is passed
   through with its own code, so "not X's turn" reports the turn code.
2. `bad_key` becomes a value a caller can actually receive, or goes.
3. The `bad_hit_die` second site, `no_damage` and the `dash` `not_a_combatant`
   shadow are each resolved one of the three ways above.
4. Every change is asserted in `refusals.test.ts` **through the public API** —
   a command off the barrel, or a function `index.ts` re-exports — never by
   calling the helper that contains the `err`.

### Architecture constraints

- **Changing a code is changing behaviour.** Where a code a caller might
  already branch on changes, say so explicitly in the digest; that is a
  deliberate, recorded change, not a cleanup.
- The two casting-path items — `no_trigger`'s five distinct rules across three
  modules, and `nothing_to_interrupt` — belong to **IE-034**, which owns
  `casting.ts`. Do not touch them.
- Do not weaken the sweep's "asserted" net. IE-018 measured the loose net
  deliberately: no code in this repository is quoted in a test *only* as an
  argument to a constructed `err`.
- A reason string must say something. The sweep already refuses a placeholder.

### Acceptance criteria

1. Mounting on somebody else's turn reports the turn's own refusal code, with
   its own reason, asserted through `mountCreature`.
2. Every item above is reachable-and-asserted, removed, or exempted with a
   reason a test checks — and the digest says which, item by item.
3. `refusal-sweep.test.ts` reports no newly unasserted code, and no stale
   exemption: it holds its allowlist in both directions.
4. `npm test`, `npm run typecheck`, `npm run lint` green; `COVERAGE.md`
   unchanged.

### Tests and conformance

`packages/engine/src/refusals.test.ts`, through the public API.

### Dependencies

**IE-026**, which edits `commands/movement.ts` first. **IE-031 waits on this**
— it rewrites the movement allowance in the same two files.

### Likely file surface

`commands/movement.ts`, `commands/actions.ts`, `combat.ts`, `resources.ts`,
`rest.ts`, `attack.ts`, `refusals.test.ts`.

### Out of scope

`commands/casting.ts` and its two codes. Adding refusal codes. Any change to
what is legal — this changes what a refusal is *called* and where it is
reachable, never what is refused.

### Known risks

"Make it reachable" can quietly become "make something refusable that was
not". If a site is unreachable because the rule above it is stricter, the
honest answer is the exemption, and the exemption must name the stricter rule.

## Completion digest

## Risk gate

## Architecture decision

## Merge record
