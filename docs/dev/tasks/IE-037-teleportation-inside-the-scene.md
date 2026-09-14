# IE-037 — Teleportation inside the scene

state: OWNER_APPROVAL_REQUIRED
lane: mechanism
tranche: 5
parallel-safe: NO — a union task touching `spell-resolution.ts` and the movement surface; the tranche's tail, and deferrable
depends-on: IE-035
worker: none
approved: none
merge-approved: none

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

## Risk gate

## Architecture decision

## Merge record
