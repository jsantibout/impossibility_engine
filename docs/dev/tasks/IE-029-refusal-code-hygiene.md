# IE-029 — Refusal-code hygiene, before a caller can branch on one

state: DONE
lane: conformance
tranche: 5
parallel-safe: CONDITIONAL — owns `commands/actions.ts`, `commands/movement.ts`, `resources.ts` and `rest.ts`; after IE-026, before IE-031
depends-on: IE-026
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

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

Builder **COMPLETE**, reviewer **PASS at high confidence on round one**, no
defects. Branch `worktree-agent-a340dabefc03f28f5`, commit `1c418f2`, rebased
by the foreman to `74e3c46`. Tests **6796 → 6808 on `main`**, 12 new (249 test
lines). Gauntlet green, `COVERAGE.md` byte-identical,
`refusal-sweep.test.ts` untouched and still holding its single exemption in
both directions.

**Item by item, which of the three answers each site got:**

| Site | Answer |
|---|---|
| `moveWithin` | **remap removed** — the economy's refusal passes through under its own code |
| `spendMounting` | **remap removed**, the same rewrite, copied from the first |
| `resources.ts` `bad_key` | **made reachable**, by mirroring the check in `declareResourcePool`; the `err` itself is unchanged |
| `rest.ts`'s second `bad_hit_die` | **removed**, the validation pass's sizes carried forward |
| `attack.ts` `no_damage` | **exempted**, on two facts a test sweeps — no SRD weapon lacks both dice and a flat amount (`WEAPONS` × `itemFor`), and a command resolves its weapon by catalogue id |
| `dash`'s `not_a_combatant` | **exempted**, on two facts a test holds — `spendAction` answers `unknown_combatant` first, a stricter and better answer, and `budgets` and `order` are kept in exact step |
| `commands/casting.ts` | **untouched**, as the brief requires — its two codes are IE-034's |

Five mutations, each reverted after being watched fail. The one worth naming:
stopping `removeCombatant` deleting the budget breaks the `budgets`/`order`
agreement the `not_a_combatant` exemption **rests on** — so the exemption is
pinned by the fact that would end it rather than by a sentence.

Also removed: **`no_movement`, a code no site in the engine returns.** It
existed only inside the two rewrites' comparisons, and was never in the sweep's
population because nothing constructed it.

## Risk gate

**Inspected** — the digest declares two behaviour changes a caller could branch
on, and a foundational primitive (the action economy's refusal surface) is
named.

**Behaviour change 1: out-of-turn movement, mounting and dismounting report
`not_their_turn` where they reported `not_enough_movement`.** The brief asked
for exactly this and asked for it to be declared, which it was. The old code
carried a reason string reading "it is not b's turn" under a code saying the
mover was out of movement — **two different answers to one question**, which is
what a refusal being a value exists to prevent. Both directions are asserted, so
the change cannot degenerate into "movement never refuses".

**Behaviour change 2: a blank pool key is a refusal rather than a
`CorruptLogError`.** Previously `declareResourcePool` asked only whether the
creature *had* the key — which an empty string never is — so the event went out
and the fold threw. That is the repository's own doctrine applied correctly:
rules-legal refusals are values, and an exception is reserved for programmer
error. A caller's bad argument is not a corrupt log.

I read both diffs. The passthrough is safe because **both call sites guard on
`budgets[id] !== undefined` before calling `spendMovement`**, so no
needs-context can leak through the newly transparent path — the reviewer found
that too, independently. The `endRest` rewrite is behaviour-preserving:
`dice` is filled in the validation loop, which runs under the same `case
'short'` condition as the rolling loop, with the `benefit !== 'short'` path
having returned earlier.

Classification: **GREEN**.

**Scope**: `commands/pools.ts` (+7) sits outside the declared ownership line and
is the only place the brief's item 2 can land — the `err` stays in
`resources.ts`, which is in the surface. No tranche-5 task claims that file.
Accepted.

## Architecture decision

None. No Fable involvement.

## Merge record

Merged to `main` as `74e3c46`, fast-forward, pushed. Rebased by the foreman
over IE-023; clean.

`main` verified after the merge: typecheck ✓, lint ✓, **6808 tests across 108
files** ✓, `COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS`,
high, round one; **4** no defects; **5** gauntlet green; **6** conformance;
**7** no blocker; **8** no deviation — both behaviour changes are what the
brief asked for and both are declared; **9** the primitive named is the refusal
surface the brief is about, with `combat.ts` and `spendMovement` themselves
unchanged; **10** one file outside the surface, with the reason the brief
forced; **11** clean rebase; **12** re-verified on `main`; **13** risk gate
inspected, GREEN.

**Unblocks IE-031**, which rewrites the movement allowance in the two files
this task just simplified.

**One finding for the queue:** `bad_partial_recovery` is `bad_key`'s exact
twin — `declareResourcePool` does not check `regainsOnShortRest` either, so a
non-positive value reaches the reducer and throws rather than returning a
value. IE-018 did not report it and the brief does not name it. The reviewer's
related observation is the better fix: `declareResourcePool` hand-mirrors three
of `declarePool`'s four checks, and **delegating to `declarePool` and passing
its refusal through would close both structurally** — larger than this brief
authorised, and the right shape when somebody opens that file.
