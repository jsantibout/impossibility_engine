# Post-tranche-4 delta audit, and the next development cycle

> A **delta** audit, not the fifth whole-engine audit. Measured on `main` at
> `0ecc84e`, 2026-09-13, by the architect (Fable) in a main session with
> write access, after tranche 4 (`4b22823`..`a7013cc`) shipped ten of ten
> tasks. The fourth whole-engine audit
> (`whole-engine-audit-fourth-2026-09-13.md`, measured at `e2080da`) is the
> trusted baseline; nothing it measured and the tranche left untouched was
> re-read. What was read: every engine and workflow change since `b1a21f6`
> (67 files, +18,203/−1,808), the ten task records, the boundaries those
> changes touch, and the evidence the tranche itself produced. Two claims were
> tested by experiment rather than by reading. Nothing was implemented.

## 0. The verdict in one paragraph

Tranche 4 closed what it claimed, all ten times, and closed it in the
repository's own idiom: every new state is a fourth instance of a family that
already had three, every new command wraps a pure function that already
existed, every new guard is derived and driven over a synthetic case, and the
inviolable rule was not touched (`rolls.ts` is absent from the diff). No new
runtime special case was introduced; the one runtime behaviour change — an
untyped bystander in an area now **asks** — is the three-valued discipline
arriving where it was missing. The fourth audit's baseline is intact and
**no whole-engine audit is needed now**. What the tranche found was not
architectural drift but *instrument* drift, and it found it four times by the
same method: a derivation contradicting a hand-kept claim. Three of those
instruments are still weak and one of them is measurably broken — `npm test`
rewrites `COVERAGE.md`, so the gauntlet's byte-diff has been asserting that the
suite ran rather than that the committed file was right (confirmed here by
corrupting the file and watching one test restore it). The same invisible
character that disabled the validator's audit flag is still sitting in
`CLAUDE.md` and `QUEUE.md`, misquoting the very guard it describes. Two
correctness gaps outrank every capability below: a **held** casting loses the
damage type and the exemptions its caster stated, and the validator throws on
the untyped input it exists to judge. And the derived blocker map re-ranks the
queue: the fourth audit's next two items (a Speed modifier, a declared
"being fought" fact) are still right, but the largest blocker in the book was
in no ranking at all — a casting time of a minute or more, 54 spells touched
and 12 finished — and a casting ended by a trigger touches 29, eight of them
executed spells the engine drives today and leaves unfinished.

## 1. What changed since the fourth audit

| | at `e2080da` | now (`0ecc84e`) | note |
|---|---|---|---|
| tests | 5,578 | **6,696** across 103 files | re-run here: 6,696 passing, tree byte-clean after |
| executed / partial / verified / tracked | 86 / 54 / 62 / 46 | **91 / 52 / 69 / 46** | `COVERAGE.md` |
| event types declared / emitted by a command | 91 / 74 | **91 / 91** | derived, `invariants.test.ts` |
| unasserted refusal codes | "41 of 112" | **1 of 170** | the audits' grep was line-based; the real population was 170 |
| `commands/` modules | 21 | **23** (`scene.ts`, `declarations.ts`) | |
| `SpellEffect` kinds | 12 | **14** (`end-condition`, `damage-defense`) | |
| sourced grants on `CreatureState` | 3 | **4** (`grantedDefenses`) | enumerated by hand in five places — §3.3 |
| `EffectTarget` members | 3 | **4** (`grants`) | zero production writers today — §3.6 |
| largest function | `resolveEffects`, 914 lines | `resolveEffects`, **1,008 lines** | grew; the audit's "consequence" refactor did not happen — §3.3 |
| `events.ts` / `applyOne` | 4,570 / — | **4,794 / 1,135** | touched by 3 of the 6 mechanism tasks |
| `spell-definitions.ts` | 6,217 | 7,005 | |
| missing-shape vocabulary | 27 ids, hand-kept counts | 83 ids, **derived** counts over three populations | `scripts/missing-shapes.ts` |
| frozen fixtures | untouched | untouched | both fold |

## 2. What each task closed, verified against the diff

| Task | Claimed | Verdict | Evidence |
|---|---|---|---|
| IE-010 outcome riders, `on` | Fable's rider vocabulary; one `on` rule; `roll-mode.save` gone | **closed** | one `applyRiders`, called from the three hosts; the caster branch writes `[...new Set([casterId, ...held])]`; `checkNoNestedEffect` denylist, `RIDER_KINDS ∩ EFFECT_KINDS = ∅`; no `save` on `roll-mode`. Cost: `resolveEffects` +94 lines (§3.3) |
| IE-011 multiclass Hit Dice | `poolsFor` calls `hitDicePools` | **closed** | `hitDiePools` in `creation.ts` adapts the derivation, does no arithmetic; single-class byte-identity asserted |
| IE-012 scene commands | eight commands, an encounter from nothing | **closed** | `commands/scene.ts`, all through `once`; stamps declared on the eight events; `sceneFor` now duplicated in `movement.ts` (§3.3) |
| IE-013 format guards | zero-user sweep; lifetime rule; `SpellCheck` rules; special-case sweep over every file; settlement reads the record | **closed** | `checkGrantLifetimes`, `checkSpellCheck`; `turns.ts:500` reads `record?.areaTrigger`. Residual: `turns.ts:488` still calls `definitionFor(record.spellId)` for the definition object (name, base level) — see §3.3 |
| IE-014 condition removal | one implementation, `end-condition` | **closed, narrowed** | `endConditionsOn` in `commands/conditions.ts`, called by `useHealingTouch` and `resolveEffects`; Lesser Restoration partial on the caster's choice — the brief was wrong, the builder read the SRD |
| IE-015 `BLOCKED_ON` | derived blockers, three populations, one query | **closed** | `consumersOf`/`allShapeConsumers`; completeness asserted both ways; `SPLIT_BUNDLES` checked as arithmetic. The citation guard is name-only (§3.1) |
| IE-016 nine declared facts | every declared event type reachable | **closed** | six in `declarations.ts`, two in `movement.ts`, one in `actions.ts`; the emitted-type sweep is derived and driven |
| IE-017 granted Resistance | `defensesOf`'s third input; the `grants` timer | **closed** | `grantedDefenses`, `releaseGrants`, the timer member in `duration.ts`, cleanup through `releaseCasting`/`releaseOnTarget`/`expireEffects`. Superior Hunter's Defense deferred on three named blockers |
| IE-018 refusal sweep | derived sweep; the reachable codes asserted | **closed** | `refusal-sweep.test.ts` matches whole files, one written exemption; seven unreachable or shadowed codes reported, not fixed (§3.4) |
| IE-019 creature-type outcomes | a second reader of an authoritative fact; the unknown case asks | **closed** | `TypedSaveOutcome`/`TypedExtraDamage`; `isCreatureType` is the one comparison (targeting's three sites route through it); `creatureTypeNeeds` asked before the first die on both entry paths; `autoFail` reuses the Stunned mechanism |

**Every task also produced findings outside its brief, and the foreman queued
rather than fixed them.** That discipline held ten times. The findings are the
input to §3, not a complaint about the work.

## 3. Findings

Severity as before: **C** correctness, **A** architecture or authority,
**V** validation or conformance, **H** hygiene.

### 3.1 The instruments, and which are broken

- **V — `npm test` writes `COVERAGE.md`, confirmed by experiment.**
  `scripts/coverage.ts:626` calls `writeFileSync('COVERAGE.md', …)` at module
  top level, and `coverage.test.ts` and `spell-honesty.test.ts` import it for
  `PARTIAL_SPELLS`, `VERIFIED_SPELLS`, `EXECUTED_SPELL_IDS` and `isExecuted`.
  Appending a garbage line to the tracked file and running **one** test file
  left `git diff COVERAGE.md` empty: the suite rewrote it. So the gauntlet's
  `git diff --exit-code COVERAGE.md` step has been true whenever the suite ran,
  which is not the property it exists to assert. Every "COVERAGE.md byte-clean"
  line in ten merge records was true for the wrong reason. Nothing shipped
  wrongly *because* of it — the regenerated file and the committed file agreed
  each time — but the check cannot tell those cases apart, and that is the
  definition of an instrument that overstates itself.
- **V — The citation guard checks a name, not a quote.** `blocked-on.test.ts`
  asserts each shape description *mentions* one of four source names. It does
  not resolve the quoted run against the named document, which is how IE-015's
  sweep "corrected" a quote to the wording of a file the description did not
  cite. The repository already has the exact guard on the other axis
  (`spell-honesty.test.ts` holds an SRD quote against the spell's own
  paragraph); the missing one is the same shape over `CLAUDE.md`,
  `PROGRESS.md`, the audit records and `spell-definitions.ts`, resolving the
  **named** source rather than the corpus.
- **V — The U+0008 class is not closed; the validator was one of three
  instances.** The `check-queue.mjs` regex is fixed (`0ecc84e`). The same
  character is still in two documents, and it is the same origin — a `\b`
  written through a path that interprets escapes:

  | Where | What it reads now | What it meant |
  |---|---|---|
  | `CLAUDE.md:5894` | ``(`/<U+0008>type: '<x>'/`)`` | ``/\btype: '<x>'/`` — the emitted-type sweep's own regex, quoted in the constitutional file |
  | `QUEUE.md:75` | ``^WHOLE_ENGINE_AUDIT_RECOMMENDED<U+0008>`` | the foreman's description of the defect it had just fixed, carrying the defect |

  The code is right (`invariants.test.ts:2570` writes `\\btype:`); the prose
  about it is wrong, invisibly. A guard refusing C0 control characters in
  tracked text closes the class; it is one grep. And `check-queue.mjs` has no
  self-test at all — "a guard nobody has seen fire is a guard nobody has
  tested" applies to the validator itself.
- **H — The writing-path hazard is the workflow finding.** Three instances of
  `\b` becoming a backspace, all on 2026-09-13, all in files the foreman
  writes. Whatever tool path did it, the repair is a mechanical guard rather
  than a rule for agents to remember.

### 3.2 Correctness

- **C — A held casting loses what its caster stated.** `PendingCasting`
  (`events.ts:488–542`) carries `targets`, `slot`, `route`, `origin`, `area`
  and `unverified`, and **neither `damageType` nor `unaffected`**. The atomic
  path pins both on the ongoing record (`spell-resolution.ts:1969–1970`); the
  declared path settles from the pending record, so a Spirit Guardians
  declared with `hold: true` (a Counterspell window open) settles with the
  definition's printed type, and its designated-unaffected list is gone. A
  Necrotic-immune Undead is where it shows. IE-014's builder found it; it is
  pre-existing; it is the exact failure `damageTypeStated` was built to
  prevent, reappearing on the one path that carries a casting across a window.
  Silently wrong number, shipped and reachable — **first in the next cycle**.
- **C — The validator throws on the input it exists to judge.**
  `checkEffect`'s `end-condition` and `damage-defense` branches dereference
  `effect.conditions.length` and `effect.damageTypes.length` unguarded
  (`spell-schema.ts:561`, `:704`), so `parseSpellDefinition(unknown)` throws a
  `TypeError` where its contract is to return a problem. Three instances of
  the class now (the IE-010 re-review caught the first in `grantCarried`, where
  it was a real regression). The throw-safety sweep asserts only
  `.not.toThrow()`, so it would also pass if the validator began accepting
  malformed input.
- **V — `TargetRule.mustBeType` is an unvalidated `string`** while
  `againstType.types` is held to `CREATURE_TYPES`; `mustBeType: 'Goblinoid'`
  validates and matches nobody for ever.

### 3.3 Architecture

- **A — `resolveEffects` grew to 1,008 lines, and the reason is in the
  briefs.** The fourth audit (§3.8) said the per-kind branches "want to become
  per-kind functions as a *consequence* of that task, not a task of their
  own". Every union brief then said "Splitting `resolveEffects` is not this
  task", and four tasks added inline branches — `onMiss`, `end-condition`,
  `damage-defense`, `againstType` — for a net +94 lines. `applyRiders` is a
  genuine reduction inside it; the function around it is the D12 finding
  relocated **and growing**. The remedy is the one IE-005 already proved on
  `commands.ts`: a behaviour-preserving split with the whole spell suite and
  both frozen logs as the oracle. It belongs at the head of the next union
  chain so the five kinds that follow land as functions rather than branches.
- **A — Four sourced grants, enumerated by hand in five places.** `bonuses`,
  `armorClasses`, `rollModifiers`, `grantedDefenses` are one family — sourced,
  ended through one door — and `releaseCasting`, `releaseOnTarget`,
  `releaseGrants`, `holdsNothingOf` and `expireEffects` each spell out all four.
  IE-017 added the fourth correctly and touched all five sites. The next cycle
  wants three more members of the family (a Speed modifier, a healing modifier,
  a weapon-attack rider). Seven arrays in five hand-written lists is the
  generalization rule's trigger arriving three times at once. **Not a
  collapse** — the four have different identities (`rollModifierKey` against a
  bare source) and different readers, and a discriminated union would change
  every reader for no rules gain. **One enumerator**: `grantSourcesOf(creature)`
  and `withoutGrants(creature, predicate)` in `events.ts`, with the five sites
  routed through them, so a fifth kind is one entry in one place. Tested by the
  mutation that drops one kind from the enumerator and must redden both the
  bonuses and the granted-defences suites.
- **A — `events.ts` is now the serialisation bottleneck the split of
  `commands.ts` was meant to remove.** Three of tranche 4's six mechanism tasks
  changed it (declarations, then the reducer and state for a grant), and every
  mechanism task proposed below touches it. The one-owner rule is right; the
  cost is that the mechanism lane is serial whatever the concurrency elsewhere.
  `applyOne` alone is 1,135 lines. This is the third audit's `commands.ts`
  finding arriving one file down, and it is the first named candidate for the
  simplification audit — not for this cycle, because a 4,800-line
  behaviour-preserving split would stall every mechanism task behind it.
- **A — `EffectTarget.grants` has no production writer.** Built as Fable
  specified, driven end to end by a hand-built feature grant, and consumed by
  nothing that ships: Superior Hunter's Defense was deferred on three blockers
  that are not the grant. That is a zero-user member of the same class IE-013
  hunts in the definition format, and it is honest to say so. The next cycle
  gives it its first production writer — Ray of Frost's Speed penalty "until
  the start of your next turn", a modifier rider with a deadline of its own —
  which is what the member was for.
- **H — `SlotlessReason` declares `'ritual'` and nothing writes it**
  (`spells.ts:88`). Same class; the long-casting task below is its user.
- **H — `sceneFor` is duplicated**, prose included, in `commands/scene.ts:91`
  and `commands/movement.ts:812`. Both authors said a third copy is the moment
  to hoist; the teleport command below is the third copy.
- **H — `castOnHit` (`attacks.ts:724–736`) hand-builds the `creature-type`
  request** that `creatureTypeNeeds` builds in `spell-resolution.ts`. Two
  spellings of one request; the field names agree today.
- **H — Settlement still opens the catalogue for the definition object.**
  IE-013 made `settleAreaEffects` read the pinned clause (`record.areaTrigger`),
  and `turns.ts:488` still resolves `definitionFor(record.spellId)` for the
  `definition` handed to `resolveEffects` — its `name` and base `level`, the
  latter feeding `scaledDiceFor`'s per-slot delta. A corrected base level
  would move a historical settlement. Small, and worth one line: pin `level`
  on the record where `spellId` is, or read it off `OngoingSpell.level`.

### 3.4 Hygiene, carried from the digests

- **V — Seven refusal codes are unreachable, shadowed or overloaded**, reported
  by IE-018 and correctly not fixed there: `no_trigger` carries five distinct
  rules across three modules; `nothing_to_interrupt` is exempt as unreachable;
  `not_a_combatant` at `dash` is shadowed; `bad_key` cannot be returned
  because an empty key reaches the reducer and throws; `slot_not_allowed`,
  `bad_hit_die`'s second site and `no_damage` likewise. And `spendMounting`
  remaps every non-movement refusal to `not_enough_movement`. A refusal code
  is observable behaviour, so this is the cheapest moment there will ever be
  to fix them: before M2's tool surface exists to branch on one.
- **V — `ContextRequest.satisfyWith` names events where commands now exist**
  (`targeting.ts` "a scene-set event" ×3; `movement.ts` "a creature-placed
  event"), and `resolveMove` still answers `no_scene` with a bare
  `needsContext` carrying no request. A sweep asserting every `satisfyWith`
  names an exported command closes the class.
- **H — Dead state is unchanged across two audits**: `GameState.seed` (0
  readers), `eventCount` and `rollsIssued` (test readers only),
  `pendingDamageOf` and `pendingTestOf` (barrel-published, 0 callers),
  `spellOfSource` (0 callers). Simplification-audit material; named again so
  it is not forgotten.

### 3.5 What the derived map changes about prioritisation

The fourth audit ranked from three documents that disagreed. `COVERAGE.md`
now prints, per shape, what it **blocks** and what it alone **finishes**. Read
against the candidates the audit and the queue named, the picture moves:

| Shape | blocks | finishes | executed partials it holds | what building it does |
|---|---|---|---|---|
| `a-long-casting-time` | 54 | **12** | — | the largest blocker in the book, in no ranking; the 12 are utility spells cast outside combat (Identify, Alarm, Find the Path, Legend Lore, …) |
| `a-casting-ended-by-a-trigger` | 29 | 1 | **8** (Invisibility, Mage Armor, Animal Friendship, Suggestion, Mass Suggestion, Charm Person, Charm Monster, Hypnotic Pattern) | makes 4 executed spells whole outright and 2 more with the fact below |
| `a-fact-only-the-table-can-declare` | 9 | 1 | 5 (the Charms and Dominates) | the audit's C2 replacement, still right |
| `speed-and-movement-modes` | 16 | 0 | 2 (Ray of Frost, Hypnotic Pattern) | plus 3 tracked → executed is a misreading: only Longstrider is a *modifier*; Fly and Spider Climb are *modes*, which the audit refused — the id is a bundle and must split |
| `a-rider-on-a-later-weapon-attack` | 10 | 3 (Divine Favor, Magic Weapon, True Strike) | — | plus Hunter's Mark with the next row |
| `a-duration-the-slot-changes` | 10 | 1 | 4 (three Dominates, Mass Suggestion) | a small format field |
| `teleportation` | 9 | 2 (Dimension Door, Tree Stride) | — | plus Misty Step tracked → executed |
| `healing-modified-by-an-effect` | 2 | 0 | 2 (Chill Touch, Beacon of Hope) | still two consumers; cheaper once the enumerator exists |
| `a-choice-made-at-the-casting` | 24 | **0** | 4 | a general choice bag would finish nothing alone; deferred (§5.6) |
| `an-action-a-spell-compels-or-forbids` | 26 | 3 | 9 | authority-bound; deferred |

Taken together, the first seven shapes finish **24** undefined spells, make
**10** executed partials whole, and move **4** tracked spells to executed —
measured by a query over the map, not estimated. That is the leverage case for
the cycle in §5, and every number in it regenerates.

### 3.6 Are the new abstractions broader than their evidence?

| Member | Consumers | Verdict |
|---|---|---|
| `OutcomeRiders` (three slots) | conditions ×8 spells, modifiers ×1, delayed ×2 | decided at the owner's gate; every slot has a user |
| `RiderDuration { seconds }` | Sunburst | one, transcribed; the alternative was wrong |
| `attack.onMiss: 'half'` | Acid Arrow | one, the mirror of `onSuccess` |
| `TypedSaveOutcome` / `TypedExtraDamage` | 2 + 1 | the two shapes the SRD prints; the third (automatic success) correctly not carried |
| `end-condition` | 2 | one implementation shared with a feature |
| `damage-defense` | 3 | `defensesOf`'s third input |
| `EffectTarget.grants` | **0 shipped** | justified by §3.4 of the fourth audit; gets its first writer in §5 |
| `SlotlessReason.ritual` | **0** | pre-existing; gets its user in §5 |
| the 17 commands | each wraps an existing pure function | none invents a rule |

Nothing is broader than its evidence. Two members are *ahead* of their first
writer, and both are named with the task that supplies it.

### 3.7 Remove or simplify rather than extend

- The five hand-written grant enumerations → one enumerator (§3.3).
- `resolveEffects` → per-kind functions (§3.3).
- `sceneFor` ×2 → one, when the third copy arrives.
- `speed-and-movement-modes` → split into the modifier the engine will own and
  the modes it will not.
- The dead state in §3.4, for the simplification audit.
- Nothing built in tranche 4 should be removed.

## 4. Is the fourth audit's baseline still trustworthy? Is a full audit due?

**Yes, and no.** Every change since `e2080da` is inside a shape that audit
described, and the four things the foreman's `WHOLE_ENGINE_AUDIT_RECOMMENDED`
flag cites are *document* failures found and closed by derivations — the
ranked map, the stat-block row, the refusal count, the leverage counts. The
criterion "repeated stale source-of-truth failures" was met, and the method
that met it is the fix. What is not closed is the pair of instrument
weaknesses in §3.1 plus the third one this audit found, and those are three
small tooling tasks, not a whole-engine question. No YELLOW, no RED, no new
special case, both fixtures fold, `rolls.ts` untouched, and the sweeps that
watch the boundaries are all derived.

**Recommendation: NO full whole-engine audit now.** This record discharges the
flag; the foreman clears it in `QUEUE.md` citing this file. The next broad
audit falls due by the owner's cadence after tranche 5, and §5.8 says why it
should be the *simplification* pass rather than a fifth retrospective.

## 5. The next development cycle — tranche 5

### 5.1 Throughput, honestly

Tranche 4: ten tasks, four waves, planned at five hours, done in roughly two
and a half — about four tasks an hour with four builders, and the four-task
union chain was the critical path. The binding constraint below is the same:
**the mechanism lane is serial** (every mechanism task touches `events.ts`,
`commands/spell-resolution.ts`, or both), and the parallel pool fills beside
it. Eight serial mechanism slots at 40–50 minutes each is five and a half to
six and a half hours; the pool runs two to four wide beside it. Eighteen tasks,
eight waves. The last two mechanism tasks are the tail: include them if Opus
can brief them to the bar, and the foreman defers them on evidence if the
window closes first.

### 5.2 Goals, ranked

1. **Repair the instruments before trusting them further** — the three §3.1
   tasks, and the validator's own contract.
2. **Fix the two shipped correctness gaps** — the held casting's stated facts;
   the validator's untyped input.
3. **Pay down the two structural costs tranche 4 exposed** — the
   `resolveEffects` split and the grant enumerator — *before* five more kinds
   land on them.
4. **Buy coverage with mechanisms the map ranks**, in this order: a casting
   ended by a trigger; the declared "being fought" fact; a Speed modifier; a
   long casting time outside combat, with rituals; a rider on later weapon
   attacks with a duration the slot changes; teleportation.
5. **Convert the mechanism into content where the map says it is finished** —
   the twelve long-casting utility spells as tracked definitions.

### 5.3 The tasks

**The parallel pool** (conformance, tooling, content; `parallel-safe: YES`
unless noted). Each is GREEN; the architecture is stated here.

| | Task | What it must do | Surface |
|---|---|---|---|
| **P1** | `COVERAGE.md` has one writer | Move the data (`PARTIAL_SPELLS`, `VERIFIED_SPELLS`, `isExecuted`, `EXECUTED_SPELL_IDS`, the audit functions) into a side-effect-free module the tests import, and leave `coverage.ts` as the renderer whose write runs only under a main-module guard. A source sweep asserts `writeFileSync` sits under that guard, driven by a mutation. The gauntlet is unchanged and its byte-diff regains its meaning | `scripts/coverage.ts`, a new `scripts/coverage-data.ts`, the two importing tests |
| **P2** | The citation guard reads the named document | For every quoted run in a `MISSING_SHAPES` description and in every adjudication note that names a repository source, resolve the source name to a file by a small alias table (`CLAUDE.md`, `PROGRESS.md`, the audit records, `spell-definitions.ts`), normalise emphasis and whitespace, and assert the run is in **that** file; driven by a synthetic misquote. The repository's two spellings of the Mass Cure Wounds sentence are resolved by naming, not by editing either | `blocked-on.test.ts`, `scripts/missing-shapes.ts` descriptions where they must name a file |
| **P3** | No invisible characters; the validator is tested | A check refusing C0 control characters (other than tab, LF, CR) in tracked `*.md`, `*.ts`, `*.mjs`, `*.json`, in the gauntlet; fix `CLAUDE.md:5894` and `QUEUE.md:75`; a fixture-driven self-test of `check-queue.mjs` that the audit flag prints when set and not otherwise | `check-queue.mjs`, a script or test, the two lines |
| **P4** | The validator judges untyped input everywhere | Guard every `checkEffect` branch so `parseSpellDefinition(unknown)` reports rather than throws; the throw-safety sweep asserts `isErr` too; `mustBeType` validated against `CREATURE_TYPES`; the array-rider cosmetic in `grantCarried` | `spell-schema.ts`, `spell-schema.test.ts` |
| **P5** | Refusal-code hygiene before a caller can branch | IE-018's seven, outside the casting path: unshadow or remove `not_a_combatant` at `dash`; make `bad_key` a value; the `slot_not_allowed`, `bad_hit_die` and `no_damage` sites; stop `spendMounting` remapping refusals. Every change asserted in `refusals.test.ts`. The two in the casting path (`no_trigger`'s five rules, `nothing_to_interrupt`) belong to M7, which owns that file | `actions.ts`, `pools.ts`, `movement.ts`, `rest.ts`, tests. **Not beside M6a** (same modules) |
| **P6** | A feature-definition validator | `checkFeatureDefinition` over all 230 features, the third audit's open item: namespaced unique ids; a level the class table reaches; a `manual` feature carries a non-hollow note; an `engine` feature's `grants.kind` (or pool, or standing requirement) is one the engine **reads** — derived from the readers in `standing.ts`, `creation.ts`, `commands/features.ts`, not listed; `fixed` spell grants exist in the parsed book and on the class list; pool sizing names a real column; a zero-user sweep over `FeatureGrant` members with written exemptions. The nine-features-on-a-note failure is what this exists to catch structurally | new `feature-schema.ts`, the twelve class files (data fixes only), tests |
| **P7** | Every context request names its command | `satisfyWith` names `setScene`/`placeCreatureInScene` where it says an event; `resolveMove`'s `no_scene` carries a request; a sweep asserts every `satisfyWith` names a command the barrel exports | `targeting.ts`, `movement.ts`, `invariants.test.ts`. Before M5 and M6a |
| **P8** | The twelve spells a long casting time alone blocked | After M7: Alarm, Clairvoyance, Commune with Nature, Fabricate, Find the Path, Hallucinatory Terrain, Identify, Illusory Script, Instant Summons, Legend Lore, Magic Mouth, Mending — each read against its SRD paragraph, tracked (or executed where the kinds fit), with the tracking guard's adjudications; the ten "Ritual casting option is not modelled" clauses removed; the map entries move | `spell-definitions.ts` definitions and registry, `missing-shapes.ts`, `COVERAGE.md`. Content lane; collides with M9 only on registry lines |

**The mechanism chain**, serial except where marked. Each names the SRD line
it transcribes; the architecture is decided here and is GREEN for Opus.

| | Task | Design, decided | Surface |
|---|---|---|---|
| **M1** | A held casting keeps its stated facts (**correctness**) | `PendingCasting` gains optional `damageType` and `unaffected`; declaration writes them from the request; settlement passes them to `resolveOnTargets` exactly as the atomic path does. Reproduce first: hold Spirit Guardians stated Necrotic, settle, assert the trigger's damage is Necrotic and a designated creature is spared; hold Protection from Energy stated Cold, assert the grant is Cold. Both fixtures fold (optional fields) | `events.ts` (record), `casting.ts`, `spell-resolution.ts` |
| **M2** ∥ **M3** | **M2** — `resolveEffects` split into per-kind resolvers, behaviour-preserving | One function per effect kind over a shared context; `resolveEffects` keeps the pre-flight and the loop. Oracle: the whole spell suite, both frozen logs, `scenario.test.ts`'s re-run determinism. The IE-005 precedent: declaration-level equivalence, no behaviour change, reviewer verifies the move | `spell-resolution.ts` only |
| | **M3** — one enumerator for a creature's sourced grants | `grantSourcesOf(creature)` and `withoutGrants(creature, predicate)`; `releaseCasting`, `releaseOnTarget`, `releaseGrants`, `holdsNothingOf` and `expireEffects` route through them; keys and readers unchanged. Mutation: dropping one kind from the enumerator must redden the bonuses **and** the granted-defences suites | `events.ts` only |
| **M5** ∥ **M6a** | **M5** — the declared "being fought" fact | SRD Charm Person: "It does so with Advantage if you or your allies are fighting it." A definition clause on a host that rolls a save (`advantageIfFought: true`, validator-refused elsewhere); `CastSpellRequest.fought: boolean`, **required** when the definition prints the clause and refused when it does not — the mirror of `damage_type_required` / `unknown_damage_type` — and carried on the pending record through M1's carrier; applied as a named `ModeSource` inside the save so it cancels rather than counts. Consumers: Charm Person, Charm Monster, the three Dominates (their fact clause closes), Enthrall (finished) | `spell-definitions.ts` types, `targeting.ts` (`declaredFacts`), `spell-resolution.ts`, `spell-schema.ts`, `events.ts` (one record field) |
| | **M6a** — Speed is read live, through one reader | `speedOf(state, id)` in `standing.ts` is the only reader of a creature's Speed in the command layer. Order, decided because the SRD prints none: base, plus flat changes (features, and Exhaustion's −5 per level), then **halved once** if any halving effect applies (presence, not count — the reading Resistance and Advantage already take), then **0** if any zeroing effect applies (Grappled, Restrained, a Speed-0 grant), never below 0. Feature grants derived like `standingDefenses`: Fast Movement (+10 unarmoured), Unarmored Movement (the Monk table), Roving (+10). The budget records what has been **spent** and the allowance is read live at every spend, so a mid-turn increase is honoured and distance already moved is never handed back; Dash adds `speedOf`; mounting costs half of `speedOf`. The pinned `combatant.speed` stops being read for allowances. Steady Aim stays manual ("until the end of the current turn" is a `Duration` member with no other consumer) | `standing.ts`, `combat.ts` (budget arithmetic), `movement.ts`, `actions.ts`, the class files' notes. **After P5 and P7** |
| **M4** | A casting ended by a trigger | SRD Invisibility: "The spell ends early immediately after the target makes an attack roll, deals damage, or casts a spell." Mage Armor: "ends early if the target dons armor." Animal Friendship: "if you or one of your allies deals damage to the target, the spell ends." Charm Person: "until you or your allies damage it." A closed `endsEarly` list on the definition — `target-attacks`, `target-deals-damage`, `target-casts`, `target-dons-armor`, `caster-or-ally-damages-target` — pinned on the ongoing record, and a **derived** pass in the reducer after each event that releases the casting (or releases on that target for a multi-target charm), the way expiry and a lost Concentration already are: nobody decides it, so no event. Two constraints: hang a trigger on the consequence event and **never on `roll-recorded`**, which changes no state by rule; and where "ally" needs a `side` nobody has declared, the ending is **withheld**, not invented — the same three-valued reading Sneak Attack takes, with a query rather than an `unverified` line because a derived pass has none. Consumers: Invisibility, Mage Armor, Animal Friendship, Suggestion whole; Charm Person and Charm Monster whole with M5; Mislead finished | `spell-definitions.ts` types, `events.ts` (record field, reducer pass), `spell-schema.ts`, `spell-resolution.ts` (record write). **After M2 and M3** |
| **M6b** | A Speed an effect changes | A fifth sourced grant through M3's enumerator — `{ source, change: add(feet) \| halve \| zero }`, event `speed-modifier-granted`, ended through the existing door; `speedOf` reads it. A standalone `speed` effect kind (Longstrider: "Speed increases by 10 feet until the spell ends") and a `ModifierRider` kind `speed` that may carry `lasts` — Ray of Frost's "Speed is reduced by 10 feet until the start of your next turn" on a cantrip is the **first production writer of the `grants` timer**, and `checkGrantLifetimes` reads it. Hypnotic Pattern's Speed 0 rides the Charmed save. The shape id splits: the modifier the engine now owns retires; `movement-modes` keeps Fly, Spider Climb, Gaseous Form and the rest as the gap the audit refused to build. Longstrider tracked → executed; Ray of Frost and Hypnotic Pattern leave partial; Slow stays undefined on its other clauses | `events.ts`, `spell-definitions.ts`, `spell-schema.ts`, `spell-resolution.ts`, `standing.ts`, `missing-shapes.ts`. **After M6a and M4** |
| **M7** | A long casting time outside combat, and rituals | SRD: "While you cast a spell with a casting time of 1 minute or more, you must take the Magic action on each of your turns, and you must maintain Concentration while you do so. If your Concentration is broken, the spell fails, but you don't expend a spell slot." And: "The Ritual version of a spell takes 10 minutes longer to cast than normal, but it doesn't expend a spell slot." **The two-event casting is the state machine's skeleton and already exists.** `castingTime: 'long'` gains a required `castingSeconds`, oracled against the parsed casting time by the range/duration precedent. Outside combat such a casting is a **declared** casting — the action spent, prior Concentration dropped, the id allocated — whose pending record carries `completesAt`; the caster concentrates **on the casting itself** from declaration (a `concentration-started` naming the pending id), so the existing damage save fires, and a lost Concentration on a pending casting clears it derived-ly — spell failed, slot never spent, nothing to refund. Settlement is refused (`still_casting`) until the clock reaches `completesAt`; `advanceTime` is how it gets there; on settlement a non-Concentration spell's casting-Concentration ends with reason `completed` in the same batch, and a Concentration spell's simply continues under the same id. `ritual: true` on the request: legal only for a definition carrying the parsed Ritual tag, adds 600 s, takes `SlotlessReason.ritual` (its first writer), and refuses a slot level above the spell's. Preparation stays unjudged, as it is for every casting. **In combat the refusal stands**, its reason naming the per-turn Magic-action obligation as the machinery that is still missing (M7b, next cycle). Owns the two casting-path refusal items P5 leaves: `no_trigger`'s five rules and `nothing_to_interrupt` | `spells.ts`, `events.ts` (record, Concentration branch), `casting.ts`, `spell-resolution.ts`, `spell-schema.ts`, the oracle, `coverage.ts`. **After M6b.** Likely YELLOW: if a reader assumes `concentration.castingId ∈ ongoing` |
| **M9** ∥ **P8** | **M9** — a rider on later weapon attacks, and a duration the slot changes | SRD Divine Favor: "you deal an extra 1d4 Radiant damage on a hit" with weapon attacks; Hex: "an extra 1d6 Necrotic damage to the target whenever you hit it with an attack roll"; Hunter's Mark the same with Force. Two sub-shapes and one grant: a sourced rider on the **caster's** attacks — dice, type, and an optional **marked target** (Hex, Hunter's Mark) or none (Divine Favor) — read by `resolveAttackDamage` beside `featureDamageTypes`, a sixth member of the enumerated family, ended through the door. And `durationAtSlot: { level: seconds }` on the definition so Hunter's Mark's hour becomes eight at level 3 and twenty-four at level 5, read where `persists` schedules the deadline; the three Dominates and Mass Suggestion take it too. Hex's chosen ability stays a named gap. Finishes Divine Favor, Magic Weapon (with `replacesPriorCasting`), True Strike, Hunter's Mark, Major Image | `attack.ts`/`attacks.ts`, `events.ts`, `spell-definitions.ts`, `spell-schema.ts`, `spell-resolution.ts`. **After M7** |
| **M10** | Teleportation inside the scene (**the tail**) | SRD Misty Step: "you teleport up to 30 feet to an unoccupied space you can see"; Dimension Door: "You teleport to a location within range." A `teleport` effect kind and a `relocateCreature` command that emits `creature-moved` with **no** `movement-spent`, no `pendingMove` and no Opportunity Attack; refuses an occupied destination, a destination outside the scene or beyond the range measured from the caster; sight is declared per the existing discipline; area entry fires because the position changed, which is the SRD's reading of arriving inside a Web. Hoists `sceneFor` — this is its third copy. Misty Step tracked → executed; Dimension Door and Tree Stride finished | `positioning.ts` or `movement.ts`, `spell-definitions.ts`, `spell-resolution.ts`, `commands.ts`. **After M9.** Defer if the window closes |

### 5.4 Waves and dependencies

```
Wave 1  M1 · P1 · P2 · P3 · P4 · P6 · P7          (nothing waits; up to 7 independent)
Wave 2  M2 ∥ M3 · P5                               (after M1; P5 after P7)
Wave 3  M5 ∥ M6a                                   (M5 after M3; M6a after P5, P7)
Wave 4  M4                                         (after M2, M3, M5)
Wave 5  M6b                                        (after M6a, M4)
Wave 6  M7                                         (after M6b; owns casting.ts)
Wave 7  M9 ∥ P8                                    (after M7)
Wave 8  M10                                        (after M9; the tail)
```

**What serialises, by primitive.** `events.ts`: M1 → M3 → M5 → M4 → M6b →
M7 → M9. `commands/spell-resolution.ts` and the definition types: M1 → M2 →
M5 → M4 → M6b → M7 → M9 → M10. `commands/movement.ts` and `actions.ts`: P7
→ P5 → M6a → M10. `spell-schema.ts`: P4 first, then each union task adds its
rule. What is genuinely parallel: the whole of wave 1; M2 beside M3 (different
files, no shared primitive); M5 beside M6a; M9 beside P8 (registry lines only,
mechanical). Concurrency per wave: 7, 3, 2, 1, 1, 1, 2, 1 — bounded by the
independence check, never by a number.

### 5.5 Architecture already decided, and safe for Opus

Everything in §5.3 that is stated as a design is decided here and is GREEN:
the enumerator rather than a collapse; the per-kind split; the Speed order
(flat, then halve once, then zero); the live allowance; the trigger endings as
a derived pass hung on consequence events and withheld without a declared
`side`; the "being fought" fact as a required stated fact mirroring the damage
type; the long casting as a declared casting concentrating on itself, with the
in-combat obligation deferred; the weapon rider as a sixth grant with an
optional marked target; teleport as `creature-moved` without a budget. A
deviation from any of these is `ARCHITECTURE_BLOCKED`, as IE-010's was.

**Bounded questions that may come back to Fable during execution** — one
plausible YELLOW, named in advance:

- **M7**: whether `creature.concentration` can name a *pending* casting id
  without breaking a reader that assumes the id is in `ongoing`
  (`holdsNothingOf`, `ongoingSpellsBy`, the Dispel readers). The design says
  it can, because a pending casting owns nothing yet; if a reader disagrees,
  stop and ask rather than special-case it.
- **M4**: none foreseen, unless an SRD ending clause turns out to need a fact
  the log does not hold — then it is filed, not modelled.
- **M6a**: none, if the stated order is accepted.

No RED. Nothing here changes a product behaviour the owner has not already
decided, invalidates a completed system, or touches the authority boundary.

### 5.6 Deliberately deferred, with reasons

| Not in this cycle | Why |
|---|---|
| **The in-combat long casting** (the per-turn Magic-action obligation, M7b) | A `continueCasting` command plus a derived failure at the caster's turn boundary; real, and the second half of a task whose first half finishes twelve spells on its own |
| **A general "choice made at the casting" bag** (24 blocks, 0 finishes) | Two stated facts will exist after M5 (`damageType`, `fought`); a third (an ability chosen — Hex, Enhance Ability, Bestow Curse) is the evidence for a bag, and it finishes nothing alone |
| **Modified healing** (Chill Touch, Beacon of Hope) | Two consumers; M3 makes it a one-slot task next cycle and it stays two consumers until then |
| **A condition Immunity a spell grants** (10 / 1) | Needs `conditionApplicability` to read `CreatureState` rather than `AdaptedMonster`, and `applyConditionTo` to consult it — the first candidate after this cycle |
| **Heal's flat 70** | IE-014's builder measured six resolution paths behind `DiceScaling.dice`; not a format one-liner |
| **Superior Hunter's Defense** | Three blockers named by IE-017, none of them the grant |
| **`an-action-a-spell-compels-or-forbids`**, summons, a second scene, walls and barriers, falling, movement modes | Unchanged standing: authority-bound or a vocabulary with no reader |
| **Splitting `events.ts`** | The serialisation bottleneck (§3.3), but a 4,800-line split would stall every mechanism task behind it; the simplification audit's first item |
| **Per-event schemas, `index.ts` tiering, the snapshot policy for the two indexes** | M2's and M3's owners; nothing here needs them |

### 5.7 Source-of-truth and tooling repair that must land before capability work is trusted

P1, P2 and P3 — in wave 1, before any merge record can again claim
`COVERAGE.md byte-clean` for the right reason, and before a fifth quote is
"corrected" against the wrong file. P4 belongs with them: a validator that
throws is not validating. None blocks M1, which is why wave 1 runs them
beside it rather than ahead of it.

### 5.8 The simplification audit: APPROACHING

The cadence says three to five broad audits, or a subsystem reaching
structural maturity. Four are done. The evidence that it is near: four grant
arrays becoming seven; a 1,008-line resolver; a 4,794-line reducer file that
serialises every mechanism task; dead state unchanged across two audits; two
`sceneFor`s; two marker lists. **Not DUE yet, and not before tranche 5**: M2
and M3 are targeted repairs of the two largest items, and the audit should
measure the engine *after* they land rather than recommend them. After
tranche 5 it is DUE, and it should be the pass the owner runs next in place of
a fifth retrospective.

## 6. Measurement notes

- The `COVERAGE.md` side effect was proved by appending a line to the tracked
  file, running `vitest run packages/engine/src/coverage.test.ts` alone, and
  reading an empty `git diff --stat COVERAGE.md`; the file was restored with
  `git checkout` afterwards and the full suite re-run (6,696 passing, tree
  clean).
- Control characters were found with a `[\x00-\x08\x0B\x0C\x0E-\x1F]` grep
  over tracked text and confirmed by `od -c` on the two lines.
- `resolveEffects` and `applyOne` sizes are from the export line to the first
  column-zero brace; the per-task attribution is `git show --stat` per merge
  commit; the union chain's growth is the diff of `spell-resolution.ts` since
  `b1a21f6`.
- The blocks/finishes figures in §3.5 and the "24 finished / 10 whole / 4
  converted" totals were computed by a script over `consumersOf`, `BLOCKED_ON`,
  `ADJUDICATED` and `TRACKED_ADJUDICATED` as merged, not read from prose.
- The `PendingCasting` field list, the `SlotlessReason` and `CastingTime`
  unions, `spendMovement`'s allowance arithmetic and `beginTurn`'s budget were
  read, not executed; every task in §5.3 begins with its own reproduction, and
  Opus verifies these premises against `main` before briefing.
- SRD lines quoted in §5.3 are `packages/srd/raw/spells.md:175` (longer
  casting times), `rules-glossary.md:1226` (rituals), `spells.md:951` (Charm
  Person), `:3420` (Invisibility), `:3583` (Mage Armor), `:343` (Animal
  Friendship), `:3173` (Hex), `:3240` (Hunter's Mark), `:1771` (Dimension
  Door), `rules-glossary.md:1307–1313` (Speed).

## Audit summary block

```
Post-tranche-4 delta audit — 2026-09-13, at 0ecc84e (baseline: fourth whole-engine audit at e2080da)
Scope measured: the 67-file diff since the fourth audit and the boundaries it touches; the ten task records; the derived blocker map against the audit's ranking; two instrument claims by experiment; the SRD text behind every proposed mechanism.
Verdict: Tranche 4 closed all ten claims inside existing shapes with no new special case; the baseline stands and NO whole-engine audit is due. What drifted is the instruments: `npm test` rewrites COVERAGE.md (proved), the citation guard checks a name not a quote, and the U+0008 that disabled the audit flag is still in CLAUDE.md and QUEUE.md. Two shipped correctness gaps outrank capability: a held casting loses its stated damage type and exemptions; the validator throws on untyped input. The derived map re-ranks the queue: a long casting time is the largest blocker in the book (54 / 12) and was in no ranking; a casting ended by a trigger touches 29 with eight executed partials.
Findings, ranked: 1. PendingCasting carries no damageType/unaffected — events.ts:488–542 vs spell-resolution.ts:1969 — a silently wrong damage type on the held path. 2. npm test writes COVERAGE.md — coverage.ts:626 imported by two tests — the gauntlet's byte-diff proves the wrong thing. 3. U+0008 in CLAUDE.md:5894 and QUEUE.md:75 — the validator's defect class, unclosed. 4. resolveEffects 914 → 1,008 lines — the audit's "consequence" refactor forbidden by every brief. 5. Four sourced grants hand-enumerated in five sites — events.ts — with three more kinds queued. 6. checkEffect dereferences untyped input — spell-schema.ts:561/:704 — the validator throws. 7. Citation guard is name-only — blocked-on.test.ts. 8. EffectTarget.grants and SlotlessReason.ritual have zero production writers. 9. Seven refusal codes unreachable/shadowed; satisfyWith names events; sceneFor ×2; a hand-built creature-type request in attacks.ts. 10. events.ts is the serialisation bottleneck (3 of 6 mechanism tasks; 4,794 lines).
Confirmed healthy: rolls.ts untouched all tranche; both fixtures fold; every declared event type emitted; every command through `once`; every new grant through the existing door; isCreatureType the one comparison; the unknown type asks on both entry paths; no shape broader than its evidence; ten out-of-brief findings queued rather than fixed.
Recommended cycle: tranche 5 = 18 tasks in 8 waves — a 7-wide repair-and-validation wave (M1 held-casting facts; P1 COVERAGE.md writer; P2 citation guard; P3 control characters + validator self-test; P4 validator untyped input; P6 feature validator; P7 context requests name commands), then M2 resolveEffects split ∥ M3 grant enumerator ∥ P5 refusal hygiene, then M5 "being fought" ∥ M6a Speed read live, then M4 casting ended by a trigger, M6b Speed grants, M7 long casting outside combat + rituals, M9 weapon rider + duration by slot ∥ P8 twelve long-casting spells, M10 teleport as the tail. Architecture decided here for every mechanism; one plausible YELLOW (M7's Concentration on a pending casting); no RED. Simplification audit APPROACHING, due after tranche 5.
Nothing was implemented.
```
