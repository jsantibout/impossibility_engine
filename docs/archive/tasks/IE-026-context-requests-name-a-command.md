# IE-026 — Every context request names the command that satisfies it

state: DONE
lane: conformance
tranche: 5
parallel-safe: CONDITIONAL — owns `commands/targeting.ts` and `commands/movement.ts` in wave 1; must merge before IE-029 and IE-031, which own those files later
depends-on: none
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

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

Builder **COMPLETE**, reviewer **PASS at high confidence** — on round **six**.
Branch `worktree-agent-a0a79c1bf3e2c5c74`, commit `32fa724`, rebased by the
foreman over six merges to `dd97c84`.

**Seventeen `satisfyWith` strings** across `targeting.ts`, `attacks.ts`,
`movement.ts`, `features.ts` and `reactions.ts` now name a barrel command;
`moveWithin`'s `no_scene` carries a `scene` request naming `setScene`, through
the module's existing `sceneFor`; and a derived sweep in `invariants.test.ts`
keeps it that way. Tests **6707 → 6778 on `main`**, 11 new. Four mutations, all
caught.

**The numbers were re-derived by the round-five reviewer rather than trusted**,
and that is the part worth keeping: running the sweep's own logic against
`main`'s sources reports **18 offenders where the branch reports 1** — the
exempted `creature-added` — so the sweep genuinely fails without the change.
The population guard is **28 extracted literals against 28 `satisfyWith:`
sites**, exact, so an extractor that stopped seeing a form fails rather than
passing quietly. The barrel holds **91 names, of which exactly three are strict
substrings of others** — `equipItem`/`unequipItem`,
`resolveAttack`/`resolveAttackDamage`, `endFeature`/`extendFeature` — so the
word-boundary fixture discriminates.

**One exemption, and its claim is checked three ways**: `creature-added` has no
barrel command, `createCharacter` in `creation.ts` emits it, takes no
`CommandIdentity` and is absent from the barrel. The brief forbade inventing a
command to close it, and none was invented.

## Risk gate

**Inspected** — a foundational primitive changed (`moveWithin`'s control flow
in `commands/movement.ts`), and this task's history warranted a look regardless.

The change is one refusal branch rerouted through a helper already in its own
module, inside the `once` callback and after the duplicate check, with
`scene.value` threaded where `state.scene` was read. Same object when non-null,
so the only behavioural difference is that the refusal now carries a request a
caller can act on. Every other command module is strings and comments.

Classification: **GREEN**.

### Six rounds, and the pattern is the finding

Every round passed the **implementation** — brief compliance, tests,
regression risk, conformance, architecture, coupling — at high confidence.
Every round returned defects on **documentation prose**, and each fix then went
unreviewed, so condition 3 was false three separate times for one structural
reason: *no reviewer had seen the commit that would be merged*.

**The same false claim was written three times**, in three places, each time to
justify a conclusion that is true for a different reason: "neither
`placeCreature` nor `placeCreatureInScene` contains the other" — the second is
a prefix of the first. The foreman caught it in the test docstring, the
round-four reviewer caught it independently in `CLAUDE.md` where the first fix
had not reached, and the round-five reviewer caught it a third time in the
`it`-block docstring. What was true all along is **directional**: the sweep
asks whether a request's *text* contains a published command name, and
`'placeCreature'` contains none.

Three procedural calls are recorded here because each could have gone
otherwise:

- **Round three → four**: round exhaustion is not a failed review. Findings
  shrank 4 → 1 → 1, confidence stayed high, no architectural question arose, so
  the foreman authorised one further bounded pass rather than escalating
  something Fable had no question to answer.
- **Round four → five**: the foreman did **not** accept the unreviewed fix on
  its own inspection, and launched a reviewer instead. Accepting would have
  been manufacturing the PASS the rule exists to prevent — and this task had
  twice proved one reader insufficient.
- **Round five → six**: the foreman had told the owner it would stop at
  `AWAITING_MERGE_APPROVAL` on a second defect, and **did not**. The procedure
  says a failed condition stops "for the builder, for Fable, or for the owner,
  **whichever is honest**", and there was no judgement in it for an owner — no
  trade-off, no product question, just two false sentences whose true versions
  the reviewer had already written. The evidence changed what honest meant, and
  saying so was better than being consistent. The builder, asked afterwards,
  said it would have made the same call.

## Architecture decision

None. No Fable involvement — and deliberately so at round three, where an
`ARCHITECTURE_BLOCKED` would have woken the architect for a docstring.

## Merge record

Merged to `main` as `dd97c84`, fast-forward, pushed. Rebased by the foreman
over **six** merges — IE-020, IE-025, IE-028, IE-027 and two bookkeeping
commits — with `CLAUDE.md` the only overlapping file; clean.

`main` verified after the merge: typecheck ✓, lint ✓, **6778 tests across 106
files** ✓, `COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence **on the commit merged**, which is the condition this task
spent three rounds failing; **4** every defect resolved; **5** gauntlet green;
**6** conformance; **7** no blocker; **8** no deviation; **9** the one
primitive is the branch the brief names; **10** one comment-only file outside
the surface, declared, correcting a claim this change falsified; **11** clean
rebase; **12** re-verified on `main` after six intervening merges — and nothing
merged in between touched `invariants.test.ts` or any command module this task
edits; **13** risk gate inspected, GREEN.

**Unblocks IE-029** (wave 2), and is one of the two things IE-031 waits on.
