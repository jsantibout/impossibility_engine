# IE-005 — Split `commands.ts` by domain, behaviour-preserving

state: APPROVED_FOR_IMPLEMENTATION
lane: mechanism
tranche: 2
parallel-safe: NO beside any mechanism task; YES beside conformance and content, which do not touch the command layer
depends-on: IE-003
worker: none
approved: 2026-09-13 — "APPROVE TRANCHE 2"
merge-approved: none

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

(none yet)

## Architectural gate

(none yet)

## Merge record

(none yet)
