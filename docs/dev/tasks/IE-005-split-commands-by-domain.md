# IE-005 — Split `commands.ts` by domain, behaviour-preserving

state: DONE
lane: mechanism
tranche: 2
parallel-safe: NO beside any mechanism task; YES beside conformance and content, which do not touch the command layer
depends-on: IE-003
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 2"
merge-approved: 2026-09-13 — "APPROVE TRANCHE 2" (tranche 2 authority; 13/13 conditions green)

## Brief

### Objective

Move `commands.ts` (10,149 lines, 13 regions, 76 exports, 71 helpers) into
domain modules along the seams the audit measured, changing no behaviour,
and introduce the one structural helper the audit asks for: a command
wrapper that performs the duplicate check before any validation, so "the
duplicate check comes first" stops being discipline.

### Why now

`docs/architecture/whole-engine-audit-2026-09-13.md`, §3.2 and §3.9. The
comparative audit's #7 was affirmed with measurement: D12 is 28% of the file,
15 helpers cross regions, four are filed where nothing calls them, and every
mechanism task collides in this one file — which is what the workflow's
one-owner-per-primitive rule serialises today. After the split, two mechanism
tasks in different domains can run beside each other.

### Current relevant architecture

The measured domain map and seam table are in the audit record (§3.2) and,
in full, in the commands-map sweep it cites: thirteen regions by the file's
own banners; `creatureOf` and `unknownCreature` called from all of them (110
sites); the fifteen cross-domain helpers (`savingSupport`, `schedule`,
`completeIfSettled`, `dealSpellDamage`, `resolveEffects`, `chooseRoute`,
`moveWithin`, `featureTimer`, `rollSpellDice`, `ranged`, `unsettledRefusal`,
`castOrRelease`, `quantityOf` and the two creature readers); eleven helpers
that belong in existing modules (`reachOf`, `rawDamageTotal` →
`attack.ts`; `apartFrom`, `apartFromSource` → `positioning.ts`;
`castingNumber` → `spells.ts` (IE-003 does this one); `onCaster`, `persists`,
`ranged`, `needsCasterSheet`, `statedDamageType`, `riderDuration`,
`riderDurations` → `spell-definitions.ts`; `mayAttempt` → `duration.ts`;
`skillName` → `checks.ts` or `@ie/shared`). Every command folds its own batch
through `applyEvent`.

### Required behaviour

1. Modules under `packages/engine/src/commands/`: identity (already
   `idempotency.ts` after IE-003), creatures, conditions, facts, actions,
   movement, attacks, reactions, ongoing, features, casting, turns,
   spells (targeting and resolution as two files), inventory — or a
   defensible variant the builder states. `commands.ts` becomes a re-export
   barrel so every existing import keeps working; `index.ts` unchanged in
   what it exposes.
2. The eleven misfiled helpers move to the modules named above.
3. A `command(...)` wrapper (or equivalent) that takes the identity and the
   inputs, performs `identify` and short-circuits on replay before the body
   runs; the commands that already call `identify` first adopt it. No
   command's observable behaviour changes.
4. The defender-mode assembly block that appears at the weapon and spell
   attack sites becomes one helper.
5. Tests change only in their imports. `golden-log.json` untouched; the
   scripted scenario replays byte-identically; every test passes unchanged.
6. Two residuals IE-003's reviewer left, both inside files this task rewrites
   anyway and neither a behaviour change: `carriesEvents` in
   `invariants.test.ts` answers a silent `false` for a `Result<A | B>`
   payload and must answer `'unresolved'` instead, so a union-returning
   export is reported rather than skipped; and the docstring on
   `TurnResolution.duplicate` describes `resolveTurn` alone and must cover
   `resolvePendingSaves`, which now sets it too.

### Architecture constraints

- Behaviour-preserving: no fix, no rename of an error code, no change to an
  event. A defect found on the way goes in the digest, not in the diff.
- The value-level import graph stays acyclic; `creatureOf` /
  `unknownCreature` live in one module every domain imports.
- One commit; the diff is a move, and the reviewer checks it as a move.

### Acceptance criteria

1. `commands.ts` is a barrel under a few hundred lines; no domain module
   exceeds about 1,500 lines except spell resolution, which the builder splits
   in two.
2. The whole gauntlet passes with no test body edited, except the module
   lists of the sweeps in `invariants.test.ts` and the two residuals in
   item 6.
3. `git diff --stat` shows the moves; a spot-check of three helpers confirms
   byte-identical bodies.
4. The wrapper exists and every command that calls `identify` first uses it.

### Tests and conformance

Existing suites unchanged; the invariants sweeps from IE-003 still enumerate
every command (they must enumerate across the new modules, so the builder
updates the enumeration source).

Concretely, after IE-003 landed: `invariants.test.ts` reads `commands.ts` and
`rest.ts` by file name into `MODULE_SOURCE` for the action-economy closure,
and the return-type classifier reads a fixed list of declaration files into
`DECLARATIONS`. Both lists must name every new module under `commands/`; the
"would find an unguarded spender if one were added" and "would find an
unguarded event-returning export if one were added" samples must still bite;
and both allowlists must come out unchanged. A command that vanishes from a
sweep because its new module was not listed is exactly the silent failure the
sweeps exist to prevent, so the builder proves the enumeration still sees
every command it saw before the move (the counts are in the sweeps' own
assertions).

### Dependencies

IE-003 (the identity module and the sweeps it adds).

### Likely file surface

`packages/engine/src/commands.ts` and the new `commands/` directory;
`attack.ts`, `positioning.ts`, `spell-definitions.ts`, `duration.ts`,
`checks.ts` (receiving helpers); `index.ts`; test imports; `CLAUDE.md`
(the "Transitions Are Engine-Owned Batches" and "Architecture" sections
name the layout); `CONTRIBUTING.md` (lane B's file list).

### Out of scope

Any behaviour change; the fold's content reads (IE-007); tiering the public
surface.

### Known risks

- Size: a 10,000-line move is where a quiet mistake hides; the guard is that
  nothing but imports changes in tests and the golden log folds identically.
- Merge collisions: nothing else in the mechanism lane may be in flight.

## Completion digest

```
IE-005 — Completion digest
Approved architectural intent: Move `commands.ts` (10,149 lines, 13 regions) into domain modules along the seams the third whole-engine audit measured, changing no behaviour, and introduce a command wrapper that performs the duplicate check before any validation so "the duplicate check comes first" stops being discipline.
Builder: COMPLETE
Worktree: .claude/worktrees/agent-ab2df59a29d903986   Branch: worktree-agent-ab2df59a29d903986   Commit: ae2bdbe (rebased by the foreman to 4f829e9)   Rebased on main at: ef3ce71, then 0d0fc2d — both by the foreman, neither by the builder
Opus review: DEFECTS (all resolved) — rounds: 4, plus a fifth-round fix and a confirmation pass; PASS at the confirmation pass
Tests: 5508 passing / 5508 total; new tests: 0 behavioural. Mutations run, each failing for the right reason: (1) `isUnion` forced to `false` fails the classifier's own vacuity case; (2) the action-economy closure run per module instead of over the joined source fails the sweep naming `resolveAttackDamage` and three other spenders it could no longer see; (3) `defendingModes` emptied fails a weapon-attack test *and* a spell-attack test, which is what proves it is one gatherer rather than two spelled alike; (4) `if (request.spellId === 'fireball')` smuggled into `commands/spell-resolution.ts` fails the special-case sweep by module name.
Gauntlet: typecheck ✓ lint ✓ test ✓ coverage diff ✓
Conformance: PASS — COVERAGE.md regenerated byte-clean; no file under `docs/dev/`, `PROGRESS.md`, `packages/engine/fixtures/` or `packages/srd/raw/` touched.
Architectural deviations:
  1. **`once` lives in `idempotency.ts`, not under `commands/`.** `rest.ts`'s `beginRest` adopts it, and `rest.ts` reaching up into the command layer is the one upward edge IE-003 removed. `once` is not a rule about any particular operation, so it sits beside `identify`. Consequence: `@ie/engine` gains `once` as an export.
  2. **The public surface of `@ie/engine` widens by 14 names**, none of them commands. Thirteen are the misfiled helpers of brief item 2, which must be exported from their receiving modules for `commands/` to call them; the fourteenth is `once`. **The command surface is exactly unchanged at 118 names** — the barrel enumerates rather than stars, precisely so a sibling-facing helper does not become public.
  3. **Module layout is a stated variant** of the brief's list, which permits one. Twenty-one modules: the brief's named domains, plus `command` (the two creature readers, called from all thirteen old regions), `holds` (every engine debt with `mayAct`/`unsettledRefusal` — a debt is read by the commands that did *not* create it), `rolls`, `pools`, `damage`, `activation` and `initiative`. Spells are `targeting` + `spell-resolution`, as asked.
  4. **`spell-resolution.ts` is 1,628 lines**, over "about 1,500" — the exception the acceptance criterion names for spell resolution. Every other module is ≤ 1,206.
  5. **Three test files beyond `invariants.test.ts` had bodies edited**: `spatial-model.test.ts`, `spell-schema.test.ts` and `tools/llm-probe/src/parity.test.ts`. All four read the command layer as a *source artefact*; left alone they would have scanned a 158-line barrel and passed vacuously. No assertion changed in any of them; each now reads a directory listing rather than a file name.
  6. **`CLAUDE.md`'s one-owner-per-primitive bullet now permits concurrency across command domains.** A workflow claim rather than a code fact, and the brief's own stated rationale. Flagged for the foreman to read deliberately.
Foundational primitives touched: the entire command layer (`commands.ts` → 21 modules under `commands/`, behaviour-preserving); `idempotency.ts` (new `once`); `rest.ts` (`beginRest` adopts it); `attack.ts`, `positioning.ts`, `checks.ts`, `duration.ts`, `spell-definitions.ts` (receiving the thirteen misfiled helpers). `events.ts`, the reducer, roll resolution, Advantage semantics, the action economy, conditions, durations, the spatial model, targeting, saves, attacks, resources and persistence are unchanged in behaviour — verified declaration by declaration: of 194 declarations at base, 117 byte-identical in their new module, 64 differing only by the `once` adoption and statement-for-statement identical otherwise, 13 left for the modules the brief named, 0 unexplained, and exactly one declaration exists that did not before (`defendingModes`).
New runtime special cases: none.
Files outside the brief's surface: `idempotency.ts` (deviation 1); `rest.ts`; `spell-schema.test.ts`, `spatial-model.test.ts`, `tools/llm-probe/src/parity.test.ts` (deviation 5); `spell-schema.ts` and `spellcasting.ts` (one doc-comment pointer each). `index.ts` needed no change and has none.
Out-of-scope findings (not acted on): `spell-definitions.ts` now holds seven functions beside its data, which softens CLAUDE.md's "`spell-definitions.ts` was never code" framing about that file. Brief-directed, not a defect, but the sentence may want revisiting.
Unresolved concerns: none that block.
Reviewer confidence: high
Recommendation: READY FOR MERGE

IE-005 — Independent review (fourth round, on the rebased c96d0ed)
Verdict: DEFECTS
Gauntlet re-run: typecheck ✓ lint ✓ test 5508/5508 coverage diff ✓
Brief compliance: met on all six items. 21 modules under `commands/`, `commands.ts` a 158-line enumerated barrel, `index.ts` byte-unchanged; all 13 misfiled helpers moved byte-identical; `once` with 47 adopters and zero `identify` call sites left under `commands/`; `defendingModes` reproducing both blocks and called from `attacks.ts` and `spell-resolution.ts`; golden logs untouched; both IE-003 residuals done.
Verified rather than accepted: 194 old declarations all accounted for with nothing invented; every body difference falling into exactly three classes (the `export` keyword, the mechanical `identify`→`once` conversion, the two `defendingModes` call sites); 115 distinct error codes and 66 distinct event-type literals appearing with identical counts old vs new; the barrel publishing exactly the same 118 names by set comparison; the value-level import graph across `commands/` parsed and acyclic, with `command.ts` and `holds.ts` as sinks and no module importing the barrel; the foreman's rebase checked independently, with IE-006's prose intact and both fixtures byte-identical.
The four edited test files each still bite: `spatial-model` counts `anchoringFor(` = 3 across the directory (0 on a barrel → fails); `parity`'s `fieldsOf` asserts the interface was found; `spell-schema`'s `RUNTIME` is a `readdirSync`, so it now scans the 10,000 lines where a special case could be written instead of a barrel that trivially passes — **this one could have gone vacuous, and the builder caught it**; `invariants`' action-economy sweep asserts its enumerated spender set equals the unchanged `SPENDERS ∪ UNGUARDED_ON_PURPOSE` in both directions, which is the brief's required proof that the enumeration still sees every command it saw before.
Defects for the builder: 1. `CLAUDE.md` — inserting the two new `###` subsections orphans the "Death that is not hit-point loss…" paragraph under the `once` subsection, where it is a non-sequitur. Move it back above them. Editorial only: no code, no test, and nothing else in this review needs revisiting.
Escalation reason: none
Confidence: high
Recommendation: RETURN TO BUILDER

IE-005 — Independent review (confirmation pass)
Verdict: PASS
Commit reviewed: 4f829e9497f0d439417559a3f9d77df5919e9358   Gauntlet re-run: typecheck ✓ lint ✓ test 5508/5508 coverage diff ✓
Brief compliance: met — the fourth-round verification at c96d0ed stands unchanged, because the packages/ and tools/ trees are byte-identical between the two commits (packages 792f484…, tools 9914be7…, CONTRIBUTING 4e74681…, .gitattributes 59a5227…). Identical tree hashes make an unnoticed code, test or fixture change impossible, not merely unobserved.
The paragraph reads correctly where it now sits: `CLAUDE.md:3924–3926`, the fourth paragraph of `## Transitions Are Engine-Owned Batches`, directly after "Healing lifts only the `ZERO_HIT_POINTS` cause…" and above both new subsections. The section-level prose now runs damage → unconsciousness → healing → death, which is the order it had before the split.
Tests: unchanged (identical tree hash); re-run green at 5508/5508 across 93 files, the same count as the reviewed commit, over a base that moved only by a docs/dev commit.
Regression risk: none. Both golden logs byte-identical to main; docs/dev, PROGRESS.md and packages/srd/raw untouched by the branch.
Conformance: PASS — COVERAGE.md regenerated with an empty diff.
Scope creep: none. The only branch-content change since c96d0ed is the four-line CLAUDE.md paragraph move.
Architectural violations: none
Hard-coded or test-specific fixes: none
Accidental coupling: none
Foundational primitives touched: as reviewed at c96d0ed. No change since.
New runtime special cases: none
Defects for the builder: none
Escalation reason: none
Confidence: high
Recommendation: READY FOR MERGE
```

## Risk gate

The largest task of the tranche and the one that carried real signals: a
foundational primitive changed wholesale, a new abstraction introduced, six
declared deviations, and three review rounds that did not reach a PASS. The
diff was inspected, twice, and the review was extended twice rather than
waved through.

**The review rounds are the part worth recording.** The builder's three
permitted rounds ended `DEFECTS`, which the workflow lists as a YELLOW — the
reasoning being that repeated failure to converge suggests the architecture
cannot express the implementation. It did not mean that here: each round's
findings were strictly smaller, the reviewer wrote "Escalation reason: none"
and "Confidence: high" every time, and the final two defects were stale doc
comments. The foreman read the unreviewed delta — three comment lines, no
code — and judged it procedural exhaustion. That is the same call tranche 1
made for IE-003, on the same evidence, and it is recorded here so a third
instance can be recognised as a pattern rather than decided afresh.

A **fourth round** was authorised on the rebased commit, which put conditions
3 and 12 in one pass. It came back with one editorial defect and a great deal
of verification. A **fifth round** fixed the paragraph; the builder was told
not to launch a reviewer, because a fresh one would have re-derived 11,000
lines to confirm a three-line move. The **confirmation pass** went back to the
reviewer that already held the verification, and it answered by comparing
**tree hashes** rather than reading the diff — which is a stronger answer than
was asked for, and the right one.

**The deviation that mattered was the test files.** Three beyond
`invariants.test.ts` had bodies edited, which acceptance criterion 2 did not
anticipate. All four read the command layer as a *source artefact*, and a
barrel is 158 lines: left alone they would have scanned it, found nothing, and
passed. `spell-schema.test.ts` is the one that proves the point — it asserts
that no runtime spell-name special case exists anywhere in the command layer,
and over the barrel it would have gone quietly vacuous while the 10,000 lines
where such a case could actually be written went unread. The builder caught
it, the reviewer confirmed each sweep still bites, and the mutation that
smuggles `request.spellId === 'fireball'` into a module fails by module name.
That is the exact failure this repository has recorded twice before — a guard
that reports no problems because it checks nothing — arriving inside the task
that created the conditions for it.

**The surface widening was checked rather than accepted.** `@ie/engine` gains
14 names, thirteen of them helpers the brief itself ordered moved into
star-exported modules. The claim that matters is that the *command* surface is
unchanged, and it was verified by set comparison: exactly 118, none added,
none removed. None of the thirteen confers authority — they are pure readers,
and `identify` was already public.

**Behaviour preservation was established declaration by declaration**, not by
spot-check: 194 declarations accounted for, every body difference in one of
three mechanical classes, 115 error codes and 66 event-type literals at
identical counts, both frozen logs byte-untouched, and the scenario replay
passing unedited. The second frozen log IE-006 merged three commits earlier is
part of that evidence — it is exactly the test that would have caught a fold
this move disturbed.

GREEN, on the fifth round and the confirmation pass. Merging under tranche 2
authority.

## Merge record

Merged to `main` as `4f829e9`, fast-forward, pushed. Worktree retired and
branch deleted.

Rebased twice by the foreman, never by the builder — the permission classifier
refuses `git rebase` to a builder, which this tranche established with IE-002.
First onto `ef3ce71`, over IE-002 and IE-006 and their bookkeeping; then onto
`0d0fc2d`. Both conflict-free, including across `CLAUDE.md`, which all three
tasks of this tranche edited — the known collision, and it resolved without a
conflict at all because the regions were disjoint.

The thirteen conditions, asserted by name:

1. **Inside the brief** — yes. Six deviations, every one declared, and each
   inside a latitude the brief states: the module layout is "a defensible
   variant the builder states", `spell-resolution.ts`'s size is the exception
   the acceptance criterion names, and deviation 6 is the brief's own "Why now".
2. **Builder COMPLETE** — yes.
3. **Independent reviewer PASS, confidence high** — yes, at the confirmation
   pass on `4f829e9`, after four rounds and a fifth-round fix. Not before: the
   foreman did not merge on three `DEFECTS` verdicts, and did not supply the
   PASS itself.
4. **Defects resolved** — yes; the last one was the orphaned paragraph and the
   reviewer confirmed both that it moved and that it now reads correctly.
5. **Gauntlet in the worktree** — typecheck ✓ lint ✓ test 5508/5508 ✓ coverage
   ✓ `git diff --exit-code COVERAGE.md` ✓.
6. **Conformance** — `COVERAGE.md` regenerated byte-clean; no definition
   semantics touched.
7. **No unresolved architecture blocker** — nothing reached
   `ARCHITECTURE_BLOCKED`. The three-round exhaustion was judged procedural on
   the evidence above rather than escalated to Fable, which is the judgement
   recorded in the risk gate and the one thing here a later session should be
   able to disagree with.
8. **No material deviation** — six declared, all inside stated latitude, each
   weighed in the risk gate.
9. **No unexpected authority-boundary or foundational-state change** — the
   command layer moved wholesale, which the brief ordered; `events.ts`, the
   reducer, the fold and persistence are unchanged in behaviour, established
   declaration by declaration and by two byte-identical frozen logs. The
   surface widening is inspected above and confers no authority.
10. **No meaningful scope expansion** — the files outside the surface are the
    five named in the digest, each with a reason the brief anticipated or the
    move forced.
11. **No non-mechanical merge conflict** — none; both rebases were clean.
12. **Integration did not invalidate the review** — the reviewed commit and the
    merged commit have byte-identical `packages/` and `tools/` trees, and the
    full gauntlet was re-run on `main` after the fast-forward: typecheck ✓
    lint ✓ test 5508/5508 ✓ coverage byte-clean ✓, both fixtures untouched.
13. **Risk gate** — GREEN, above.

Verified on `main` at `4f829e9` and pushed to `origin/main`.

**One debt discharged in the merge commit's own bookkeeping**, because only the
foreman may: `docs/dev/WORKFLOW.md`'s "Parallel safety" section named the
command layer as a single indivisible primitive, and this task's `CLAUDE.md`
bullet now permits two mechanism tasks in different command domains to run
concurrently. The two disagreed. `WORKFLOW.md` is reconciled — and with a
sharper claim than the bullet makes, because concurrency across domains is not
free: two such tasks still both touch `commands.ts`, the barrel, whenever
either adds or removes a command, which is a mechanical conflict of the
registry's kind rather than a licence to stop thinking about ordering.
