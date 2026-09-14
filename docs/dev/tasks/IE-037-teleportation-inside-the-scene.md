# IE-037 — Teleportation inside the scene

state: DONE
lane: mechanism
tranche: 5
parallel-safe: NO — a union task touching `spell-resolution.ts` and the movement surface; the tranche's tail, and deferrable
depends-on: IE-035
worker: none
approved: 2026-09-14 — "APPROVE TRANCHE 5"
merge-approved: 2026-09-14 — "APPROVE TRANCHE 5" (tranche 5 authority; 13/13 conditions green)

## Brief

### Objective

A `teleport` effect kind and a `relocateCreature` command: a position change
that spends no movement, provokes nothing, and is refused rather than guessed.

### Why now

`teleportation` blocks nine spells and finishes two — Dimension Door and Tree
Stride — and moves Misty Step from tracked to executed. `CLAUDE.md` records the
gap precisely and records that it was **misfiled** for a long time as "a
separate placement the caller makes", which reads as a division of labour and
is a hole: "No command teleports. `moveCreature` charges a movement budget and
`placeCreature` refuses a creature that already has a position, so a spell that
relocates somebody has nothing authoritative to call."

It is **the tail of the tranche**: last in the chain, and the task the foreman
defers on evidence if the window closes first.

### Current relevant architecture

- `moveCreature` in `commands/movement.ts` — charges movement, declares a move,
  provokes Opportunity Attacks.
- `placeCreature` in `positioning.ts` — refuses a creature that already has a
  position. "Placing is not relocating."
- `raiseAreaEntries` — fires on an authoritative position change, which is
  exactly the SRD's reading of arriving inside a Web.
- `sceneFor` is **duplicated privately** in `commands/movement.ts` and
  `commands/scene.ts`, prose included. IE-016's builder and reviewer both said
  a third copy is the moment to hoist it. **This is the third copy.**

### Required behaviour

SRD Misty Step: "Briefly surrounded by silvery mist, you teleport up to 30 feet
to an unoccupied space you can see."

SRD Dimension Door: "You teleport to a location within range. You arrive at
exactly the spot desired." And: "If you, the other creature, or both would
arrive in a space occupied by a creature or completely filled by one or more
objects, you and any creature traveling with you each take 4d6 Force damage,
and the teleportation fails."

1. A `teleport` effect kind, and a `relocateCreature` command that emits
   `creature-moved` with **no** `movement-spent`, **no** `pendingMove` and no
   Opportunity Attack.
2. Refuses an occupied destination, a destination outside the scene, and one
   beyond the range measured from the caster.
3. Sight is declared, per the existing three-valued discipline: unknown is a
   request, declared-unseen is a refusal.
4. **Area entry fires**, because the position changed.
5. **Hoist `sceneFor`** to one home and delete both copies.

### Architecture constraints

- **A destination outside the scene is a different thing and stays the DM's.**
  There is one scene, so Plane Shift and Word of Recall have no position to
  move anybody to. Do not model a second place.
- Dimension Door's companion creature and its 4d6-on-failure clause are
  **separate**: transcribe what fits and adjudicate the rest to a named shape
  rather than half-building it.
- No movement is spent and no budget is read. A teleport is not a move, and
  routing it through `moveCreature` would silently import Difficult Terrain,
  Opportunity Attacks, Grappled and Disengage — the reasoning `relocateOrigin`
  already records for a spell's point.

### Acceptance criteria

1. Misty Step becomes executed; Dimension Door and Tree Stride leave the
   undefined population.
2. A teleport into a Web raises the area entry; a teleport past an enemy
   provokes nothing and spends no movement — both driven.
3. An occupied destination, an out-of-scene destination and an out-of-range one
   are each refused, with nothing spent, and their codes pinned in
   `refusals.test.ts`.
4. An undeclared line of sight produces a **request**; a declared unseen
   produces a refusal.
5. `sceneFor` has one home; both private copies are gone.
6. `npm run coverage` run and committed; both frozen logs fold unchanged.

### Tests and conformance

The discriminating fixture is a scene barely larger than the spell's range —
the lesson the Spiritual Weapon scene test taught: in a 600-foot hall every
space past the wall is also past the range, so the scene check hides behind the
range check permanently.

### Dependencies

**IE-035.**

### Out of scope

A second scene or plane. Dimension Door's companion, unless it transcribes
cleanly. Any change to `moveCreature`.

### Known risks

This is the tranche's tail and may be deferred by the foreman on evidence, with
the reason recorded and reported at `TRANCHE_COMPLETE`. If deferred, the
`sceneFor` hoist goes with it — do not split it out as a consolation.


## Completion digest

Builder **COMPLETE**, reviewer **PASS at high confidence**, two rounds. Branch
`worktree-agent-ac3fdf6399f0ad81b`, commit `95b0805`, rebased to `062441c`.
Tests **7736 → 7812 on `main`**, 76 new across 116 files. Gauntlet green;
`COVERAGE.md` byte-clean, **executed 94 → 96, verified 72 → 74**.

Misty Step moves from tracked to executed; Dimension Door and Tree Stride leave
the undefined population.

**The discriminating fixture the brief demanded is the one that earned its
keep.** Disabling the scene check in `choosePoint` reddens **exactly the
40-foot-closet case and nothing else** — a room barely larger than a 30-foot
spell. In the 600-foot hall the range check answers first and the scene check
hides behind it permanently, which is the lesson this repository has now
recorded three times over three different guards.

**`sceneFor` has one home at last.** It existed identically in
`commands/scene.ts` and `commands/movement.ts`, prose included; IE-016's builder
and reviewer both said a third copy was the moment to hoist it, and this was the
third copy. Emptying the hoisted function now reddens the scene, movement **and**
teleport families together — the evidence that it is one function rather than
three that agreed.

**No new event type and no reducer branch.** `PendingCasting.teleportTo` is
optional and absent from every pre-existing log, so both frozen logs fold
unchanged and `persistence-2.test.ts`'s uncovered-type ledger needed no entry.
It is the **fourth member of an already-documented pattern** — `damageType`,
`unaffected`, `fought`, and now this.

The `teleportation` shape id is **retired with every claimant re-read
individually and three different destinations**, which is an honest three-way
split rather than a rename.

One literalism the reviewer raised and dismissed, correctly: criterion 3 asked
for the codes pinned "in `refusals.test.ts`" and they are pinned in
`teleport.test.ts` — which *is* the population `refusal-sweep.test.ts` reads,
and this repository's own note warns that demanding a second assertion for a
rule already pinned teaches people to write redundant tests. Satisfied in
substance.

Out-of-scope findings: `state.riding` is not cleared when a rider changes
position independently of their mount — true of `moveCreature` before this and
reachable the same way through `relocateCreature`; it is `positioning.ts`, which
the brief keeps out of scope. And `destination_required` now has three voices,
all meaning "name where it goes" — one rule rather than IE-029's conflation, but
worth a look if that code is audited.

## Risk gate

**Inspected.** Foundational primitives are touched, but narrowly and in
already-established shapes: one optional field on `PendingCasting`, one member
on the `SpellEffect` union, and the `sceneFor` hoist the brief asked for.
`positioning.ts`, `moveCreature`, the action economy, conditions, durations and
persistence are untouched.

I confirmed the hoist myself — `commands/command.ts` holds the only
`function sceneFor` in the command layer — and ran both frozen logs and
`scenario.test.ts` explicitly, 53 tests, as on every fold-adjacent merge this
tranche.

Classification: **GREEN**.

## Architecture decision

None. No Fable involvement.

## Merge record

Merged to `main` as `062441c`, fast-forward, pushed. Rebased by the foreman;
clean. **The last merge of tranche 5.**

`main` verified after the merge: typecheck ✓, lint ✓, **7812 tests across 116
files** ✓, both frozen logs and the scenario determinism explicitly ✓,
`COVERAGE.md` byte-clean ✓, tree clean.

Thirteen conditions: **1** inside the brief; **2** `COMPLETE`; **3** `PASS` at
high confidence; **4** defects resolved; **5** gauntlet green; **6**
conformance, with the retired shape's claimants re-read one at a time; **7** no
blocker; **8** no deviation; **9** the primitives are the brief's; **10** files
outside the surface are each compelled by a derived sweep that fails until the
new command and the new stated fact are accounted for; **11** clean rebase;
**12** re-verified on `main`; **13** risk gate inspected, GREEN.

**Wave 8 complete, and with it tranche 5.**
