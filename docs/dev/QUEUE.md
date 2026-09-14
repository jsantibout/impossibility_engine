# Development queue

The in-flight state of the work. `PROGRESS.md` says what and why; this says
where each task stands right now. The foreman is the only writer of this file
and of everything under `docs/dev/`. The rules are in `docs/dev/WORKFLOW.md`;
`node docs/dev/check-queue.mjs` validates this file and every task file, and
prints the summary a fresh session reads first.

A task's state lives on the `state:` line of its own file under
`docs/dev/tasks/`. This file indexes tasks and records what no task file can:
**the tranches and their authority**, the gate log, and the audit history.

**The tranche is the unit of owner authority.** Approving one authorises
exactly the tasks on its roster to run all the way to a merged, pushed,
recorded `main` — and nothing else. No task joins an approved roster; the
validator refuses it.

## Audits

**Broad whole-engine audits are the owner's to initiate**, normally once per
heavy development day, in a fresh Fable session against a clean `main`. Fable
records each one by the existing convention and the next foreman session reads
the findings and may reorder or re-scope the queue before proposing work.

**The foreman keeps no counter and launches no broad audit.** It had one — a
task threshold, then an architecture-change budget — and both were removed on
2026-09-13 at the owner's instruction: audit scheduling is a judgement, and
automating it produced either too many audits or a number nobody trusted.

What the foreman still does is flag systemic risk. Where the evidence is
repeated cross-system special cases, several YELLOW escalations converging on
one boundary, persistence or replay uncertainty spreading past a bounded task,
contradictory foundational representations, repeated stale source-of-truth
failures, merged tasks invalidating each other, or conformance materially
overstating support, it writes `WHOLE_ENGINE_AUDIT_RECOMMENDED` here with the
evidence — and either stops at `OWNER_DECISION_REQUIRED` if continuing would
be unsafe, or finishes the tranche and reports it at `TRANCHE_COMPLETE`. An
isolated bug does not qualify, however serious, when its class is being closed
directly.

A bounded YELLOW escalation inside a tranche is **not** a broad audit: it is an
architecture consultation on one question, the foreman invokes it, and the
tranche carries on.

Audit recommendation outstanding: **none**.

A broad audit produces a retrospective **and** a next-cycle recommendation —
`WORKFLOW.md`, "What a broad audit produces". The fourth audit already did
both under the old charter: §0–3 are the retrospective and §5 is the forward
recommendation, which is what tranche 4 was built from, with its premises
verified against `main` first.

### Audits run so far

| | Date | Record |
|---|---|---|
| First | — | `PROGRESS.md`, "Architecture audit against the doctrine" |
| Second | — | `PROGRESS.md` |
| Third | 2026-09-13 | `docs/architecture/whole-engine-audit-2026-09-13.md`, commit `588d7a0` |
| Scoped gate | 2026-09-13 | `docs/architecture/outcome-scoped-child-effects-2026-09-13.md` — one design question, not a sweep |
| Fourth | 2026-09-13 | `docs/architecture/whole-engine-audit-fourth-2026-09-13.md` — the current architecture baseline |

## Tranches

### Tranche 1 — COMPLETE 2026-09-13 — "MERGE BOTH"
roster: IE-004, IE-003

Run under workflow V1, where the owner approved the work and then each merge.
Owner's words at Gate 1: "APPROVE BATCH"; at Gate 3: "MERGE BOTH".

| Role | Task | Lane | Merged as |
|---|---|---|---|
| PARALLEL | IE-004 — The honesty guard for executed spells | conformance | `0536a2b`, first |
| PRIMARY | IE-003 — Close the guard holes and make the guard sweeps mechanical | mechanism | `5dfbc39`, second, rebased cleanly over the first |

Both digests, both gate records and both merge records are on the task files.

### Tranche 2 — COMPLETE 2026-09-13 — "APPROVE TRANCHE 2"
roster: IE-005, IE-006, IE-002

The first tranche under V2: the approval authorises these three tasks through
implementation, review, ordinary rework, clean auto-merge, push and
bookkeeping, with no further merge gate. Nothing outside this roster moves.

| Role | Task | Lane | Parallel-safe | Merged as |
|---|---|---|---|---|
| PRIMARY | IE-005 — Split `commands.ts` by domain, behaviour-preserving | mechanism | NO beside mechanism; YES beside these two | `4f829e9`, third |
| PARALLEL | IE-006 — A second frozen event-log fixture | conformance | YES | `2915909`, second |
| PARALLEL | IE-002 — Pour twelve spells into the shapes that already execute | content | CONDITIONAL | `de45194`, first |

Independence check: PASS. IE-005 moves `commands.ts` into `commands/` and
sends eleven helpers to `attack.ts`, `positioning.ts`, `spell-definitions.ts`
(the helper region beside its types), `duration.ts` and `checks.ts`; it edits
test imports, the sweeps' module lists in `invariants.test.ts`, `CLAUDE.md`
and `CONTRIBUTING.md`. IE-006 adds a fixture, a scenario script, a
persistence test, a `.gitattributes` line and prose in `CONTRIBUTING.md` and
`CLAUDE.md`; no source file. IE-002 edits the definitions and registry region
of `spell-definitions.ts`, `VERIFIED_SPELLS` in the coverage script, spell
test files, `table` entries in `spell-honesty.test.ts` and `COVERAGE.md`.
Shared files: `spell-definitions.ts` between IE-005 and IE-002, in different
regions (helpers beside the types against definitions and the registry; the
registry merges by keeping both lines in id order); `CLAUDE.md` and
`CONTRIBUTING.md` prose, both sides kept. Dependencies: IE-005 on IE-003 and
IE-002 on IE-004, both merged. No design invalidates another: IE-005 changes
nothing observable, and IE-006's frozen log is exactly the test that would
say so if it did. Maximum concurrent builders: 3. Merge order: IE-006 and
IE-002 first (small), IE-005 last, rebased over the registry lines and the
prose. Likely Fable involvement: none foreseen — IE-005 is a move along seams
the third audit already measured, and the one structural helper it adds (the
duplicate-check wrapper) is named in the brief. Recommendation: APPROVE
TRANCHE 2.

### Tranche 3 — COMPLETE 2026-09-13 — "APPROVE TRANCHE 3"
roster: IE-008, IE-001, IE-007, IE-009

The approval authorises these four tasks through implementation, review,
ordinary rework, clean auto-merge, push and bookkeeping, with no further
merge gate. Nothing outside this roster moves.

Re-audited against the repository as it stands at `ceb11e6`, not against the
ordering tranche 2 left behind. Two items moved and one is new.

| Role | Task | Lane | Parallel-safe |
|---|---|---|---|
| PRIMARY | IE-008 — Every pool a level grants, granted at advancement | mechanism | YES beside spell resolution — **merged `601774c`** |
| PRIMARY | IE-001 — A condition applied with no saving throw | mechanism | CONDITIONAL — **merged `7592efe`** |
| SEQUENTIAL | IE-007 — The ongoing record: pin the area, drop the dead fields, close the four debts | mechanism | NO beside IE-001 — **merged `b80e0d5`** |
| PARALLEL | IE-009 — Close out tranche 2's four findings | conformance | YES — **merged `973129f`** |

**What the re-audit changed.**

- **IE-008 is new and outranks IE-001.** `advanceCharacter` emits pool events
  for hit dice and spell slots and for neither of the other two kinds
  `poolEvents` declares at creation, so every feature pool is frozen at the
  level the character was created at. A Paladin advanced 3 → 4 has 15 points
  of Lay On Hands instead of 20; a Sorcerer has 3 Sorcery Points instead of
  4. IE-006's builder found the missing-pool half and worked around it; the
  wrong-maximum half is larger and nothing had noticed it. A silently wrong
  number in a shipped path outranks a new capability.
- **The `resolveCast` `mayAct` guard moves from IE-001 to IE-007.** `NEXT`
  has said since IE-003 that it rides with the next command-layer mechanism
  task and named IE-001. After the split that is simply wrong:
  `resolveCast` is `commands/casting.ts:1051`, which IE-001 does not touch
  and IE-007 does. Moved, and the reason recorded on IE-007.
- **IE-001's demand is now measured rather than estimated.** Its brief
  guessed eighteen candidate spells from a prose scan; IE-002's spell-by-spell
  pass over all 211 undefined spells is better evidence, and the re-brief
  tells the builder to start there and expect fewer.
- **IE-001 and IE-008 are both mechanism and may still run together**, which
  the old one-owner rule would have forbidden. They share no primitive:
  IE-008 is `creation.ts` and resource authority, IE-001 is the `SpellEffect`
  union and `commands/spell-resolution.ts`. This is the first tranche to use
  what IE-005 bought, and it is used across *modules*, which is the narrower
  claim `WORKFLOW.md` now makes.

Independence check: PASS. IE-008 touches `creation.ts` and its tests; it adds
no event type and no fold change. IE-001 touches the `SpellEffect` union at
the top of `spell-definitions.ts`, `spell-schema.ts`,
`commands/spell-resolution.ts` and `coverage.ts`. IE-007 touches `events.ts`,
`spells.ts`, `commands/casting.ts`, `commands/spell-resolution.ts` and
`invariants.test.ts`. IE-009 touches one spell test file and `CLAUDE.md`.
Shared files: `CLAUDE.md` across all four and `COVERAGE.md` across two — both
known mechanical collisions, both sides kept, and tranche 2 is the evidence
that they rebase clean. IE-001 and IE-007 share `commands/spell-resolution.ts`
and the union, so they are **sequential, never concurrent**. Dependencies:
IE-001 on IE-004 and IE-005, both merged; IE-007 on IE-005 and on IE-001;
IE-008 and IE-009 on nothing.

Maximum concurrent builders: **3** (IE-008, IE-001, IE-009), then IE-007
alone once IE-001 has merged.

Merge order: IE-009 first (smallest, no runtime code), then IE-008, then
IE-001, then IE-007 rebased over it. The foreman runs every rebase.

Likely Fable involvement: **one plausible YELLOW, named in advance.** IE-007
item 2 removes two fields from a persisted record and versions the event
shape so both frozen logs still fold. If the builder finds that the frozen
logs cannot fold unchanged, that is a persistence-compatibility question and
it is Fable's, not the foreman's. IE-008 carries a smaller version of the
same risk — `golden-log-2.json` contains a real advancement — and its brief
says to stop and report rather than regenerate. Nothing else is foreseen:
IE-001 is a member added to a union whose three siblings already spell it,
and IE-009 is tests and prose.

Deliberately deferred, with reasons:

| Not in this tranche | Why |
|---|---|
| Outcome-scoped child effects | Still waiting on its second family. IE-001 is the first, and building the vocabulary from one is the guess the decision record refused |
| The nine unreachable event types | IE-009 **records** the fact; building commands for them is M2's tool-surface work and wants that surface's shape first |
| A refusal-code sweep, a feature-definition validator, per-event field schemas | Named in the third audit §3.4–3.5, §3.9; real, and none is a wrong number today |
| Resistance a spell grants; healing that lifts a condition; teleportation | The ranked map below. Each is a new shape, and this tranche already carries one |
| The whole-engine audit | Counter is 2 of 4. See below |

**The audit is not pulled forward, and the case for pulling it was
considered.** IE-008 is a correctness bug that three audits did not find,
which is an argument. It is not enough of one: the bug is a specific
divergence between two functions that should agree, not a systemic signal,
and IE-008's own brief closes the class by requiring one shared derivation
rather than two lists. What *is* accumulating for the next audit is on the
task files — a command layer that is now twenty-one modules and a barrel, a
public surface fourteen names wider, `once` making a guard-above-the-check
structurally impossible, and a second frozen log covering all 91 event types.
Four engine tasks is the trigger; this tranche's three mechanism tasks reach
it, so the audit falls due at the end of this tranche rather than inside it.

Recommendation: APPROVE TRANCHE 3.

### Tranche 4 — APPROVED 2026-09-13 — "APPROVE TRANCHE 4"

The approval authorises all ten listed tasks through implementation, review,
ordinary rework, clean auto-merge, push, bookkeeping **and later waves as
their dependencies are satisfied** — with no gate between waves. Nothing
outside this roster moves.
roster: IE-010, IE-011, IE-012, IE-013, IE-014, IE-015, IE-016, IE-017, IE-018, IE-019

**The first long, multi-wave tranche.** Ten tasks, four waves, roughly five
hours of autonomous development. Re-planned from the post-audit state under the
cadence policy of 2026-09-13: one owner approval authorises the whole roster,
there is **no gate between waves**, and the tranche stays the hard autonomy
boundary.

| Wave | Tasks | Waits on |
|---|---|---|
| 1 | IE-010 · IE-011 · IE-012 · IE-013 | nothing |
| 2 | IE-014 · IE-015 · IE-016 | IE-014 on IE-010 · IE-016 on IE-012 · IE-015 on nothing |
| 3 | IE-017 · IE-018 | IE-017 on IE-014 · IE-018 on nothing |
| 4 | IE-019 | IE-017 |

### The union chain is a chain of waves, not of tranches

The previous proposal said *"every new effect kind edits `SpellEffect` and
`resolveEffects`, so at most one union task runs at a time — therefore one per
tranche."* **The first half is true and the second does not follow.** The real
constraint is concurrency: at most one union-changing task may be *active*.
That is a wave dependency, and splitting it across tranches made the owner an
approval bottleneck for a fact the foreman already knew.

So the four ready union tasks are four waves inside one tranche:
**IE-010 → IE-014 → IE-017 → IE-019.** Each is briefed now, from the fourth
audit's own re-derivation against the SRD text, which is what makes including
them honest rather than optimistic.

### Roster

| Task | Lane | Wave | What it is |
|---|---|---|---|
| IE-010 — Outcome riders, and the two `on` rules made one | mechanism | 1 | the decided rider design, plus a shipped wrong answer in `on` and a zero-user format member — **merged `35ad5e3`** |
| IE-011 — Multiclass Hit Dice | mechanism | 1 | a shipped wrong number; calls a function that already exists and is tested — **merged `ded4e71`** |
| IE-012 — Scene commands | mechanism | 1 | nothing above the engine can start an encounter — **merged `6d3cb92`** |
| IE-013 — Guards that can see a zero-user member | conformance | 1 | the guard that would have caught three of the audit's own findings — **merged `b1a3b3c`**, and it found four |
| IE-014 — A spell that takes a condition away | mechanism | 2 | one union member reusing the removal `useHealingTouch` already performs — **merged `fb79ca2`** |
| IE-015 — `BLOCKED_ON` derived blocker map | conformance | 2 | ends three documents ranking one family at 17, 4 and 2 |
| IE-016 — The other nine facts a DM declares | mechanism | 2 | every declared event type reachable from the command layer — **merged `9847661`; all 91 now are** |
| IE-017 — A granted Resistance, and the deadline it needs | mechanism | 3 | `defensesOf`'s third input, and the fourth `EffectTarget` member — **merged `6dd56c4`** |
| IE-018 — A sweep for refusal codes nothing asserts | conformance | 3 | 41 of 112 unasserted, unmoved across two audits — **merged `ad4f0a6`; the real figure was 36 of 170, now 1** |
| IE-019 — An outcome that varies by creature type | mechanism | 4 | a second reader of a fact the engine holds authoritatively |

### Independence, and what serialises

- **The union and `commands/spell-resolution.ts`** serialise IE-010, IE-014,
  IE-017 and IE-019 — one active at a time, which is the wave chain.
- **IE-012 and IE-016** share a command module and the two derived sweeps in
  `invariants.test.ts`; IE-016 follows IE-012 for the pattern as much as for
  the file.
- **IE-011** is `creation.ts` and `multiclass.ts`, touched by nobody else.
- **IE-013, IE-015, IE-018** are conformance: `spell-schema.ts` and test files,
  with one read site in `turns.ts` (IE-013) that no other task touches.
- Shared across the roster: `CLAUDE.md` and `COVERAGE.md` — the known
  mechanical collisions, with three tranches of evidence that they rebase
  clean.

Concurrency: **4, 3, 2, 1** by wave — bounded by the independence check rather
than by a number.

### Execution and merge order

Wave 1 launches four. **IE-013 merges before IE-010**, because IE-013's
zero-user sweep counts `roll-mode.save` and IE-010 removes it. IE-011 and
IE-012 merge whenever they are clean.

Wave 2 launches IE-014 the moment IE-010 merges, IE-016 the moment IE-012
merges, and IE-015 as soon as there is a builder for it. **IE-015 merges after
IE-010**, which renames a shape id it reads.

Wave 3 launches IE-017 when IE-014 merges; IE-018 any time. Wave 4 launches
IE-019 when IE-017 merges.

The foreman runs every rebase.

### Likely Fable involvement

**None foreseen.** IE-010's architecture is decided and recorded, so a
deviation from it is `ARCHITECTURE_BLOCKED` rather than a judgement call.
IE-017 is the one that could raise a YELLOW: if the `grants` `EffectTarget`
member turns out to need a per-grant-kind identity after all, that contradicts
what Fable specified and goes back to Fable rather than being decided by the
foreman.

### Deliberately excluded, with reasons

| Not in this tranche | Why |
|---|---|
| **Speed modifier** (C3, narrowed) | It would be a *fifth* sequential union wave, pushing past the six-hour window, and it is the least specified of the chain — `moveCreature` and `PendingMove` read Speed at declaration and that surface has not been measured. First task of tranche 5 |
| **The declared "being fought" fact** | The other half of C2's replacement, for the five Charm and Dominate spells. A fact declared on a casting rather than a property of a creature — a different primitive with its own evidence |
| **Modified healing** (Chill Touch, Beacon of Hope) | Two consumers; the audit dropped it from C5 |
| **Feature-definition validator** | Real and unchanged since the third audit, but a bigger task than anything here and it has waited two audits without costing anything |
| **Per-event field schemas; `index.ts` tiering; the snapshot policy for `castingsEnded` and `appliedCommands`** | M2 and M3 own two of the three; none is urgent |
| **Movement modes** (Fly, Climb, Swim) | The audit refused them outright: no rule reads them, so it is a vocabulary with no reader |
| **Summons, compelled actions, a second scene, long casting times** | Unchanged standing; authority-bound |

Recommendation: APPROVE TRANCHE 4.

## CURRENT

**Tranche 4 is approved and running.** Wave 1 launched 2026-09-13 with four
builders, one worktree each. Waves 2, 3 and 4 launch as their dependencies
merge — **no owner gate between waves**; the tranche is the autonomy boundary.

| Wave | Task | Lane |
|---|---|---|
| 2 | [IE-015 — `BLOCKED_ON` derived blocker map](tasks/IE-015-blocked-on-map.md) | conformance — **held for one consolidated integration after IE-019; then `AWAITING_MERGE_APPROVAL`** |
| 4 | [IE-019 — An outcome that varies by creature type](tasks/IE-019-creature-type-outcomes.md) | mechanism — **launched on IE-017's merge** |

## NEXT

| Task | Why it is not in tranche 4 |
|---|---|
| **Speed modifier** (C3, narrowed — no movement modes) | A fifth sequential union wave would push past the window, and `moveCreature`/`PendingMove` read Speed at declaration, a surface nobody has measured. First task of tranche 5 |
| **The declared "being fought" fact** | C2's other replacement half, for the five Charm and Dominate spells — a fact on a casting, not a property of a creature |
| **Modified healing** | Chill Touch and Beacon of Hope; two consumers, dropped from C5 by the audit |
| **Feature-definition validator** | Named by the third audit and unchanged since; bigger than anything in tranche 4 |

After tranche 4, the next ranking should be **derived** rather than written:
IE-015 exists so that a shape's consumer count is a query. That is the audit's
fourth finding closed, and it is why nothing beyond this list is ranked here
yet.

## LATER

| Task | Lane | Note |
|---|---|---|
| a refusal-code coverage sweep; a feature-definition validator; the special-case guard's allowlist; per-event field schemas | conformance | named in the audit, §3.4–3.5 and §3.9; briefed when a tranche has room |
| `qb-builder.md`: builders share one scratchpad path and one overwrote another's file — tell them to use task-unique filenames | docs | found by IE-004's builder; the foreman has been saying it in every launch prompt since, which is the workaround rather than the fix |
| the marker set in `spell-honesty.test.ts` has no word for *object*, so Dispel Magic's "creature, object, or magical effect" clause is unread | conformance | a stated floor; extend when a second clause needs it |
| **`npm test` rewrites a tracked file, so the gauntlet's `COVERAGE.md` check passes for the wrong reason.** `coverage.ts` calls `writeFileSync('COVERAGE.md', …)` at module top level and two test files import it, so the suite regenerates the file it is then diffed against | conformance | IE-010's builder. Pre-existing and **more serious than it sounds**: `git diff --exit-code COVERAGE.md` has been asserting that the suite just ran, not that the committed file was right. Make the generation explicit and the check meaningful |
| **`checkEffect` branches dereference an effect's fields unguarded**, so untyped input reaching `checkSpellDefinition` directly throws instead of reporting. `end-condition` and `damage-defense` both do it | conformance | IE-017's builder, which matched the precedent rather than making one kind defensive and its neighbour not. **This is the same class the IE-010 re-review caught in `grantCarried`, where it was a real regression** — three instances now, so it is a class rather than a slip, and the fix is one pass over every branch |
| **`no_trigger` carries five distinct rules across three modules**; `nothing_to_interrupt`, `not_a_combatant` at `dash`, `bad_key`, `slot_not_allowed`, `bad_hit_die`'s second site and `no_damage` are unreachable or shadowed | conformance | IE-018, correctly reported rather than fixed — a refusal code is observable behaviour and a caller may branch on it |
| **Fire Shield is a fourth candidate for the granted defence** — "the warm shield grants you Resistance to Cold damage, and the chill shield grants you Resistance to Fire damage", a choice at the cast that `damageTypeStated` now expresses — but it is partial on its retaliation clause | content | IE-017's builder |
| **`CLAUDE.md`'s "A stat block created mid-fight" row is wrong about eight spells.** SRD 5.2.1 rewrote the Conjure family as *spirits*; none of the six prints an Armour Class, Hit Points or a turn, and neither does Guardian of Faith or Faithful Hound. **Conjure Fey is blocked on nothing at all** — Spiritual Weapon's shape exactly | content | IE-015's builder, corrected at source in that branch. So IE-002's "two spells the existing kinds express" was **three**, and this is the second time a hand-written claim in that file has been found wrong by a derivation |
| **The largest blocker in the book is a casting time of a minute or more — 54 blocked, 12 finished**, three times any other shape | — | IE-015's builder. **None of the three rankings had it at all.** The finding the task existed to produce, on its first run |
| **The derived query predicted an independent build.** `unblocks` named Stoneskin and Mind Blank as the spells a granted Resistance would finish; IE-017 built it and those are exactly the two that became definable | — | IE-015 and IE-017, independently. A derivation over 206 spells predicting which two another task would finish is stronger evidence than any assertion inside it |
| **A held Spirit Guardians loses its stated damage type.** `PendingCasting` carries no `damageType` and no `unaffected`, so a casting declared with `hold: true` silently settles with the definition's printed type instead of the one the caster stated | mechanism | IE-014's builder, pre-existing. A silently wrong damage type against a Necrotic-immune Undead is the exact failure `damageTypeStated` was built to prevent, reappearing on the interrupted-casting path |
| `sceneFor` is duplicated privately in `commands/movement.ts` and `commands/scene.ts`, prose included — **a third copy is the moment to hoist it** | mechanism | IE-016's builder and reviewer both |
| `spendMounting` remaps any non-movement refusal to `not_enough_movement`, copied verbatim from `resolveMove`, so mounting on somebody else's turn reports that code with a "not X's turn" reason | mechanism | IE-016; an inherited wart rather than a new one |
| `resolveMove` answers `no_scene` with a bare `needsContext` carrying no request, now that `setScene` exists to point at | conformance | IE-016; every command-level `needs-context` is supposed to name its provider |
| The throw-safety sweep asserts `.not.toThrow()` only, so it would also pass if the validator ever began *accepting* malformed input; `expect(isErr(...)).toBe(true)` closes that without naming a code or freezing collection order | conformance | IE-010's reviewer, non-blocking, and it accepted the builder's reasoning against pinning codes. One line, whenever that file is next open |
| An **array** rider satisfies `typeof === 'object' && !== null`, so it still draws the spurious second `grant_without_lifetime` the bare-string fix removed. The first and returned problem is the correct one, so nothing a caller reads is wrong | conformance | IE-010's reviewer; cosmetic, in the same function |
| **Condition 12 paid for itself, measurably.** IE-010 held a PASS at high confidence; the rebase over IE-013 rewrote the validator both tasks had edited; the re-review of the *combination* found that the loop conversion dropped a null guard, so `parseSpellDefinition` throws where it used to return `err('unknown_condition')` | — | not a debt — **evidence**. The full suite passed at 6,079, and the existing test for that exact input set a duration, so it drove only the branch that cannot reach the bug. "After the rebase the branch still passes the gauntlet" is the weaker half of condition 12; "nothing changed an assumption the review rested on" is the half that caught this |
| **A guard caught a stale exemption within hours of landing.** IE-013 exempted `SpellEffect.onSuccess='end-casting'` as "built and driven, but no definition writes it"; IE-010's Hideous Laughter writes it, and the zero-user sweep refused the stale exemption on the rebase | — | not a debt — **evidence**, recorded because it is the cheapest demonstration this repository has that the guard pays. Keep it in mind when the next exemption is written |
| ~~**The gauntlet has a real flake**~~ — **closed by IE-013** (`b1a3b3c`), which gave the assertion a 30-second timeout after measuring base 0/16, with-work 4/15, control 0/8, fixed 10/10. Kept here because three builders met it independently and the lesson is that a compatibility test near a default timeout teaches everyone to re-run a red build | `persistence-2.test.ts`'s "round-trips at every prefix of the log" takes ~3.3s alone and crosses vitest's 5000ms default under full-suite load — 5042/5500/5668ms, failing 4 of 6 cycles, and confirmed *not* caused by either builder's new tests | tooling | IE-011 and IE-012 independently. Two builders and a foreman have now each seen it. It is a frozen-log compatibility test, so raising its timeout is a decision rather than a tweak, and it belongs with the `COVERAGE.md` finding as gauntlet reliability work |
| `ContextRequest.satisfyWith` still names *events* for facts that now have commands — `commands/targeting.ts` says "a scene-set event" in three places and `commands/movement.ts` says "a creature-placed event" | conformance | IE-012's builder; both are now satisfiable by `setScene` and `placeCreatureInScene`. Left alone because `targeting.ts` is adjacent to IE-010's surface |
| `acid-arrow` is driven end to end by `delayed-damage.test.ts` and is not in `VERIFIED_SPELLS` | content | IE-010's builder; a pre-existing understatement of coverage, in somebody else's lane |
| the cross-slot rider order is unpinnable — no castable definition carries two slots, and a homebrew one would validate and still not be castable because `definitionFor` reads the catalogue rather than state | conformance | IE-010; stated in the test and in `CLAUDE.md` rather than implied. Closing it wants definitions readable from state, which is the named authorship seam || `persistence-2.test.ts`'s "round-trips at every prefix of the log" took 5876ms against vitest's 5000ms default under load from three concurrent builders | tooling | IE-011's builder, on a fresh worktree; it passes in isolation and in every subsequent full run, so it is a timeout rather than a logic failure. **It is the first test that will flake if CI ever runs builders concurrently**, and wave 1 ran four || **`roll-mode.save` has zero users in the catalogue.** Blur and Beacon of Hope are the only `roll-mode` effects and neither saves | content | Fable, §H. A speculative branch field, and the clearest example in the repository of what one looks like. Remove it — and the outcome-rider design makes it redundant besides |
| **Disintegrate is mis-adjudicated to `outcome-scoped-child-effects`**, and IE-002 mis-filed **Ice Knife** and **Chromatic Orb** to it too | conformance | Fable, §C. Disintegrate needs a third outcome axis (save → damage → 0 HP) with one consumer; Ice Knife is two sequenced rolls plus an area at a target; Chromatic Orb is a chained attack on a dice-face trigger. Re-file all three |
| **`checkSpellDefinition` has no rule for a casting-owned rider on a definition with no lifetime** — a grant linked to a casting that never becomes ongoing and never ends | conformance | Fable, §E. The foreman drove all 132 definitions: **none today**, so this is a missing guard rather than a defect, and it is cheap because nothing has to be fixed first |
| Should `save`'s **stored** layout adopt `ConditionRider` too? IE-001 gave it the type through `conditionRiderOf` without moving its storage, because the brief forbade changing the member. Moving it is ~30 definitions, the schema and `riderDurations`, and buys uniformity of storage where uniformity of vocabulary is already had | mechanism | IE-001's builder raised it as a question rather than taking it. A decision, not a defect |
| `check` and `outlivesCasting` are now reachable on the `attack` and `save-damage` riders, where no definition uses them and no test covers those two combinations | content | the declared cost of one shared rider rather than three; expressible and unexercised |
| **`alsoOn` cannot grow `on` at the cast**, because `spell-ongoing` is pushed at the end of `resolveEffects` and every `condition-applied` in the batch folds before it. A Range: Self area spell — Sunbeam — blinds a creature and is not recorded as being on them, so a Dispel Magic aimed at that creature finds nothing. **And `CLAUDE.md`'s "now applied at the cast as well" is false for this case** | mechanism | IE-007's builder, pre-existing rather than introduced. A behaviour gap and a false sentence in the constitutional file; the sentence should be corrected when the behaviour is, or by the counts sweep below, whichever reaches it first. Deliberately not stretched into IE-007's bounded pass |
| **Settlement is still catalogue-driven.** `settleAreaEffects` resolves a trigger's `effects` through `definitionFor` (`commands/turns.ts:488`), so IE-007's pinned `areaTrigger.effects` and `.label` have no reader, and a correction to Web's saving throw still reaches a debt raised before it | mechanism | IE-007, documented rather than fixed: making settlement read the record is a second versioning change, because a pre-versioned record has no effects to restore. The irony is on the record — the same commit deletes `route` and `concentration` for being stored with no reader |
| **A sweep holding `CLAUDE.md`'s counts against `COVERAGE.md`.** Scope it to the sections where a count is *load-bearing* — IE-009's reviewer was explicit that it must not re-introduce digits where a guard would protect a number nobody needs. Four prose counts went stale inside tranche 3 alone — 130 definitions (now 132), eleven readers (twelve), "fifty-eight of the eighty-two executed" (86), "fifty-three" partial (54), "fifty-two companions" — and IE-001 moved most of them in one commit | conformance | IE-009, twice over: once as the defect it was sent back to fix and once as three more instances it found in sections it never touched. The repository's own answer to a number that matters is a generator and a CI guard; prose has neither. A strong candidate for tranche 4 — cheap, in the repo's idiom, and it closes a class rather than an instance |
| `spell-schema.test.ts`'s runtime special-case sweep does not read `spell-definitions.ts`, where IE-005 moved seven readers | conformance | IE-009's builder. No special case is there today, verified with the sweep's own regex, so it is a hole and not a breach. The sweep's first half — an id compared against a literal — can simply be pointed there; its second half cannot, because a file of definitions names all 130 of its own ids |
| **Multiclass Hit Dice pools are wrong, and the correct function is called by nothing.** `hitDicePools` (`multiclass.ts:142`) implements "Hit Dice pool by die type", is tested against both SRD worked examples (`multiclass.test.ts:203`) and is reached from no production code; `poolsFor` declares one Hit Die pool from the *starting* class. A Paladin 4 / Fighter 1 gets one `hit-die:d10` pool; a Cleric/Paladin gets no d8 pool at all | mechanism | IE-008's builder and reviewer, independently, in the function IE-008 refactored. Pre-existing and byte-identical across that diff, so it was correctly left alone. The eleventh instance in this repository of a pure function nothing calls, and a wrong number rather than a missing feature |

IE-003's two residuals are discharged: `carriesEvents` now answers
`'unresolved'` for a union payload with a driven non-vacuity case, and the
`TurnResolution.duplicate` docstring covers `resolvePendingSaves`.

Beyond that, the order is `PROGRESS.md`'s "Next actions, in order" and the
ranked map beneath it, which the audit re-confirmed for spells: Resistance or
Immunity a spell grants; healing that lifts a condition or raises the dead;
damage with neither roll nor save; teleportation; automatic area drift; the
standing spatial effect; `cause` on events; summons; long casting times.

## Gate log

| Date | Gate | Task(s) | Owner's decision |
|---|---|---|---|
| 2026-09-13 | Gate 1 (pre-audit) | IE-001, IE-002 | not approved; the owner asked for the whole-engine audit first, and it replaced the batch |
| 2026-09-13 | Gate 1 | IE-003, IE-004 | approved — "APPROVE BATCH"; tranche 1 launched with two builders |
| 2026-09-13 | architectural gate | IE-004 | inspected (three declared deviations, accepted); returned once for a self-contradicting `CLAUDE.md` paragraph; lightweight PASS on the rework |
| 2026-09-13 | architectural gate | IE-003 | `ARCHITECTURE_BLOCKED` at the three-round limit, judged procedural; inspected, all accepted; a fourth round authorised for two lines; lightweight PASS on the re-issue |
| 2026-09-13 | Gate 3 | IE-003, IE-004 | approved — "MERGE BOTH"; IE-004 merged `0536a2b`, IE-003 merged `5dfbc39`, both gauntlets green on `main`, pushed |
| 2026-09-13 | Gate 1 | IE-005, IE-006, IE-002 | presented as batch 2 under V1; re-presented as tranche 2 under V2 |
| 2026-09-13 | workflow change | — | V2: the Opus foreman coordinates, Fable is on call, and the owner's authority moves to the tranche. `docs/dev/WORKFLOW.md` |
| 2026-09-13 | architectural gate | IE-005 | three builder rounds ended `DEFECTS` on two doc comments; judged procedural, the unreviewed delta inspected, a fourth round authorised on the rebased commit, a fifth for one paragraph, `PASS` at the confirmation pass |
| 2026-09-13 | workflow change | — | `WORKFLOW.md` "Parallel safety": the command layer is no longer one primitive. One module under `commands/` is; two mechanism tasks in different domains may run concurrently, and still collide on the barrel and `invariants.test.ts` |
| 2026-09-13 | workflow change | — | Two repeated tranche-2 findings folded into the procedure: **round exhaustion is not a failed review** (the foreman may authorise one further bounded pass when findings are strictly shrinking, confidence high, escalation none and the remainder is not architecture — never manufacturing a PASS, never skipping independent review), and **rebases are the foreman's** (builders finish and report a branch; briefs stop asking them to rebase). `WORKFLOW.md`, `qb-builder.md` |
| 2026-09-13 | Gate 1 | IE-008, IE-001, IE-007, IE-009 | approved — "APPROVE TRANCHE 3"; launched with three builders, IE-007 held until IE-001 merges |
| 2026-09-13 | planning objective | — | the SRD surface is planned as a leverage problem — verified coverage per unit of engine complexity, not raw spell count. A change to the foreman's objective, not to authority: review loop, thirteen conditions, bounded extra pass, escalation and foreman-owned rebases all unchanged. `docs/architecture/spell-leverage-audit-2026-09-13.md` |
| 2026-09-13 | whole-engine gate | — | chartered, and **scoped by the owner** to one question: the restricted child vocabulary for outcome-scoped child effects. Design record only; `REJECT` and "narrower than asked" are legitimate answers. Tranche 4 not launched |
| 2026-09-13 | whole-engine audit | — | **the fourth, run in full** at the owner's instruction after the scoped gate: 21 command modules, 45 format members against 132 definitions, 102 adjudications against the SRD prose, both fixtures against 91 event types, and every leverage candidate re-derived. Counter reset, because the sweep actually happened. `docs/architecture/whole-engine-audit-fourth-2026-09-13.md` |
| 2026-09-13 | Gate 1 | IE-010, IE-011, IE-012, IE-013 | presented as a short tranche 4; superseded by the cadence change before approval |
| 2026-09-13 | cadence change | — | tranches target 4–6 hours and ~8–12 tasks in dependency-aware **waves**, one approval for the whole roster and no gate between waves; "sequential" is a wave, not a tranche. `WORKFLOW.md` |
| 2026-09-13 | cadence change | — | **audit scheduling removed from the foreman.** No counter, no threshold, no automatic launch — the owner initiates broad audits, normally once a day, in a fresh Fable session against clean `main`. The foreman flags `WHOLE_ENGINE_AUDIT_RECOMMENDED` on systemic evidence and stops at `OWNER_DECISION_REQUIRED` only if continuing would be unsafe. Bounded YELLOW escalations are unchanged. `WORKFLOW.md`, `check-queue.mjs`, `CLAUDE.md` |
| 2026-09-13 | Gate 1 | IE-010 … IE-019 | approved — "APPROVE TRANCHE 4"; the first long multi-wave tranche: ten tasks, four waves, ~5 hours. Wave 1 launched with four builders; waves 2–4 launch on their dependencies with no further gate |
| 2026-09-13 | audit charter | — | a manually initiated broad audit now produces **two** things: the retrospective, and a **next-cycle recommendation** covering roughly 4–6 hours — highest-leverage work and why it outranks the alternatives, correctness before capability, dependencies, what is parallel and what is sequential, what Opus may execute and what needs Fable first, source-of-truth work needed before prioritisation can be trusted, and what to defer. Fable owns *what and why*; the foreman owns *how*. A recommendation is not authorisation. `WORKFLOW.md` |
| 2026-09-13 | whole-engine gate | — | **answered: `APPROVE, narrowed`.** Outcome *riders*, not child effects — leaf types in fixed slots on `attack`, `save-damage` and `save`, with the branch fixed by the host and the invariant that a rider never rolls. `onFail: SpellEffect[]` rejected on evidence. Tranche 4 not reordered; C1 re-briefed. `docs/architecture/outcome-scoped-child-effects-2026-09-13.md` |
| 2026-09-13 | Gate 1 (tranche) | IE-005, IE-006, IE-002 | approved — "APPROVE TRANCHE 2"; tranche 2 launched with three builders, no further merge gate |
