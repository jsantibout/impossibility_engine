# Whole-engine audit, the fourth: measured after three tranches

> Fourth code audit against the doctrine, after `588d7a0`. Measured on `main`
> at `e2080da`, 2026-09-13, by the architect's own greps, three small scripts
> and reading; the foreman's measurements were used as entry points and
> re-derived where a judgment turned on them. Nothing was implemented.

> **Filed by the foreman, verbatim.** `qb-architect` has no Write tool and
> writes nothing to the tree; the charter says the judgment is Fable's and the
> recording is the foreman's. Everything below is Fable's, unedited.

## 0. The verdict in one paragraph

The engine is structurally sounder than at the third audit, and the three
tranches closed what they claimed: the command layer is twenty-one modules
whose **value-level import graph is a DAG** (61 value edges, zero cycles,
verified module by module), `once` has made the duplicate check structural
(`identify` has **no caller outside `once`** anywhere in `commands/` or
`rest.ts`), both frozen fixtures together cover **all 91 event types**, the
guard sweeps are derived, and the fold reads the catalogue only through one
named upcaster for records that predate the field. What has drifted is
**counting and filing**. The repository now carries three rankings of the same
missing shapes — `PROGRESS.md`'s map, the leverage audit, and the honesty
guard's adjudications — and they disagree by up to four times on one family
(17 vs 4 vs 2 for a granted Resistance). Re-derived against the SRD text and
the code, **two of the leverage audit's four remaining candidates do not
survive as briefed**: the C2 "selector for the save a casting forces" makes
zero consumers whole, and C1's nine consumers are three. Roughly one
adjudication in ten in the honesty map is filed to the wrong shape, and the
errors cluster on exactly the three shape ids the rankings were built from.
Two wrong numbers are shipped and reachable (multiclass Hit Dice; the `on`
list of a Range: Self area spell), and the recurring "pure function nothing
calls" finding has its largest instance yet: the whole scene-setup family —
eight event types — has no command, so nothing above the engine can start an
encounter.

## 1. Drift since the third audit

| | at `5ff287c` | now | note |
|---|---|---|---|
| command layer | `commands.ts`, 10,149 lines, 13 regions | 21 modules, 10,551 lines, plus a 159-line enumerating barrel | largest: `spell-resolution.ts` 1,709; `casting.ts` 1,223; `targeting.ts` 993 |
| largest single function | D12 region 2,888 lines | `resolveEffects`, **914 lines** (`commands/spell-resolution.ts:745`) | the D12 finding relocated, not resolved |
| `events.ts` | 4,368 | 4,570 | |
| `spell-definitions.ts` | 5,778, 128 definitions, data only | 6,217, 132 definitions, **plus eight helpers** (`:1129–1265`, `:6204–6216`) | IE-005's reviewer named the drift in "was never code" |
| `GameState` fields | 22 | 23 (`castingsEnded`) | |
| event types | 91 | 91 | |
| emitted by no command | not measured | **17** (IE-009, reproduced) | |
| frozen-fixture coverage | 35 of 91 types | **91 of 91** (93 + 551 events) | verified by script |
| engine `src` `.ts` files | 128 | 154 | |
| tests | 5,245 | 5,578 | |
| commits | 27 | 39 | |

`rolls.ts` was not touched in the period (0 commits); `'engine'` is still
stamped only at `rolls.ts:81` and `:94`, and no other non-test file
constructs it. The inviolable rule holds unchanged.

## 2. What recently closed work actually closed

| Task | Claimed | Verdict | Evidence |
|---|---|---|---|
| IE-003 guard holes, derived sweeps | duplicate check structural; `mayAct` and `GUARDED` sweeps derived | **closed** | `once` at `idempotency.ts:130` runs `identify` before `run`; 47 `once(` sites across every command module and `rest.ts`; zero direct `identify(` callers |
| IE-004 honesty guard | executed spells' clauses adjudicated; partial derived | **closed as a guard; the map it produced is ~10% mis-filed** — §3.2 | 88 adjudications, 27 shapes, `spell-honesty.test.ts:139–765` |
| IE-005 split | DAG, enumerated barrel, nothing filed unreached | **closed** | value edges verified; every module export is either barrel-published or called by a sibling. Two costs: `resolveEffects` is still one 914-line function, and the special-case sweep's `RUNTIME` list (`spell-schema.test.ts:651–659`) reads `commands/`, `events.ts`, `spells.ts`, `spellcasting.ts`, `standing.ts` and **not** the six files IE-005 moved helpers into |
| IE-006 second fixture | every event type frozen | **closed** | script: 91 declared, 0 missing |
| IE-002 pour spells | twelve spells | **two**, and the honest finding that the kinds are drained | the leverage audit's premise |
| IE-008 pools at advancement | one derivation for creation and advancement | **closed**; `hitDicePools` (`multiclass.ts:142`) still called by nothing and `poolsFor` (`creation.ts:2439`) still declares one Hit Die pool from the starting class — **a wrong number, shipped** | confirmed |
| IE-001 `ConditionRider` | one rider, four consumers | **closed** | `held.add` at `spell-resolution.ts:965`, `:1294`, `:1405`, `:1432`; `check` and `outlivesCasting` reachable on `attack`/`save-damage` riders with no user (reviewer's finding a) |
| IE-009 tranche-2 findings | seventeen unemitted events derived | **closed as a record** | the scene family is §3.7's largest item |
| IE-007 ongoing record | fold independent of the catalogue; dead fields dropped; four debts closed | **closed for the fold**; two duplications remain and both were the builder's own findings — §3.6 | `ongoing-compatibility.ts:59` is the only catalogue read on the fold path; `commands/turns.ts:488` still reads `definitionFor` for the trigger; `spell-resolution.ts:1631` discards `held` for a Range: Self casting |

## 3. Findings

Severity as before: **C** correctness, **A** architecture or authority,
**V** validation or conformance, **H** hygiene.

### 3.1 Speculative or unused members (owner's question 1)

Measured by counting each optional field and union member of the definition
format in the catalogue (`spell-definitions.ts:1269–`) and its readers in
non-test source.

- **V — Three members of the definition format have zero catalogue users**,
  not one: `roll-mode.save` (reader at `spell-resolution.ts:1091`),
  `SpellCheck.dc` ("a printed DC — Maze's DC 20"; Maze is undefined; reader in
  the check path), and `'end-casting'` as a `save.repeats.onSuccess` value (0
  in the catalogue; readers in the reducer). Each was written for a spell that
  is blocked on something else, which is the shape the roll-modifier section of
  `CLAUDE.md` refuses for "D20 Tests". `definition.anchoring` is also
  zero-user, but by a pinned decision (`spatial-model.test.ts:644`) — that is
  what an exemption looks like.
- **V — The validator cannot see "zero users", and that is the structural
  gap.** `checkSpellDefinition` checks coherence of one definition; nothing
  asserts that every member of the closed unions and every optional field is
  written by at least one definition or carries an exemption. The honesty guard
  already does exactly this for `MISSING_SHAPES` ("no shape sits unclaimed",
  `spell-honesty.test.ts:909`). The same sweep over the format is one test.
- **H — Single-user transcriptions are documented as such and are not this
  finding**: `optional`, `movesArea`, `designatesUnaffected`,
  `damageTypeStated`, `mustBeUnarmored`, `durationUntil`, `shieldAllowed`,
  `plusAbility`, `flatPerSlotLevelAbove` (one user each). I checked the two
  per-slot scaling fields specifically because an unread scaling field is the
  Finger-of-Death class of bug: both are read (`spell-definitions.ts:6210`,
  `:6216`) and False Life's upcast is driven (`spell-buffs.test.ts:303–304`).
- **H — Engine-side dead state is unchanged from the third audit**:
  `GameState.seed` (0 readers), `eventCount` and `rollsIssued` (test readers
  only), `pendingDamageOf` and `pendingTestOf` (published by the barrel, called
  by nothing, tests included), `spellOfSource` (no caller), `hitDicePools`.

### 3.2 The adjudication map, re-read (owner's question 2)

All 88 executed-bucket entries and the 14 tracked-bucket entries were read
against the SRD prose. **The fiction-versus-debt line is right in every entry
I checked**; the errors are in *which* shape a debt is filed to, and they
cluster on three shape ids:

| Shape id | Entries | What is wrong |
|---|---|---|
| `outcome-scoped-child-effects` | 5 | Disintegrate — outcome of the spell's own damage, not a rider (already in LATER). Hypnotic Pattern's "Speed 0" — bundles a Speed primitive with the rider. Acid Arrow — a *miss branch on the host's damage* (`onMiss`), not a child. Phantasmal Killer and Sunburst — right. After the rider decision the id itself names a design that was rejected; it should become `outcome-riders`, with Disintegrate and Acid Arrow re-filed |
| `a-mode-on-the-save-a-spell-forces` | 6 | Shatter's "A Construct has Disadvantage" is `an-outcome-that-varies-by-creature-type` — the note admits the type is the blocker. The five Charm/Dominate notes say "both facts are held" and **one is not**: "if you or your allies are fighting it" (`spells.md:942`) is a table judgement, not a derivation from `side` and `combat`. The shape's description misstates its own blocker, which is why C2 was mis-ranked (§4) |
| `a-repeat-save-beyond-the-turn-hook` | 8 | By its own description this is four mechanisms — a save on the clock (Befuddlement), a three-count tally (Contagion), damage on a failure (Phantasmal Killer, Weird), a save raised by damage or movement (Dominate ×3, Compulsion). A bundle id with consumer counts of 1–3 each, not a shape with eight |

Plus one bundled note (Fear: a compelled Dash *and* a sight-conditioned save
under one id). **Ten of 102 adjudications are mis-filed or bundled**; the
27-shape vocabulary has three bundle ids. `PARTIAL_SPELLS` is unaffected — a
spell is partial under either filing — but every count derived *per shape*
from this map is off by the bundle, which is the finding behind §4.

The tracked bucket keeps two shape ids of its own (`jumping`,
`teleportation`) plus the shared `speed-and-movement-modes`; two lists by
deliberate design, and the docstring at `spell-honesty.test.ts:130–137` says
why.

### 3.3 A casting-owned grant with no lifetime (owner's question 3)

Confirmed none today; the foreman's drive stands. The guard belongs in
`spell-schema.ts` beside its two siblings of exactly the same shape: `check`
demands a lifetime at `:619`, and `activation_without_duration` at `:697`. One
rule, one code (`grant_without_lifetime`): a definition with none of
`durationSeconds`, `durationUntil`, `untilDispelled`, `concentration` may not
carry `buff`, `roll-mode`, `armor-class`, or a condition rider lacking both
`lasts` and `outlivesCasting`. While there: **the validator checks no
`SpellCheck` field at all** (IE-001's reviewer finding e, confirmed — no
`check.ability`/`skill`/`dc` rule exists), so a check naming a skill of the
wrong ability compiles and validates.

### 3.4 `EffectTarget` (owner's question 4)

- **A — A fourth member is right, and it is one member, not four.**
  `{ kind: 'grants'; on: CharacterId; source: string }` — every grant that
  source made on that creature. The operation already exists:
  `releaseOnTarget` drops bonuses, roll modifiers and armour-class grants by
  casting on one creature; the timer member is that operation on a deadline,
  with `source` rather than `castingId` so a feature (Superior Hunter's
  Defense, `classes.md:6838`, "until the end of the current turn") and a
  casting use one member. A per-grant-kind member would need a per-kind
  identity (`rollModifierKey` vs `source`) on the timer and would be four ways
  to write one sentence.
- It is the **only** incompleteness of that type. Scheduled damage carries its
  own `at`; owed area effects are not timed; a condition with an elapsed
  `lasts` (Sunburst) is a `Deadline` question, not a target one. Its user count
  today is one (Superior Hunter's Defense); a modifier rider with `lasts` would
  be the second. Build it with C1 if C1 takes the feature; otherwise name it.

### 3.5 Validation and conformance still missing

- **V — Feature definitions still have no validator** (third audit §3.4;
  unchanged).
- **V — The special-case sweep reads the wrong file list**
  (`spell-schema.test.ts:651`): it does not read `spell-definitions.ts`'s
  helper region, `spell-schema.ts`, `duration.ts`, `attack.ts`,
  `positioning.ts`, `checks.ts`. Verified no special case is there today. Scan
  every non-test source file and allow only the `id:` property lines of the
  definitions region. The six feature-id literals in `creation.ts` (`:1157`,
  `:1162`, `:1247`, `:1274`, `:1454`, `:2100`, `:2175`) and `multiclass.ts:125`
  are unchanged since the third audit and still un-allowlisted.
- **V — Refusal codes: 41 of 112 `err(`/`needsContext(` literals are asserted
  by no test** (37%; the third audit's 46 of 162 used a wider net — the
  proportion is unchanged). Among them still `cantrip_takes_no_slot`,
  `conflicting_slot`, `no_scene`, and the mount family.
- **V — `spell-catalogue.test.ts:127–132` hand-enumerates which kinds carry a
  turn-anchored rider** where `riderDurations` is the derivation (IE-001's
  reviewer, finding b).
- **H — Prose counts are stale inside one tranche**, as the foreman said:
  `CLAUDE.md` "Forty-four spells have a definition with `effects: []`" (50),
  "fifty-three" partial (`COVERAGE.md:31` says 54); `PROGRESS.md` "Where the
  numbers stand" prints 82 / 57 / 46 / 5,245 against 86 / 62 / 46 / 5,578. The
  cure is not a sweep of digits but fewer digits: a sentence in `CLAUDE.md`
  should carry a *relationship* ("partial is derived from the adjudication
  map") and point at `COVERAGE.md` for the number.

### 3.6 Duplicated sources of truth and two wrong numbers

- **C — `on` has two rules.** At the cast, `spell-resolution.ts:1631` writes
  `on: [casterId]` for a Range: Self casting and discards `held`; later growth
  goes through `alsoOn` (`events.ts:2475`), which adds anyone the casting owns
  an effect on. So Sunbeam (Range: Self, Line,
  `condition: { name: 'blinded', lasts: … }`) blinds a creature and is on the
  cleric only; a Dispel Magic aimed at the blinded creature finds nothing; the
  same rider landed by an area *trigger* a round later would be found. IE-007's
  builder was right, and `CLAUDE.md`'s "now applied at the cast as well" is
  true only of `landedOn`'s branch. Fix: the caster branch unions `held`. Three
  lines, in the file the rider task owns.
- **C — Multiclass Hit Dice.** `poolsFor` (`creation.ts:2439`) declares one Hit
  Die pool from the starting class; `hitDicePools` (`multiclass.ts:142`) is
  correct, tested against both SRD worked examples, and unreached. A Paladin 4
  / Fighter 1 has four d10 and no d8. Wrong number, shipped, in LATER; the
  foreman's own IE-008 rule — a silently wrong number outranks a capability —
  puts it in tranche 4.
- **A — Settlement reads the book while the record pins the trigger.**
  `commands/turns.ts:488` calls `definitionFor(record.spellId)` for
  `areaTrigger`, so the pinned `areaTrigger.effects` and `.label` have no
  reader. The compatibility worry recorded on the task ("a pre-versioned record
  has no effects to restore") is already answered: `upgradeOngoing` fills
  `areaTrigger` from the catalogue when the record enters the fold
  (`ongoing-compatibility.ts:73`), so **no record in `state.ongoing` ever lacks
  it**. Read the record; the change is local to `turns.ts`.
- **A — Three rankings of one family.** `PROGRESS.md:1989` ranks "Resistance or
  Immunity a spell grants" at **17** open spells; the leverage audit says **4**
  (one of which, Absorb Elements, is not in SRD 5.2.1 — `spells.md` has no such
  heading); the SRD text supports **2 whole, 1 partial** (§4). Three documents,
  three numbers, none derived. `PARTIAL_SPELLS` stopped being a hand list when
  it became a consequence of the adjudication map; the *undefined* population's
  blockers — which IE-002 wrote out spell by spell in prose — are the missing
  half of that derivation. A `BLOCKED_ON: spellId → ShapeId[]` map, asserted
  complete over the 207 undefined spells and drawing on the same
  `MISSING_SHAPES`, makes every leverage count a query. Then a shape's consumer
  count cannot be wrong in three places.
- **H — Two unbounded indexes in state.** `castingsEnded` (`events.ts:1979`,
  sorted insertion per ending) joins `appliedCommands`. Neither is a
  correctness leak — both are log indexes the fold needs to refuse a corrupt
  event — and the tombstone is the right instrument: the alternative invariant
  ("the id is the latest allocated, the pending casting's, or a readied
  casting's" — `actions.ts:312` allocates at Ready) is three-way and buys
  nothing. What they share is that a snapshot's size grows with campaign
  length, which is M3's to decide once for both; name them together there.
- **A — `upgradeOngoing` is the right shape today and is the first of its
  kind.** A record-versioned upcaster, applied once at fold entry,
  identity-preserving on the current path (`ongoing-compatibility.ts:60`), and
  reaching the catalogue only for records that predate the field — and the only
  such records that will ever exist are the two fixtures, because nothing
  persists before M3. When a second event needs one, it wants a per-event-type
  upcast table in one module rather than a second module named for a record.

### 3.7 Runtime special cases and the reachable-from-nothing family

- None keyed on a spell, creature, item or condition source (the sweep's
  population); the feature and class literals in `creation.ts`/`multiclass.ts`
  are the same six as before, still outside the guard.
- **A — The scene family has no command.** `placeCreature`
  (`positioning.ts:479`), `addLandmark` (`:98`), `declareCover` (`:908`),
  `declareSight` (`:1303`) and `startCombat` (`combat.ts:220`) return
  `Result<State>` and are called only by the reducer; `scene-set`,
  `time-advanced` and `spellcasting-declared` have no producer at all outside
  tests. Eight of the seventeen unemitted types. The foreman deferred this as
  "M2's tool-surface work and wants that surface's shape first"; I disagree on
  the boundary: **a tool surface calls commands and never folds events
  itself**, so these are engine commands whatever M2 looks like, they go
  through `once` like every other, and the anti-cheat parity test needs them to
  exist before it can assert anything about starting a fight. The shape is
  entirely settled — validate, emit, fold through the existing pure function —
  which is what makes it GREEN.

### 3.8 Complexity recent work introduced

- `resolveEffects` at 914 lines is the largest function in the engine, and the
  three host branches the rider task rewrites are inside it. `applyRiders` is
  the first real reduction; the per-kind branches want to become per-kind
  functions as a *consequence* of that task, not a task of their own.
- Fourteen names were added to the public surface by the barrel; `index.ts:34`
  still `export *`s it. The tiering decision stays M2's (third audit §6), and
  the barrel is now the right place to make it.

### 3.9 Documented open debts, re-verified

| Debt | Verdict |
|---|---|
| `resolveCast` unguarded by `mayAct` | **closed** (IE-007) |
| `on` does not shrink when an independently timed condition expires | **closed** (IE-007's shrink; mutation-tested) |
| "until dispelled" leaves no record | **closed** (`untilDispelled`) |
| a hand-built `spell-ongoing` for an ended casting is accepted | **closed** (`castingsEnded`) |
| Counterspell nesting refused by a throw | **closed** (`castOrRelease` returns it; `spell-resolution.ts:318`) |
| `hitDicePools` uncalled | confirmed |
| `endRest` takes no id | confirmed, stated |
| `check`/`outlivesCasting` on `attack`/`save-damage` riders have no user | confirmed |

## 4. Is the ranked queue still right?

The corrected C4 was the symptom. The same bundling produced the other four,
and this is what each looks like re-derived from `spells.md`, `classes.md` and
the code:

| | Leverage audit | Re-derived | Survives? |
|---|---|---|---|
| **C1** granted Resistance | 4 spells + 5 features, "fourth instance of a three-user storage pattern" | **Spells: Stoneskin whole; Protection from Energy whole by reusing `damageTypeStated` (a type stated at the cast already exists); Protection from Poison partial. Absorb Elements is not SRD.** Features: Rage's resistance is **already executed** (`barbarian.ts:98`, `standing.ts:710`); Elemental Affinity's is applied per its own note; Fiendish Resilience is "re-chosen on a rest"; Monk's Superior Defense is Rage's shape with twelve types and a minute — a content task with no engine change to check; only Superior Hunter's Defense genuinely needs the grant, plus the §3.4 timer. **2 + 1 whole, 1 + 0 partial.** The gatherer already exists: `defensesOf` (`standing.ts:731`) merges the stat block's defences with feature grants; a casting's grant is its third input, not a second merge | **KEEP, re-scoped**: still GREEN and still the cheapest new grant kind, on honest numbers |
| **C2** first half, a selector for the forced save | 6 spells + 1 feature | **Zero consumers made whole by a selector.** The five Charm/Dominate saves need a *declared* fact ("you or your allies are fighting it") applied as a mode inside the save the resolution itself rolls — no grant, no `RollSelector` axis; the same discipline as declared cover. Shatter needs the target's creature type. Countercharm needs a spell's saves suspended per target. Three different blockers under one id | **DROP as briefed.** Replace with two smaller GREEN items: (a) *an outcome that varies by creature type* — Blight's auto-fail, Shatter's Disadvantage, Divine Smite's +1d8, Banishment's no-return: four executed-partial consumers reading a fact the engine holds authoritatively; (b) *a declared "being fought" fact on the casting* for the five Charms — Maestro declares, the engine applies |
| **C3** Speed and movement modes | 9 + 9, "modes are new vocabulary" | **Modes buy nothing**: no rule reads Fly, Climb or Swim (the lattice is already three-dimensional and nothing constrains vertical movement; falling is not modelled). A *Speed modifier* — add/subtract, halve/double, set to 0 — with a source and lifetime, derived like `armorClassOf`: Longstrider and Ray of Frost whole; Hypnotic Pattern's Speed 0 as a rider; Slow's halving partial; Fast Movement, Unarmored Movement, Roving's +10, Steady Aim's 0 — **~7 consumers across both populations** | **KEEP, narrowed** to the modifier; no modes. Medium: `moveCreature` and `PendingMove` read Speed at declaration |
| **C5** condition removal + modified healing | 6 + 7 | Two primitives bundled. **Condition removal**: Lesser Restoration whole; Heal (needs flat-only healing — `DiceScaling.dice` is required, one-line format question); Protection from Poison's first sentence; Greater Restoration partial; Self-Restoration and Mindless Rage's second sentence on the feature side. The arithmetic exists and is reached: `useHealingTouch` (`features.ts:157`) already removes a named condition wholesale — extract, do not reimplement. **Modified healing** (Chill Touch, Beacon of Hope): two consumers, a standing effect read by `healCreature`, a different primitive | **KEEP condition removal**, smallest task on the list; **drop modified healing** from it |

**The rider task** (`outcome-scoped-child-effects-2026-09-13.md`) is the one
item with a recorded design, and it closes three mis-filed adjudications,
removes `roll-mode.save`, and owns the file where the `on` fix lives. Its
sequencing constraint — after IE-007 — is discharged. It belongs in **tranche
4**, not 5. What forces the order among the rest is one primitive: every new
effect kind edits the `SpellEffect` union and `resolveEffects`, so at most one
of {riders, C5, C1, C3} runs at a time, and the conformance and scene work
runs beside them.

## 5. Proposed tasks, in priority order

| # | Task | Lane | Level | Parallel-safe | Closes |
|---|---|---|---|---|---|
| 1 | **Outcome riders** as recorded, plus the `on` union at `spell-resolution.ts:1631`, `roll-mode.save` removed, Disintegrate/Acid Arrow/Hypnotic Pattern re-filed | mechanism (`spell-resolution.ts`, union) | YELLOW-decided | first in the union chain | §3.2 first row, §3.6 first item, §3.1 first member |
| 2 | **Multiclass Hit Dice**: `poolsFor` calls `hitDicePools` | mechanism (`creation.ts`) | GREEN | YES | §3.6 wrong number |
| 3 | **Scene commands** — `commands/scene.ts` wrapping the five pure functions plus `time-advanced` and `spellcasting-declared`, through `once`, with a parity-test hook | mechanism (new module) | GREEN | YES beside 1–2 | §3.7 |
| 4 | **Format and validator guards**: every union member/optional field has a user or an exemption; `grant_without_lifetime`; `SpellCheck` fields; the special-case sweep over every source file; `spell-catalogue.test.ts` via `riderDurations`; `settleAreaEffects` reads `record.areaTrigger` | conformance (`spell-schema.ts`, tests, `turns.ts`) | GREEN | YES | §3.1, §3.3, §3.5, §3.6 third item |
| 5 | **Condition removal** (C5, narrowed) — extract `useHealingTouch`'s removal; flat-only healing | mechanism (union) | GREEN | after 1 | §4 |
| 6 | **Derived blockers for undefined spells** — `BLOCKED_ON` over the 207 undefined spells sharing `MISSING_SHAPES`; the three bundle ids split; `PROGRESS.md`'s map and the leverage audit re-pointed at the derivation; digits out of `CLAUDE.md` where `COVERAGE.md` is the truth | conformance | GREEN | YES | §3.2, §3.5 last item, §3.6 fourth item |
| 7 | **Granted Resistance** (C1, re-scoped) as `defensesOf`'s third input, cleanup through `releaseCasting`; the `grants` timer member with Superior Hunter's Defense as its user | mechanism (union, `events.ts`, `standing.ts`) | GREEN | after 5 | §3.4, §4 |
| 8 | **An outcome that varies by creature type**, and the declared "being fought" fact | mechanism (union) | GREEN | after 7 | §4 C2 replacement |
| 9 | **Speed modifier** (C3, narrowed) | mechanism (`combat.ts`/movement, union) | GREEN | after 8 | §4 |
| later | feature-definition validator; refusal-code sweep; per-event field schemas; `index.ts` tiering; the snapshot policy for the two indexes | conformance / M2 / M3 | — | — | §3.5, §3.6 |

A tranche 4 of **1 + 2 + 3 + 4** (one union task, three parallel-safe beside
it) is the shape the queue's own rules produce; 5 through 9 are the union
chain for tranches 5 and 6, in that order because each is smaller and better-
evidenced than the next.

## 6. What this audit deliberately does not recommend

- **Not movement modes** (Fly, Climb, Swim). No rule reads them; a vocabulary
  with no reader.
- **Not a `RollSelector` axis for "the save this casting forces".** It selects
  nothing any consumer needs.
- **Not modified healing** (Chill Touch, Beacon of Hope) — two consumers.
- **Not replacing `castingsEnded`** with a positional invariant — correct,
  simpler, and the cost is M3's to weigh with `appliedCommands`.
- **Not a general event-upcaster registry** — one upcaster, one user; the seam
  is named.
- **Not splitting `resolveEffects` as a task** — the rider task does the three
  branches that matter.
- **Not summons, compelled actions, a second scene, long casting times** —
  unchanged standing.
- **Not regenerating either fixture.**

## Measurement notes

- Value-vs-type import edges among `commands/*.ts` were classified by parsing
  each `import` statement for at least one non-`type` specifier; 61 value
  edges, 0 cycles by inspection of the resulting order (`command`, `holds` at
  the bottom; `activation` and `actions` at the top). A cycle through
  `index.ts` is impossible because no command module imports it.
- Field usage counts are `\bfield: ` occurrences in `spell-definitions.ts` from
  line 1269 (the first definition); readers are `.field` in non-test source
  *including* `spell-definitions.ts`'s own helper region — an earlier pass that
  excluded that file would have reported `flatPerSlotLevelAbove` unread, which
  is false.
- Fixture coverage: both JSON fixtures' distinct `type`s against
  `readonly type: '…'` declarations in `events.ts`.
- Refusal codes: `err('…'` and `needsContext('…'` literals in non-test source,
  each checked for the quoted string in any test file. Narrower than the third
  audit's method; the proportion is what is comparable.
- The `on` finding, the settlement read, `hitDicePools`, and the `held` sites
  were read, not executed; each proposed task begins with its reproduction.
- The C1–C5 re-derivation quotes `spells.md:942` (Charm Person), `:4425`
  (Protection from Energy), `:4449` (Protection from Poison), `:4890`
  (Shatter), `:5216` (Stoneskin), `:3468` (Lesser Restoration), `:3085` (Heal),
  `:3561` (Longstrider), and `classes.md:915` (Countercharm), `:6838` (Superior
  Hunter's Defense).
- Manual-note bucketing by keyword over the twelve class files is approximate
  for the feature counts and exact for the named features quoted.

## Audit summary block

```
Whole-engine audit — 2026-09-13 (fourth), at e2080da
Scope measured: 21 command modules and the barrel (value-level import graph, export reachability, `once` adoption); the definition format's 45 optional fields and union members against 132 definitions; all 102 adjudications in the two honesty maps against the SRD prose; the ongoing record, its upcaster and `castingsEnded`; `EffectTarget`; both frozen fixtures against the 91 event types; refusal-code assertion coverage; the SRD text behind every C1/C2/C3/C5 consumer; the foreman's six named candidates; prose counts in CLAUDE.md and PROGRESS.md.
Verdict: The architecture is sound and the three tranches closed what they claimed — the split is a DAG, the duplicate check is structural, the fixtures are complete, the fold no longer reads the catalogue. What is wrong is counting and filing: three ranking documents disagree by up to 4×, one adjudication in ten is filed to a bundle id, and two of the four remaining leverage candidates do not survive re-derivation. Two shipped wrong numbers and the largest instance yet of a rule reachable from nothing (scene setup) should lead tranche 4.
Findings, ranked: 1. `on` has two rules — spell-resolution.ts:1631 discards `held` for Range: Self; Dispel Magic misses Sunbeam's Blinded — a shipped wrong answer. 2. Multiclass Hit Dice wrong — creation.ts:2439 vs multiclass.ts:142 — a shipped wrong number. 3. Scene family has no command — positioning.ts:98/479/908/1303, combat.ts:220 — nothing can start an encounter. 4. Three rankings of one family (PROGRESS.md:1989 = 17, leverage §C1 = 4, SRD = 2) — every tranche planned from them inherits the error. 5. Ten of 102 adjudications mis-filed or bundled, on the three ids rankings were built from — spell-honesty.test.ts:140–147 — same cost. 6. Settlement reads the catalogue while the record pins it — turns.ts:488 vs ongoing-compatibility.ts:73 — a duplicate source of truth. 7. Three zero-user format members (`roll-mode.save`, `SpellCheck.dc`, `'end-casting'`) and no guard that can see one — speculative shape accumulates silently. 8. Validator gaps: no lifetime rule, no SpellCheck rule (spell-schema.ts:619/697 are the siblings) — a homebrew grant that never ends. 9. Special-case sweep reads the wrong file list — spell-schema.test.ts:651 — the claim it protects is unguarded in six files. 10. `resolveEffects` at 914 lines — the D12 finding relocated. 11. 41 of 112 refusal codes unasserted; feature definitions unvalidated; prose counts stale — hygiene, unchanged in proportion.
Confirmed healthy: value-level DAG across commands/ (61 edges, 0 cycles); `once` universal and `identify` has no direct caller; both fixtures cover 91/91 types; `'engine'` stamped only at rolls.ts:81/94 and rolls.ts untouched all period; all 12 effect kinds and every AreaTrigger field in use; both per-slot scaling fields read and driven; `spell-ongoing` resurrection refused; five of the third audit's eight open debts closed; `upgradeOngoing` correct and identity-preserving; the tombstone is the right instrument for `castingsEnded`.
Recommended re-scoping of the next tranche: Tranche 4 = the rider task (with the `on` fix and `roll-mode.save` removed) as the one union task, beside Hit Dice, scene commands, and the format/validator guards. Drop C2 "selector for the forced save"; replace with creature-type outcomes and a declared "being fought" fact. Re-scope C1 to 2+1 consumers as `defensesOf`'s third input, with the `grants` timer member only if Superior Hunter's Defense is taken. Narrow C3 to a Speed modifier, no modes. Split C5: keep condition removal (reusing `useHealingTouch`), drop modified healing.
Nothing was implemented.
```
