# IE-003 — Close the guard holes and make the guard sweeps mechanical

state: CHANGES_REQUIRED
lane: mechanism
batch: 1
parallel-safe: CONDITIONAL — beside conformance (IE-004) and content only; it edits `commands.ts`, `events.ts`, `rest.ts`, `spells.ts` and the invariants suite, so no other mechanism task runs beside it
depends-on: none
worker: qb-builder · .claude/worktrees/agent-aa0e7aa939fb1a46a · worktree-agent-aa0e7aa939fb1a46a
approved: 2026-09-13 — "APPROVE BATCH"
merge-approved: none

## Brief

### Objective

Seven measured holes in the engine's guards, each closed behind a
reproduction, and the two sweeps that would have caught them made mechanical
so the next hole fails in a test rather than in play. Every item is in
`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.3 and §3.1, with
file:line evidence.

### Why now

Correctness comes before the next family and before the structural split.
Two `CLAUDE.md` sentences promise sweeps that do not exist; a command spends
an economy with no guard; a settlement path re-rolls saves on a retry; a
removed creature can wedge a fight; the duplicate-check trap has been sprung
an eighth time, in a wrapper. Each is small. Together they are the audit's
first recommendation.

### Current relevant architecture

- `mayAct` (`commands.ts:7681`) is the one policy for "may this creature
  spend anything"; `unsettledRefusal` (`:7620`) is the stronger form used by
  casting and activation; sixteen commands spend an Action, Bonus Action,
  movement, pool use or slot (audit §3.3, and the state sweep's table).
- `identify` (`commands.ts:300`), `wasCommandApplied` (`:322`),
  `commandOutcome` (`:333`) and the fingerprint (`stableStringify`, `:275`)
  are the idempotency machinery; `rest.ts:6` imports `identify` from the
  command layer, the engine's only upward value import.
- `GUARDED` (`invariants.test.ts:566`) is a hand-written array of 39 commands
  run twice under one id.
- `castOrRelease` (`commands.ts:7715`) wraps `resolveSpell`; its refusals at
  `:7740` (`unknown_creature`), `:7744` (`no_definition`), `:7803`
  (`cast_on_a_hit`), `:7891` (`needs_context`) and `:8614`
  (`no_free_casting`) precede `castSpell`'s `identify` (`:5450`); the two
  pending-state guards at `:7735` and `:7781` are already replay-exempt.
- `creature-removed` (`events.ts:3310`) does not touch `timers`;
  `dropOrphanedSaves` (`:2956`) drops a pending save only when its timer is
  gone; `resolvePendingSaves` (`commands.ts:6776`) refuses `unknown_creature`
  at `:6789`; `resolveTurn` refuses `saves_pending` at `:6919`.
  `settleHoldsInvolving` (`commands.ts:549`) is how the other holds are
  settled when a creature leaves.
- The Counterspell exemption at `commands.ts:7780` lets a `casting-a-spell`
  Reaction be declared while a casting is pending; when the pending casting is
  itself a Counterspell, the reducer throws `CorruptLogError`
  (`events.ts:3531`) instead of the command refusing.
- `castingNumber` (`commands.ts:4021`) and `castingNumberOf` (`:6576`) are
  identical; `commands.ts:8765` hand-builds a casting source that
  `castingSource` (`spells.ts:30`) already builds.

### Required behaviour

1. **`extendFeature` guards.** It calls `mayAct` (or `unsettledRefusal`, as
   its siblings do) before `spendFor`. Reproduction: with a global owed area
   effect, `extendFeature` is refused `area_effect_owed` exactly as
   `activateFeature` is.
2. **A mechanical `mayAct` sweep.** A test enumerates every exported command
   that spends an Action, Bonus Action, Reaction, movement, a pool use or a
   slot, runs each against a state holding a global owed area effect, and
   asserts `area_effect_owed` — except for commands on an explicit allowlist,
   each with a written reason (Reactions and the settlement commands, per
   `CLAUDE.md`, "Reactions are not routed through either"). The list of
   spenders is declared in the test with its evidence line, so a new spender
   is a one-line addition and an unguarded one fails.
3. **`GUARDED` derived, not recalled.** The idempotency sweep asserts that
   every export of `commands.ts` and `rest.ts` whose return carries events is
   either in the sweep or in an allowlist with a reason (the four `CLAUDE.md`
   names as fixture and log-reconstruction halves, plus any others the
   builder can justify). Add `activateFeature`, `resolveAttackDamage`,
   `beginRest`, `castSpell` and `resolveDamage` to the sweep. Give
   `resolvePendingSaves` and `removeCreatureEverywhere` a `CommandIdentity`
   and stamp the event that always happens (for the saves, `roll-recorded` is
   not always emitted — choose the event that is, as the healing-touch lesson
   in `CLAUDE.md` says). A retried `resolvePendingSaves` rolls nothing.
4. **The duplicate check first in the casting wrapper.** `resolveSpell` /
   `castOrRelease` establishes the command's identity before any refusal
   that reads a fact which can change between the first run and a retry.
   Reproduction: `resolveSpell` succeeds, the caster is removed, the same
   command id is retried — the result is an empty batch, not
   `unknown_creature`. The fingerprint rules stay exactly as they are.
5. **A removed creature takes its timers with it.** Reproduction: a creature
   Paralyzed by Hold Person, owing an end-of-turn repeat save, is removed
   mid-fight; `resolveTurn` advances and `pendingSaves` is empty. Fix in the
   reducer's `creature-removed` case, purging condition timers whose target
   is the departed creature (and, through the existing derived pass, their
   pending saves). A Hold Person on two targets keeps the other target's
   timer and save. Nothing is written for the departed creature's condition
   ending — expiry is derived, as it always was.
6. **Counterspell on Counterspell is a value.** When the pending casting is
   itself a `casting-a-spell` Reaction, `castOrRelease` returns
   `err('casting_pending', …)` naming the nesting, and nothing is spent. The
   reducer's throw stays as the corrupt-log backstop.
7. **Hygiene in the same files.** One `castingNumber` in `spells.ts`; the
   hand-written source at `:8765` replaced by `castingSource`; `identify`,
   `wasCommandApplied`, `commandOutcome`, `CommandIdentity` and the
   fingerprint moved to a new `idempotency.ts` that `commands.ts` and
   `rest.ts` both import (and `index.ts` re-exports), so `rest.ts` no longer
   imports the command layer.
8. **`CLAUDE.md` tells the truth.** Replace the sentence at "A sweep holds the
   list…" and the one at "`invariants.test.ts` is the authoritative list…"
   with what the two sweeps now actually assert.

### Architecture constraints

- No behaviour change beyond the eight items; no reorganisation of
  `commands.ts` (that is IE-005).
- `golden-log.json` untouched; the fold must still reproduce it byte for
  byte.
- Refusals stay values; the reducer's corrupt-log throws stay throws.
- Do not widen `mayAct`'s policy; only its coverage.
- The fingerprint's identity semantics (same id, different inputs → refused)
  are unchanged and re-asserted.

### Acceptance criteria

1. Each of items 1, 4, 5 and 6 has a test that failed before the change for
   the reason the audit gives, and passes after.
2. The `mayAct` sweep and the derived `GUARDED` sweep exist, enumerate from
   the module rather than from a hand list, and fail when a spender or an
   event-returning export is added without a guard (the builder proves this
   with a mutation: temporarily add an unguarded export and watch the sweep
   fail).
3. `resolvePendingSaves` and `removeCreatureEverywhere` are in the
   idempotency sweep and pass it.
4. `rest.ts` imports nothing from `commands.ts`; the value-level import graph
   is still acyclic.
5. The two `CLAUDE.md` sentences are corrected.
6. The whole gauntlet passes.

### Tests and conformance

`invariants.test.ts` (the two sweeps), `turn-hooks.test.ts` or
`death-saves.test.ts` (the wedge), `counterspell.test.ts` (the value
refusal), `casting.test.ts` or `idempotency` tests (the wrapper retry),
`rage.test.ts` or the feature tests (`extendFeature`). No golden-log change.

### Dependencies

None.

### Likely file surface

`packages/engine/src/commands.ts` (bounded: `extendFeature`, `castOrRelease`
/ `resolveSpell`, `resolvePendingSaves`, `removeCreatureEverywhere`, the two
`castingNumber` sites, `:8765`, the identity block moving out),
`events.ts` (`creature-removed`), `rest.ts`, `spells.ts`, new
`idempotency.ts`, `index.ts`, `invariants.test.ts`, three or four existing
test files, `CLAUDE.md`, `COVERAGE.md` if the counts move (they should not).

### Out of scope

The split of `commands.ts`; the fold's reads of the spell and equipment
catalogues (IE-007); `rollInitiativeFor`'s generator advance;
`free-interaction-used`; the `spell-ongoing` acceptance for an ended casting
(IE-007); any change to what `mayAct` refuses.

### Known risks

- Item 4 touches the casting path; the golden log and `casting.test.ts` are
  the safety net, and the change must be the ordering only.
- Item 5 must not lift conditions on creatures that stayed; the two-target
  Hold Person fixture discriminates.
- The idempotency-stamp choice for `resolvePendingSaves` has to ride on an
  event that always happens; `CLAUDE.md`'s "an event that always happens is
  where a stamp has to ride" is the rule.

## Completion digest

Arrived 2026-09-13, from the builder's last message, as `ARCHITECTURE_BLOCKED`
at the three-round limit. The architect resolved the block (see the
architectural gate) and authorised a fourth round; the re-issued digest is
appended below it when it arrives.

```
IE-003 — Completion digest
Approved architectural intent: Seven measured holes in the engine's guards, each closed behind a reproduction, and the two sweeps that would have caught them made mechanical so the next hole fails in a test rather than in play.
Builder: ARCHITECTURE_BLOCKED
Worktree: C:\Users\justi\Code\QuestBarrel\ImpossibilityEngine\.claude\worktrees\agent-aa0e7aa939fb1a46a   Branch: worktree-agent-aa0e7aa939fb1a46a   Commit: 5b23232f0cb89d5fa932a548cbb8eb2943d303dc   Rebased on main at: 522be7586e6f3bb1d886e0720ca3e12fb0e336aa
Opus review: DEFECTS (never PASS) — rounds: 3
Tests: 5311 passing / 5311 total (baseline 5245); new tests: 66; mutation run: six, each failed for its own reason — an unguarded exported spender added beside `mayAct` (both sweeps named it); `timersApartFrom` widened to purge every condition timer (the two-target Hold Person fixture failed, which is the discriminating case); the Counterspell guard's second disjunct removed (the nested casting succeeded); `castingIdentity` replaced by the identity function (both anchoring tests failed); the stamp taken off `resources-restored` (the partial-refill fixture handed back a use nobody rested for); the arrow-const form dropped from the return-type classifier (the sweep reported `anchoringFor`, the export it had stopped seeing).
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — COVERAGE.md regenerates byte-identical; golden-log.json untouched and still folds; no spell definition touched.
Architectural deviations: one, and it is the brief's item 4 read further than its wording. "The fingerprint rules stay exactly as they are" cannot hold literally while the identity moves up: `castOrRelease` now fingerprints the `CastSpellRequest` the caller sent rather than the derived `CastCommand`, because two `identify` calls under one id would fingerprint two different objects and refuse every honest retry. `identify` itself is byte-for-byte unchanged and same-id-different-inputs is still refused (re-asserted in `spell-effects.test.ts`); the identity is strictly stricter — a retry aimed at a different creature is now caught — and needs one normalisation, `anchoring: 'space'`, which restates the engine's existing "space is the absence" rule and is pinned in both directions in `spatial-model.test.ts`. The alternative, a bare `wasCommandApplied` short-circuit, would have silently swallowed a reused id, which the doctrine calls the worst available outcome.
Foundational primitives touched: `events.ts` — the `GameEvent` union (`creature-removed`, `resources-restored`, `rolls-issued` each gain an optional `command` stamp) and the reducer's `creature-removed` case (new `timersApartFrom`); `commands.ts` — `extendFeature`, `castOrRelease`, the `castSpell`/`resolveCast` split into private `*With` halves, `resolvePendingSaves`, `removeCreatureEverywhere`, `restoreResourcesOn`; new `idempotency.ts`; `index.ts`; `spells.ts` (`CASTING_PREFIX`, `castingNumber`); `rest.ts`.
New runtime special cases: two, both keyed on declared data rather than a name — `castingIdentity` normalising `anchoring: 'space'` before fingerprinting, and the Counterspell nesting refusal keyed on `definition.trigger === 'casting-a-spell'`.
Files outside the brief's surface: `packages/engine/src/spatial-model.test.ts` (pins the `anchoring` normalisation item 4 required, in both directions — the reviewer's round-one defect 1); `packages/engine/src/area-motion.test.ts` and `packages/engine/src/casting.test.ts` (import-path changes only, forced by item 7's move of `commandOutcome`/`wasCommandApplied` to `idempotency.ts`).
Out-of-scope findings (not acted on): `resolveCast` is an exported command that spends the action economy with no `mayAct` — the brief forbade widening what `mayAct` refuses, so it is recorded as a named debt in the sweep's allowlist and in CLAUDE.md rather than fixed. `endRest` takes no command id: a retry finds nobody resting and is refused, so no Hit Die is rolled twice, but the caller cannot tell that from never having rested. Whether an outstanding area effect should block a rest is a question neither the SRD nor this engine has asked; the exemption says so. A `resolveSpell` command stamp written before this change fingerprints the derived `CastCommand` under kind `cast:X` while the new code uses `resolve-spell:X`, so a retry of such an id across this change would be refused `command_id_reused` — no persistence layer exists until M3, so nothing is stranded today. Two pre-existing fixture holes were found and fixed inside the surface: `greased()` walked to the space a Grease was cast at, and a Cube excludes its own origin, so the `settleAreaEffects` idempotency entry had been settling nothing since it was written; and `restoreResourcesOn`'s exemption sentence was false for SRD's partial short-rest refill.
Unresolved concerns: the reviewer's round-three defects, both on one return statement, left unfixed because the third round closed without a PASS.
  - **The problem.** `resolvePendingSaves`'s duplicate branch (`packages/engine/src/commands.ts:6764`) returns `{ events: [], saves: [], pending: [] }`, byte-identical to the "nothing was owed" branch at `:6768`, and omits `duplicate: true`. `TurnResolution` declares that field (`:6187`) and `resolveTurn` sets it; twelve other duplicate returns in the module set theirs. Second, `pending: []` on a retry misreports a world that does owe a later save.
  - **Evidence.** `commands.ts:6764` against `:6768`; `TurnResolution.duplicate` at `:6187`; the fixture that would catch it already exists at `turn-hooks.test.ts` (the retry lands three boundaries later, where `pendingSavesOf` has 1, and the test never asserts what the retry's `pending` said).
  - **Why the approved design does not cleanly cover it.** It does — this is ordinary GREEN work the brief's item 3 implies, roughly four lines of code and two assertions. Nothing architectural is unresolved. What stopped me is the procedural rule in my own definition: three review rounds without a PASS is YELLOW, and this was the third.
  - **Options.** (a) Wake me to fix it — smallest possible change, one more reviewer round. (b) Accept the commit as it stands and record the two lines as a debt; the engine is correct either way, since the retry already emits nothing and rolls nothing, and only the *report* is thin. (c) Hand it to a follow-up task beside IE-005, which reorganises `commands.ts` anyway.
  - **Recommendation.** (a). The reviewer's own verdict says "Escalation reason: none" and the defects are two lines on one statement; everything else in three rounds is closed.
Reviewer confidence: high
Recommendation: ESCALATE

IE-003 — Independent review
Verdict: DEFECTS
Commit reviewed: 852643937f39db0ce5a653a8ea139b38abb8adf5   Gauntlet re-run: typecheck ✓ lint ✓ test 5311/5311 coverage diff ✓
Brief compliance: met. 1 extendFeature calls mayAct after the duplicate check (commands.ts:5164). 2 both sweeps are derived from the module source, cross-checked in both directions, each with a synthetic sample the classifier must catch. 3 castSpell, activateFeature, resolveDamage, resolveAttackDamage and beginRest added to GUARDED; resolvePendingSaves stamped on rolls-issued and removeCreatureEverywhere on creature-removed, both events that always happen; restoreResourcesOn additionally given an id after the builder found its exemption sentence false (SRD's regainsOnShortRest branch is not idempotent) — within item 3's "or an allowlist with a reason". 4 castOrRelease calls identify first, over the request, and carries the stamp to castSpellWith/resolveCastWith; the two guards that were conditional on `replayed` no longer need to be. 5 timersApartFrom in the reducer's creature-removed case. 6 casting_pending returned as a value for both reachable nestings. 7 one castingNumber in spells.ts, castingSource at the delayed-damage site, idempotency.ts with rest.ts importing downwards. 8 both named sentences replaced.
Tests: turn-hooks.test.ts — the wedge (save owed, creature removed, pendingSaves empty, resolveTurn advances, no timer keyed to the departed id) and the discriminating two-target Hold Person, where the ogre keeps its timer, its own boundary save and the wizard's Concentration; a purge-everything mutation dies on it. resolvePendingSaves retry runs the world on three boundaries so the retry lands where the *next* save is owed — an unstamped retry would roll that one. counterspell.test.ts — both branches of the new guard (a held Counterspell, and one aimed at a Counterspell left open by castSpell), each asserting the slot and the Reaction unspent, plus a negative control that an ordinary answer still resolves. spell-effects.test.ts — resolveSpell succeeds, caster removed, retry returns an empty batch with the original castingId and a byte-identical fold; plus a same-id-different-target refusal the derived fingerprint could not have seen. spatial-model.test.ts — anchoring 'space' normalised, and 'intersection' still refused, so the normalisation is not "ignore the field". invariants.test.ts — every swept command now asserted to emit something on its first run (this found greased() walking to a Cube's origin, which a Cube excludes, and raising no debt at all), and every mayAct case asserted twice: refused with the debt, not refused once settled. Fixtures discriminate throughout.
Regression risk: none found. golden-log.json, PROGRESS.md, docs/dev and packages/srd/raw untouched; full suite green including persistence and scenario. The four GameEvent members gained only optional fields, so every prior log folds unchanged. resolveCast/castSpell keep the kind `cast:${id}` and the same fingerprint input, so existing callers are unaffected; only resolveSpell's identity moved, and it is stricter rather than looser.
Conformance: PASS — COVERAGE.md regenerated identically, no definition touched, no claim moved.
Scope creep: none. CLAUDE.md carries more than the two sentences item 8 names, but each addition documents a behaviour this commit changed, which the repo requires.
Architectural violations: none. The Counterspell guard keys on definition.trigger, a declared field, not on a spell name; the idempotency helper is a move, not a second source of truth; nothing stored that is derived.
Hard-coded or test-specific fixes: none.
Accidental coupling: none — it removes one. rest.ts no longer imports commands.ts; idempotency.ts imports only types from events.ts, and a test pins both directions.
Foundational primitives touched: GameEvent union — `creature-removed`, `resources-restored`, `rolls-issued` each gained an optional `command` stamp (events.ts:919, :1092, :1756). The reducer's `creature-removed` case now purges timers targeting the departed creature (events.ts:3382-3400) — the brief names condition timers; the builder also purges `feature` timers, argued inert because expireEffects already checks the creature exists, and type-safety keeps `casting` timers out of reach. commands.ts: extendFeature, castOrRelease/resolveSpell identity, castSpell/resolveCast split into *With halves, resolvePendingSaves, removeCreatureEverywhere, restoreResourcesOn. New module idempotency.ts.
New runtime special cases: two, both general rather than keyed on a name — `castingIdentity` (commands.ts:7702) normalising `anchoring: 'space'` away before fingerprinting, which restates the existing "space is the absence" rule; and the nesting refusal (commands.ts:7815) keyed on `trigger === 'casting-a-spell'`.
Defects for the builder: 1. `commands.ts:6764` — the duplicate branch of `resolvePendingSaves` returns `{ events: [], saves: [], pending: [] }`, byte-identical to the "nothing was owed" branch at `:6768`, and omits `duplicate: true`. `TurnResolution` declares that field (`:6187`) and `resolveTurn` sets it (`:6860`), as do the other twelve duplicate returns in the module; without it a retrying caller cannot tell a landed command from an empty debt — the same gap the builder correctly names as a debt for `endRest`. 2. Same line: `pending: []` on a retry misreports a world that does owe a later save. The fixture that catches it already exists — `turn-hooks.test.ts:347` asserts `pendingSavesOf(later)` has 1 — so add the assertion on the returned `pending` (and on `duplicate`) there rather than writing a new one.
Escalation reason: none
Confidence: high
Recommendation: RETURN TO BUILDER
```

## Architectural gate

2026-09-13 — **inspected, at the `ARCHITECTURE_BLOCKED` wake-up.** The block
is procedural: the reviewer's third round left two defects on one return
statement and reported "Escalation reason: none", high confidence, RETURN TO
BUILDER. A fourth round is authorised for exactly those two defects. The
digest's risk signals were judged now, so the re-issued digest can take the
lightweight gate if it reports only the two-line fix.

Read: `git diff main...worktree-agent-aa0e7aa939fb1a46a` for `events.ts`,
`rest.ts` and `CLAUDE.md`; `idempotency.ts`; in `commands.ts`,
`castOrRelease` from its identity call down and `castingIdentity`; in
`invariants.test.ts`, both derived sweeps — the declaration reader, the
spender closure, the return-type classifier, both allowlists and the vacuity
samples.

- **The deviation (item 4 read further than its wording): accepted.** The
  identity is established once, by the wrapper, over the request the caller
  sent; `identify` is unchanged and same-id-different-inputs is still refused.
  Fingerprinting the request is stricter — a retry aimed at a different
  creature is now caught. The one normalisation, `anchoring: 'space'`,
  restates the "space is the absence" rule the ongoing record already applies
  and is pinned in both directions. The kind moving from `cast:` to
  `resolve-spell:` strands nothing: there is no persistence before M3, and a
  fold recomputes no fingerprint, which is why the golden log is unchanged.
- **Foundational primitives: accepted.** Three optional `command` stamps on
  the event union fold every prior log unchanged. The reducer's
  `creature-removed` purge names only the departed creature's condition and
  feature timers, iterates sorted keys, leaves casting timers alone, and is
  the fix item 5 asked for; feature timers going too is right — one kind of
  orphan is not better than two.
- **A new abstraction: the sweeps are a regex static analysis over the module
  source.** Accepted on the discipline that makes it safe: a shape the reader
  does not recognise is reported rather than classified "no", and each
  analysis is driven over a synthetic sample it must catch. Two consequences
  are recorded rather than left to be discovered. The sweep reads a file list
  (`commands.ts`, `rest.ts`), so **IE-005's split must extend that list**;
  that goes into IE-005's brief. And a spender passed by reference rather than
  called by name is a false negative the closure cannot see; no such call
  exists today.
- **`resolveCast` is unguarded by `mayAct`** and is recorded as a named debt
  in the allowlist and in `CLAUDE.md` rather than fixed, because the brief
  forbade behaviour beyond its eight items. The builder was right not to
  decide that alone. It is a one-line guard plus a sweep entry, and it goes to
  the queue as a follow-up rather than into round four, which stays minimal.
- The `CLAUDE.md` prose is honest throughout: `resolveCast` corrected from
  "the one a tool surface exposes" to a low-level half, `endRest` written as
  an open question, and the `restoreResourcesOn` exemption that was false
  replaced by an id and a fixture.

**Round four, sent by message: fix the reviewer's two defects only** —
`duplicate: true` on the duplicate branch of `resolvePendingSaves`, and
`pending` reporting the saves the world actually owes rather than `[]` —
asserted on the existing three-boundary fixture, each with a mutation. Fold
into the one commit, gauntlet, one reviewer round, fresh digest with
`Builder: COMPLETE`.

## Merge record

(none yet)
