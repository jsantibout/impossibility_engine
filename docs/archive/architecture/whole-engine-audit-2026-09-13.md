# Whole-engine audit, the third: measured after five batches

> The doctrine is the constitution, `CLAUDE.md` says how the code works,
> `PROGRESS.md` audits conformance. This is the third code audit against the
> doctrine, after `fabb8eb` (the engine audit) and `f2512c7` (the second
> architecture audit). It was run before the first batch under the new
> development workflow (`docs/dev/WORKFLOW.md`), because five engine batches
> had landed since the last one and the counter said so.
>
> Method: four read-only measurement sweeps by Opus subagents — the command
> file's domain map and seams; runtime special cases, the authority boundary
> and reachability; test blind spots; state fields and engine debts — plus the
> architect's own checks of the import graph, drift, the recent closures and
> the honesty guards. Every number below is what the code said on
> 2026-09-13 at `5ff287c`. Nothing was implemented.

## 0. The verdict in one paragraph

The engine is architecturally sound and its recent work closed what it
claimed: the roll-modifier gatherer removed the four ad-hoc mode readers, the
spatial pass fixed both geometry findings the boundary experiment reported,
the definitions validator drives all 128 definitions, and the value-level
import graph has **no cycles at all** — the 31-module knot the raw graph
shows is type imports only. What has drifted is the *guarding*: two `CLAUDE.md`
sentences claim sweeps that do not exist, a command spends an economy with no
guard, a settlement path re-rolls saves on a retry, a removed creature can
wedge a fight on a save nobody can roll, and 58 of the 82 executed spells
carry `unmodelled` clauses that no guard reads, so debt can hide as fiction in
the one population the honesty model was built to police. Two structural
findings are new: the **fold reads content** — a replay consults the spell and
equipment catalogues — and the effect union now spells "a condition rider"
three ways, so the next family (IE-001 as briefed) would add a fourth. The
ranked spell map is still right about spells; it is wrong about what comes
first.

## 1. Drift since the second audit

| | at `f2512c7` | now | change |
|---|---|---|---|
| `commands.ts` | 8,632 lines | 10,149 | +17.6%, 13 regions, D12 (spell resolution) alone 2,888 |
| `events.ts` | 3,425 | 4,368 | +27.5% |
| `spell-definitions.ts` | 4,867 | 5,778 | +18.7%, 128 definitions |
| `spells.ts` | 201 | 460 | the ongoing record |
| `GameEvent` union | 87 types | 91 | — |
| engine debts that block action or the turn | — | 8 (`pendingCasting`, `pendingAttack`, `pendingMove`, `pendingDamage`, `pendingTest`, `pendingSaves`, `pendingTurnStart`, `owedAreaEffects`) + `scheduledDamage` | — |
| source / test files | 42 / 75 | 44 / 84 | +5,467 source lines, +9,105 test lines |
| commits | — | 27 | — |
| tests | — | 5,245 passing, ~4 s | — |

**One correction to the record.** The second audit wrote "`commands.ts` is
5,400 lines". At that commit it was 8,632. Measured, not recalled, failed
once; this audit's numbers were taken with `git show <commit>:<path> | wc -l`.

## 2. What recently closed work actually closed

| Batch | Claimed | Verdict | Evidence |
|---|---|---|---|
| Roll modifiers `5b32e0c` | one gatherer, no subsystem rolls its own cancellation | **closed** | `standingSaveModes`, `standingSkillModes`, `standingInitiativeModes`, `attackedWithDisadvantage` survive only in a comment (`roll-modifiers.ts:13`); `rollModesFor` is the gatherer at 7 sites; both attack paths read the defender (`commands.ts:2309`, `:8890`) |
| Spatial `81112d1` | the 45-vs-40 radius and the half-cube axis skew the boundary experiment reported | **closed** | `AreaPoint` with `space` / `intersection`; both ends of a template resolved by one function; `spatial-model.test.ts:644` pins that no SRD definition declares an anchoring |
| Definitions validator `df6de4c` | every definition parses; `checkShape` cannot rot silently | **closed for spells** | the whole catalogue is driven through `parseSpellDefinition` (`spell-schema.test.ts:77`). The same gap is open for **features**: `FeatureDefinition` (`progression.ts:52`) has no validator — see §3.4 |
| Boundary hardening `190fc1e`, capabilities `cac086d` | the parity deadlock; a surface with every exclusion written down | **closed** | `parity.test.ts` asserts every request field's fate; the probe reaches 61 of the 470 public symbols; its own open list (one model one fight, improvised attacks without an attack roll, stat-block actions as names, `creature-added` without a stamp, no causal link) is honest and unchanged |
| The Evoker seam (earlier) | `evoker:evocation-savant` → `grants: { kind: 'spells' }` | **half-closed** | only the `fixed` arm is consumed (`creation.ts:680`); the chosen arm still branches on the literal at `creation.ts:1157` and `:1162` |
| Grease's Prone (named as a fix to make) | `outlivesCasting` | **done** | `spell-definitions.ts:3604`, `:3614` |
| Comparative audit §14E | six changes before the next family | #3, #5, #6 done; #4 deferred with a reason that stands; **#7 untouched** and now measured (§3.2); #14 unchanged | — |

## 3. Findings

Severity is the audit's judgment: **C** correctness, **A** architecture or
authority, **V** validation or conformance, **H** hygiene.

### 3.1 Duplicated and overlapping primitives

- **H — Three spellings of a condition rider, and a fourth on the way.**
  `attack.condition { name, lasts? }`, `save-damage.condition { name, lasts?,
  check? }` and `save { condition, repeats?, lasts?, check?, outlivesCasting? }`
  are three shapes for one sentence, resolved by three near-identical option
  blocks around `applySpellEffect` (`commands.ts:8999`, `:9323`, `:9399`).
  `outlivesCasting` exists only on `save` and `check` is missing from
  `attack`'s, for no SRD reason — no user yet, each time. IE-001 as briefed
  adds `{ kind: 'condition', condition, lasts?, check?, outlivesCasting? }`,
  a fourth. Four users is the evidence the generalisation rule wants: one
  `ConditionRider` type and one option-building helper, with the new kind as
  its fourth consumer. This is **not** the deferred outcome-scoped child
  vocabulary, which stays deferred; it is one shared rider.
- **H — Two identical helpers and one hand-written encoder.** `castingNumber`
  (`commands.ts:4021`) and `castingNumberOf` (`:6576`) are byte-identical;
  `commands.ts:8765` builds `` `${name}#${castingId}` `` by hand where
  `castingSource` is the canonical encoder. `spellOfSource` (`spells.ts:43`),
  the readable decoder, has no caller anywhere.
- **A — Two vocabularies for "which rolls does this touch".** `BonusApplies`
  (`bonuses.ts:54`: `attack | save | ability-check | ac`) and `RollSelector`
  (`roll-modifiers.ts:111`: five families, a relation, an ability, a skill).
  A bonus cannot be narrowed to one ability or aimed against the holder. No
  SRD bonus currently needs that, so this is a watch item, not a task: the
  second user decides it. `ac` is not a roll and stays outside either way.
- **H — The defender's modes are assembled twice.** The eight-line block
  (gatherer plus `sightBetween`) at `commands.ts:2309` and `:8890` is the
  same; two users justify a helper, and the split (§3.2) is the moment.

### 3.2 Coupling

- **A — The value-level import graph is acyclic.** 44 modules, 126 value
  edges, 55 type-only edges, zero value cycles. The layering `CLAUDE.md`
  claims for packages holds inside the engine too. One upward import spoils
  it: `rest.ts:6` imports `identify` from `commands.ts` — the idempotency
  helper belongs below the command layer, in a module of its own.
- **A — The fold reads content.** `events.ts` calls `definitionFor(spellId)`
  at five sites (`:2406`, `:2562`, `:2695`, `:2779`, `:2863`, through
  `areaDefinitionOf`) to learn a casting's `area` and `areaTrigger` when it
  derives who an area caught, and `itemFor` at `:3013` and `:3264` to derive
  worn armour. `OngoingSpell` pins `level`, `numbers`, `origin`, `towards`
  and `anchoring` — but **not the shape, size or trigger clauses**. So a
  replay of last week's log consults this week's catalogue: correct Web's cube
  size, or Insect Plague's clause, and a historical fold raises different
  debts than the live session did. That is the hazard the event-log section
  of `CLAUDE.md` names — "every future rules fix silently rewrote history" —
  arriving through data rather than rules. The fix is the one the pinned
  numbers already use: pin `area` and `areaTrigger` on the record at the cast,
  and the fold never calls `definitionFor`. The armour case is the same shape
  through the equipment catalogue and is lower risk (SRD tables change
  rarely); named, not scheduled.
- **A — `commands.ts`, measured.** 76 exports, 71 private helpers, 13 regions
  by the file's own banners; 15 helpers are called from more than one region
  and 56 from one; `creatureOf` and `unknownCreature` are called from all 13
  (110 sites); four helpers are filed in a region other than the one that
  calls them (`landDamage`, `sweptRoute`, `apartFromSource`, the trigger block
  at `:740–904`); D12 is 28% of the file and D12+D7+D11+D10 is 58%. Every
  command folds its own batch through `applyEvent`. The comparative audit's #7
  is affirmed with a concrete seam table (the measurement sweep's proposal:
  identity, creatures, conditions, facts, actions, movement, attacks,
  reactions, ongoing, features, casting, turns, spells split into targeting
  and resolution, inventory; and eleven helpers that belong in existing
  modules — `reachOf`, `rawDamageTotal` → `attack.ts`; `apartFrom*` →
  `positioning.ts`; `castingNumber*` → `spells.ts`; `onCaster`, `persists`,
  `ranged`, `needsCasterSheet`, `statedDamageType`, `riderDuration(s)` →
  `spell-definitions.ts`; `mayAttempt` → `duration.ts`). The workflow reason
  is as strong as the code reason: the one-owner-per-primitive rule
  serialises **every** mechanism task behind this one file today.

### 3.3 Authority boundaries and guards

- **A — The inviolable rule holds.** Only `rolls.ts:81` and `:94` stamp
  `engine`; `checkExternalSource` refuses it from the external pair; no other
  file constructs a `RollSource`. Every caller-supplied number sits on a
  documented low-level or DM path; no exported function takes a save outcome
  or a hit. The probe surface calls `resolveSpell`, never `resolveCast` or
  `castSpell` directly. `forged_provenance`, the guard that makes the rule a
  rule, is asserted by **no test** (§3.5).
- **C — `extendFeature` spends a Bonus Action and a pool use with no
  `mayAct`** (`commands.ts:5236`). Its four sibling feature commands guard.
  `resolveCast` and `castSpell` are unguarded on direct entry, which is the
  documented low-level half — but both are re-exported by `index.ts`'s
  `export *`, so only policy keeps them off a surface.
- **V — The `mayAct` sweep `CLAUDE.md` describes does not exist.** Line 2249:
  "A sweep holds the list, so a command added without the guard fails there."
  The only test exercising several commands is a hand-written `it` list
  (`area-triggers.test.ts:1490–1553`) covering nine of sixteen spenders and
  not `useHealingTouch`, `useSelfHeal`, `useRecovery`, `resolveEffectCheck`,
  `activateSpell`, `extendFeature` or `resolveCast`. `extendFeature` is what
  a real sweep would have caught.
- **V — `GUARDED` is hand-maintained and silent in both directions.**
  `CLAUDE.md:3766` calls it "the authoritative list of which engine commands
  honour" an id. Five commands call `identify` and are absent
  (`resolveAttackDamage`, `activateFeature`, `castSpell`, `resolveDamage`,
  `beginRest` — three of them top-level entry points with a live guard nothing
  exercises); seven event-returning exports take no id at all, and two of
  those are not among the four `CLAUDE.md` names as deliberate:
  **`resolvePendingSaves`** (`:6776`), which rolls the turn's owed saves and
  re-rolls them on a retry, and **`removeCreatureEverywhere`** (`:491`).
  `rollInitiativeFor` advances the generator with no id.
- **C — The duplicate check comes first in all 41 functions, and not in the
  wrapper.** `resolveSpell` → `castOrRelease` refuses `unknown_creature`,
  `no_definition`, `cast_on_a_hit`, `needs_context` and `no_free_casting`
  before `castSpell`'s `identify` is reached (`commands.ts:7740–7891`,
  `:8614`); the two guards that read mutable pending state are correctly
  replay-exempt. A retry sent after the caster was removed gets a refusal
  where it should get an empty batch. The eighth instance of the trap, and
  the first in a wrapper — which is the argument for making the ordering
  structural (§3.9).
- **C — A removed creature can wedge a fight on a save nobody can roll.**
  `creature-removed` (`events.ts:3310`) does not purge condition timers
  targeting the departed creature; `dropOrphanedSaves` (`:2956`) drops a
  pending save only when its *timer* is gone; `resolvePendingSaves` then
  refuses `unknown_creature` (`commands.ts:6789`) and `resolveTurn` refuses
  `saves_pending`. Inferred from the code paths, not executed: the first
  test is the reproduction. `pendingSaves` is the one debt of nine with no
  leaving-creature handling (`settleHoldsInvolving` covers the other holds;
  `dropOrphanedAreaEffects` and `dropStrandedDamage` cover theirs).
- **A — Counterspell on Counterspell is refused by a throw, not a value.**
  The `casting_pending` guard at `commands.ts:7780` exempts
  `trigger === 'casting-a-spell'`, so a held Counterspell cast into an open
  window produces a `spell-declared` the reducer rejects as a corrupt log
  (`events.ts:3531`). The restriction is deliberate and documented; its
  *shape* contradicts "rules-legal refusals are values, not exceptions".
- **H — `free-interaction-used` is an event no command emits**, so
  `TurnBudget.freeInteraction` is reachable only from a hand-built log.

### 3.4 Validation that is missing

- **V — Feature definitions have no validator.** 230 features, 88 claiming
  `engine`. Ten of those carry none of `grants`, `grantsSubclass`,
  `grantsFeat` or `choice` — eight class spellcasting features whose
  execution lives on the class, and two "Improved X" steps applied through
  the base feature's table — all explainable by convention, none checked.
  Three `manual` features carry a grant (`berserker:mindless-rage`,
  `draconic-sorcery:draconic-resilience`, `draconic-sorcery:elemental-affinity`).
  The compiler, the relationship tests and the pool-note guard are the only
  guards, which is where the spell definitions were before `df6de4c`. A
  `checkFeatureDefinition` that encodes the conventions (engine ⇒ a hook, or
  class spellcasting, or a named improved-step; manual with a grant ⇒ the note
  says which half) is the same move, smaller.
- **V — The special-case guard is narrower than the claim it protects.**
  `spell-schema.test.ts:554` scans five files for spell ids only. The claim
  holds for spells everywhere. For features and classes it does not:
  `creation.ts` branches on `evoker:evocation-savant` (`:1157`), `'wizard'`
  (`:1162`, `:1464`), `'magic-initiate'` (`:1247`, `:1274`, `:2100`),
  `'alert'` (`:2175`), `'warlock'` (`:1427`) and `'pact-magic'` (`:1454`);
  `multiclass.ts:67–74` holds the caster sets as a table a branch consults.
  Each is a half-finished generalisation — `grants.kind === 'spells'` has no
  chosen arm, and nothing grants an Initiative bonus — and the guard should
  name them as the allowlist so the next one fails loudly.
- **V — The reducer accepts a `spell-ongoing` for a casting that has already
  ended** (`events.ts:3553` checks only "already running" and "id ≤
  `castingsBegun`"). A hand-built log can resurrect a dispelled spell.

### 3.5 Conformance that is missing

- **V — Executed spells' `unmodelled` clauses are read by no guard.** The
  tracking guard (`spell-tracking.test.ts:79–83`) scans only the 46 tracked
  spells for the thirteen mechanical markers. **58 of the 82 executed spells
  carry `unmodelled` clauses**, and they are a mixture: a frozen statue and
  dust are fiction; "the target can't regain Hit Points until the end of your
  next turn" (Chill Touch), "the save has Advantage if you or your allies are
  fighting the target" (Charm Person and the four Dominates), a Hit Point
  maximum reduction (Harm), "the next attack roll against the target has
  Advantage" (Guiding Bolt) and three Difficult Terrain areas are rules the
  engine owns or has named as missing shapes. Nothing demands an
  adjudication, and `PARTIAL_SPELLS` (one entry: Spirit Guardians) is a hand
  list rather than a consequence. Extending the marker scan to executed
  spells, with the adjudication map demanding `table` or a named shape per
  clause, and deriving "partial" from "carries a debt adjudication", makes
  the honesty model cover the population it was built for. It also makes
  IE-001's Invisibility claim checkable.
- **V — The frozen log protects 35 of 91 event types.** `golden-log.json`:
  93 events, 35 types. Absent: `spell-ongoing`, `spell-declared`,
  `spell-interrupted`, `damage-rolled`, `damage-settled`, `test-rolled`,
  `test-settled`, `spell-origin-moved`, `roll-modifier-granted`,
  `armor-class-granted`, every rest, pool, death-save and equipment-removal
  event — everything since the reaction windows. The rule "never regenerate"
  is right and stays; the fix is a **second** frozen fixture, made from a
  scripted scenario that exercises the newer subsystems and frozen under the
  same fold-equality test, append-only for ever.
- **V — 46 of 162 refusal codes are asserted by no test** (28%), among them
  `forged_provenance`, `cantrip_takes_no_slot`, `conflicting_slot`, seven of
  `combat.ts`'s sixteen, and the whole mount family. The `scene`
  needs-context kind is never asserted; 23 event payloads are never asserted
  by name. A guard nobody has watched fail is a guard whose message nobody
  has read.
- **H — Stale notes.** Arcane Lock and Continual Flame still say Dispel Magic
  is not executable (`spell-definitions.ts:4176`, `:4200`).

### 3.6 State: stored, derived, dead

- **Two sources of truth**, beyond the two `CLAUDE.md` already documents
  as views (worn armour; the distinct-conditions list): a live casting's
  spell and level live on `CreatureState.concentration` *and* on
  `OngoingSpell`; `OngoingSpell.concentration` is derivable from whoever
  holds the casting and has **zero readers** anywhere, tests included.
- **Dead fields**: `OngoingSpell.route`, `PendingMove.feet` (Speed is spent
  at declaration and never re-read), `OwedAreaEffect.turn` (settlement sorts
  on moment, casting and target), `GameState.seed` (no reader; `rng` is what
  resumes a session), and `rollsIssued` and `eventCount` with test readers
  only.
- **`CombatState.round` is genuinely stored**: `floor(turnsTaken / order.length) + 1`
  is false once a combatant is removed mid-round.
- **The `#` string is the only link** between an effect and its casting, for
  conditions, bonuses, armour-class grants, roll modifiers, scheduled damage
  and condition-instance timers; `castingIdOf` is the only parser, and
  timers parse a condition instance id whose tail is itself a casting source
  (double encoding, safe only because `lastIndexOf` is used). Feature links
  are structured. Named so the `cause` recommendation (#14) has its evidence.

### 3.7 Runtime special cases

None keyed on a spell, a creature, an item or a condition source. Six keyed
on a feature or class in `creation.ts` and two caster sets in
`multiclass.ts` (§3.4). The reporting script's `PARTIAL_SPELLS` and
`VERIFIED_SPELLS`, and the oracle's one exemption (Guiding Bolt), are
reviewed lists, not runtime.

### 3.8 Test blind spots

All ten derived passes in the fold are reached by a named test;
`dropOrphanedSaves` by one, on one branch. Fifteen source files have no
colocated test, and two of them matter — `spell-definitions.ts` and
`standing.ts`, 6,796 lines covered only by cross-cutting suites — but the
suite is feature-scoped by design and the cross-cutting suites are the ones
that discriminate. The blind spots that matter are the ones above: the
refusal codes, the missing fixtures, the executed spells' clauses, and the
sweeps that are lists.

### 3.9 Repeated patterns, and which now justify an abstraction

| Pattern | Instances | Now |
|---|---|---|
| a condition rider | 3, and IE-001 the 4th | **one `ConditionRider`** (§3.1) |
| the defender's modes assembled | 2 | a helper, during the split |
| "the duplicate check comes first", sprung | 8 | **structural**: a command wrapper that runs `identify` before any validation, introduced when `commands.ts` is split, so ordering stops being discipline |
| a stamp must ride on an always-emitted event; a union member accepts an undeclared property | 3 + 2 | a per-event field schema, extending the name-only vocabulary contract — evidence exists, scheduled after the fixtures |
| a pure function nothing calls | 3 with no caller at all (`pendingDamageOf`, `pendingTestOf`, the `recordD20Test` export); the whole rest subsystem test-only | pre-M2: the tool surface is the consumer; `index.ts` re-exports 28 modules whole, and tiering that surface is an M2 decision |

### 3.10 Documented open debts, re-verified

| Debt | Verdict |
|---|---|
| `OngoingSpell.concentration` has no reader | confirmed — zero, tests included |
| `on` does not shrink when an independently timed condition expires | confirmed (`expireEffects` never calls `withoutTarget`) |
| "until dispelled" spells leave no ongoing record | confirmed (`persists()` needs a duration; Arcane Lock and Continual Flame carry none) |
| a hand-built `spell-ongoing` for an ended casting is accepted | confirmed |
| Grease's Prone linked to the casting | **refuted — fixed** |
| `placeArea`'s `no_scene` is unreachable | confirmed |
| Counterspell nesting refused | confirmed, by a throw (§3.3) |
| reactor eligibility scans every creature in the game | confirmed (`reactions.ts:429`, `:481`) |
| the boundary batch's five open items | unchanged, honest |

## 4. Is the ranked queue still right, and were IE-001 and IE-002 premature?

The ranked spell map (`PROGRESS.md`, "Where this leaves the ranked map") is
still correct about *spells*: nothing measured here moves a shape's count or
order. It is not the whole queue any more. The audit adds a class of work the
map does not rank — engine integrity — and some of it must precede the next
family:

- **IE-001 was premature as briefed**, on three counts. It would add the
  fourth spelling of a rider instead of consolidating the three (§3.1); its
  Invisibility claim relies on `PARTIAL_SPELLS` and `unmodelled` being
  honest, which nothing checks for executed spells (§3.5); and it lands in
  D12 of a file whose split is now measured and due (§3.2). Re-brief it after
  the honesty guard and the split: one `ConditionRider`, the `condition` kind
  as its fourth consumer.
- **IE-002 remains a correct content task and a wrong first partner.** The
  honesty guard changes what a new executed definition must satisfy; pouring
  twelve definitions before it lands is rework. It follows the guard.
- **What comes first is correctness**: the guard holes, the retry that
  re-rolls saves, the wedge, the throw (§3.3), and the sweeps that would have
  caught them. Then the structural change every later mechanism task lands
  in. Then the family.

## 5. Proposed tasks, in order

| Task | Lane | Parallel-safe | What it closes |
|---|---|---|---|
| **IE-003** Close the guard holes; make the guard sweeps mechanical | mechanism (correctness) | CONDITIONAL — beside conformance and content only | §3.3 all; `identify` to its own module (§3.2); the two duplicate helpers (§3.1); the two `CLAUDE.md` claims |
| **IE-004** The honesty guard for executed spells | conformance | YES beside IE-003 | §3.5 first item; the stale notes |
| **IE-005** Split `commands.ts` by domain, behaviour-preserving | mechanism (structure) | NO beside any mechanism task; YES beside conformance and content | §3.2 third item; the command wrapper (§3.9); the mode helper |
| **IE-006** A second frozen event-log fixture | conformance | YES | §3.5 second item |
| **IE-002** Pour twelve spells into the shapes that already execute | content | CONDITIONAL, after IE-004 | the cheapest coverage |
| **IE-001** A condition applied with no saving throw — re-briefed | mechanism | CONDITIONAL, after IE-005 | the family, with one `ConditionRider` |
| **IE-007** The ongoing record: pin the area, drop the dead fields, close the four debts | mechanism | NO beside IE-001 (both in D12 / `spells.ts`) | §3.2 second item; §3.6; §3.10 first four |
| later | conformance | YES | refusal-code coverage sweep; feature-definition validator; the special-case guard's allowlist; per-event field schemas |

Batches: **1** = IE-003 + IE-004 (two builders). **2** = IE-005 alone in the
mechanism lane, beside IE-006 and IE-002. **3** = IE-001 then IE-007, beside
the later conformance items. The whole-engine counter restarts at this
audit's commit.

## 6. What this audit deliberately does not recommend

- **Not the outcome-scoped child vocabulary.** The decision to wait for the
  next two families' evidence stands; consolidating one rider is not it.
- **Not tiering `index.ts`.** The public surface exporting the low-level
  halves is a policy question for the M2 tool surface, which is the first
  real consumer; the probe already demonstrates the discipline.
- **Not the `cause` link on events (#14).** Its evidence is now written down
  (§3.6); its user — narration — is M2.
- **Not multiple scenes, summons, long casting times.** Nothing measured here
  changes their standing in `PROGRESS.md`.
- **Not regenerating `golden-log.json`.** A second fixture, never a new
  first one.

## Measurement notes

- Read counts are grep-level and inflated for generic field names; every
  zero-reader claim was re-checked repo-wide including tests.
- The `pendingSaves` wedge and the `castOrRelease` ordering were traced by
  reading, not executed; each proposed task begins with the reproduction.
- The commands-file domain map uses the file's own banner comments; a helper
  called from inside another helper is attributed to the region the call sits
  in.
- Caller graphs are textual word-boundary matches, spot-checked against
  `grep -rn`; an aliased re-export would read as unreached.
- Four Opus sweeps cost about 860K subagent tokens; the architect's own
  checks were greps, two small scripts and reading.
