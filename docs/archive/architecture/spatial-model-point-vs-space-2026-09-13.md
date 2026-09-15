# A coordinate says *where*, never *what*

Design note for the geometry correctness pass. Written before the code, as
`CLAUDE.md` asks.

## 1. What the engine does today

### The coordinate model

One type, `Point { x, y, z }`, in **feet**, `z` up from the floor. One lattice,
`CUBE = 5`. `snapPoint` rounds every coordinate the engine *keeps* onto that
lattice, so every stored coordinate is a multiple of 5. Distance is Chebyshev
between axis-aligned boxes, floored at 5 feet for anything not overlapping.

### What a coordinate means

**The minimum corner of the 5-foot space it names.** `boxOf` builds
`[at, at + width)`; `pointBox` builds `[p, p + 5)`. Numerically a coordinate is
a lattice corner; semantically it is the *space* hanging off that corner. It is
never a space centre, and it is never a free continuous point — except in two
places:

- transiently inside `project`, before `snapPoint`;
- `CastSpellRequest.at` and `.towards`, which `placeArea` uses **unsnapped**.

That second one is the first defect: an area origin can be off-lattice, and
`pointBox` will then build a space that is not on the lattice.

### Who consumes coordinates

| System | Reads a coordinate as | Metric |
|---|---|---|
| creature occupancy (`boxOf`, `occupied`) | a space (min corner) | box overlap |
| movement (`moveCreature`, `project`) | a space | Chebyshev |
| distance / reach (`distanceBetween`, `withinReach`) | a space | Chebyshev, box to box |
| forced movement | a space | as movement |
| landmarks, `sceneCenter` | a space | — |
| riding (`RIDER_ELEVATION`) | a space, +1 cube in z | — |
| Spiritual Weapon's kept origin (`placeOrigin`, `relocateOrigin`) | a space, snapped | Chebyshev, `pointBox` to `pointBox` |
| **AoE origin — sphere, cylinder** | a **space** (`pointBox(origin)`) | Chebyshev, box to box |
| **AoE origin — emanation from a creature** | the creature's **volume** | Chebyshev, box to box |
| **AoE origin — cone, line, cube** | that space's **centre** (`cubeCentre`) | Euclidean |
| **AoE direction (`towards`)** | that space's **centre** (`cubeCentre`) | Euclidean |
| AoE membership (target side) | every occupied space's **centre** | per shape |
| cover, line of sight | not geometric at all — declared, keyed `attacker>target` | — |

### Where `cubeCentre` is used, and whether it is consistent

Two call sites, and they agree **by accident of the call site, not by type**:

- `boxInShape`'s directional branch does `const from = cubeCentre(origin)` and
  passes that into `inShape` as its `origin` parameter;
- `inShape` itself does `cubeCentre(shape.towards)` on the other endpoint.

So the axis is `centre(towards) - centre(origin)`: the +2.5 cancels, the vector
is exact, and **there is no live half-cell skew today**. What is wrong is the
*signature*: `inShape`'s `origin` parameter is already a world point while its
`shape.towards` is still a space. One function, two conventions, held together
by there being exactly one caller. A second caller — or a second origin
convention, which is exactly what this pass introduces — turns that latent trap
into a live 2.5-foot-per-axis tilt, which at 5 feet is a 26 degree error.

`inShape` also carries dead `sphere` / `emanation` / `cylinder` branches that
`boxInShape` never reaches, computing those shapes in **Euclidean** distance
where the live code uses Chebyshev. Two metrics for one shape, one of them
unreachable.

### Which tests encode what

`positioning.test.ts` "areas of effect" (~lines 287-475) and "areas of effect
meet the whole creature" (~875-965) are the regression surface. Every one of
them asserts a *membership* outcome from a space origin. None asserts a
footprint width, and none names a tabletop convention. `spell-areas.test.ts`,
`area-triggers.test.ts`, `area-motion.test.ts` and `carrier-areas.test.ts`
drive the same geometry through castings.

So: **no existing test asserts the 9-space footprint as a convention.** They
assert membership from a space origin, which is unchanged by this pass.

## 2. The 20-foot case, resolved deliberately

SRD 5.2.1's "Playing on a Grid" sidebar (`playing-the-game.md:919-931`) gives
rules for squares, Speed, entering a square, corners and *ranges*. **It gives
no rule for areas of effect on a grid.** The glossary defines a Sphere as a
radius in feet from a point of origin and stops there. The 8x8 footprint is a
2014 DMG optional rule ("choose an intersection"), not SRD 5.2.1 text.

So neither footprint is mandated, and the engine must not silently pick one
while the documentation claims the other. Today:

- origin on a **space**, radius 20 → spaces at offsets -20…+20 → **9 spaces,
  45 feet across**;
- `CLAUDE.md` claims "every cube within 20 feet of a point forms a 40-foot
  square". That sentence is **wrong about the code** and is corrected by this
  pass.

The 40-foot footprint is not a different sphere. It is the **same** sphere with
its origin at a grid **intersection**:

| Origin | Space centres at | Within 20 (Chebyshev) | Footprint |
|---|---|---|---|
| a space | `0, ±5, ±10, ±15, ±20` | 9 | 45 ft, odd |
| an intersection | `±2.5, ±7.5, ±12.5, ±17.5, ±22.5` | 8 | **40 ft, even** |

And the same lever settles every other shape, with no spell named anywhere:

| Template | Space origin | Intersection origin | Wants |
|---|---|---|---|
| Sphere r=20 | 9 across | **8** | intersection |
| Cube 20 ft | 5 deep x 5 wide | **4 x 4** | intersection |
| Line 5 ft wide | **1 wide** | 2 | space |
| Line 10 ft wide | 3 wide | **2** | intersection |

The rule that falls out is the tabletop rule of thumb, and it is a *consequence*
rather than a special case: **an even-space footprint wants an intersection
origin; an odd-space footprint wants a space origin.** The engine does not choose. The
caster does, and the engine records which was chosen.

## 3. The representation change

**Principle: a `Point` says *where*. What it denotes is said by the thing that
holds it, never inferred from the numbers.** A lattice corner and a space's
minimum corner are the same three numbers; that is the whole conflation, and one
bit of information at the origin is the whole fix.

Creature positions stay spaces and stay integral. Nothing becomes continuous.

```ts
/** Which convention a coordinate is read under. */
export type PointAnchoring = 'space' | 'intersection';

/**
 * Where a geometric origin or target sits.
 *  - `space`  — the 5-foot space with this minimum corner; geometrically its centre.
 *  - `intersection` — the vertical edge four spaces share, taken at the
 *      mid-height of the space named.
 */
export type AreaPoint =
  | { readonly space: Point }
  | { readonly intersection: Point };

export type AreaOrigin = AreaPoint | { readonly creature: CharacterId };
//  AreaShape.towards: AreaPoint
```

One conversion, `worldPointOf`, snaps and resolves either to a true world point.
**Every** geometric predicate then consumes world points only — origin, target
and sampled space centres in the same frame, by construction rather than by call
site.

### Why this is behaviour-preserving for every space origin

For an origin on a space, `chebyshev(pointBox(o), box)` equals
`min over the box's space centres of max(|dx|, |dy|, |dz|)` from that space's
centre. Per axis, with both spans lattice-aligned: touching spans give 0 by both
(overlap) or 5 by both (adjacent), and a gap of `g > 0` gives `g + 5` by both.
The box is a product of intervals and Chebyshev is a max, so the per-axis minima
compose. The two are the same number, for every case that can arise from snapped
state.

The cylinder's vertical test is the same argument: for a span and a height that
are both multiples of 5, "the creature's z-span overlaps `[oz, oz+h)`" and "some
space centre of the creature lies in `[oz, oz+h]`" are the same statement.

So the radial shapes move from box-Chebyshev to centre-Chebyshev **with no
change in output**, and the corner origin then falls out of the same arithmetic.

### Smallest coherent change

1. `positioning.ts` — add `PointAnchoring`, `AreaPoint`, `worldPointOf`;
   `AreaOrigin`'s `{ point }` member becomes `{ space }`; `AreaShape.towards`
   becomes an `AreaPoint`; `boxInShape` and `inShape` take resolved world points;
   the dead Euclidean branches in `inShape` go.
2. `commands.ts` — `CastSpellRequest.anchoring?: PointAnchoring` (default
   `'space'`), refused for a `self`-origin area the way `at` already is. One
   anchoring for the whole template, so origin and direction are always in the
   same frame and cannot skew against each other. Threaded into `placeArea` and
   into the `area` payload.
3. `events.ts` / `spells.ts` — `anchoring?: PointAnchoring` on `spell-declared`'s
   `area` payload and on `OngoingSpell`. **Optional, absent meaning `'space'`**,
   so every log written before this folds byte-identically. `golden-log.json`
   contains no area casting at all.

### Affected modules and tests

`positioning.ts`, `commands.ts`, `events.ts`, `spells.ts`.
Tests: `positioning.test.ts` (23 `{ point: … }` → `{ space: … }`, 4 `towards:`),
`area-motion.test.ts`, `carrier-areas.test.ts` (2 each), plus whatever the
typecheck finds. All mechanical renames; **no expected value changes.**

### Behaviour changes, stated

1. An area origin is now **snapped** (`placeArea` used `request.at` raw). An
   off-lattice origin previously built a space that was not on the lattice.
2. An intersection origin is newly expressible. Nothing chooses one by default, so no
   existing casting changes.
3. Dead Euclidean branches removed — unreachable, so no behaviour.
4. Everything else — movement, occupancy, reach, forced movement, mounting,
   cover, sight, replay — is untouched.

### Migration risk

Low, and bounded. The risk a point/space distinction would normally carry is a
*brand* on `Point` rippling through positions, landmarks, placements, movement
and events. This pass deliberately does not do that: `Point` stays structural
and creature positions keep their existing meaning, which is already coherent
and already documented. The distinction is introduced **only where the
conflation causes a wrong answer** — the origin and direction of an area of
effect. Everything the doctrine calls authoritative keeps its shape.

### What is deliberately deferred

- No spell definition is migrated. Fireball still defaults to a space origin and
  still catches 9 spaces unless the caster says `corner`. Choosing per spell is
  definitions work.
- A directional area from a **creature** origin still starts at that creature's
  *anchor* space centre, so a Huge dragon's Cone starts at a corner of its body.
  Existing behaviour, unchanged here.
- Cover and line of sight stay declared. Point-origin cover (audit item 18)
  stays open.
- Walls, multi-area templates, and a non-axis-aligned aiming frame stay out.

## 4. What the implementation changed about this note

Three things the analysis above did not anticipate, all found by writing the
code and the tests rather than by reading.

**`corner` became `intersection`, and it is horizontal.** A true
three-dimensional corner at `z = 0` is the *floor plane*, and every creature
standing on that floor has its space centre 2.5 feet above it. For a Sphere
that is invisible (2.5 against a radius of 20). For a **5-foot-wide Line** it
is fatal: the Euclidean perpendicular is already 2.5 feet before any horizontal
offset, so the template caught nothing at all. The convention being
transcribed is about squares on a map — the 2014 rule says "choose an
intersection of squares" — and nothing in the SRD gives a vertical stack an
intersection. So it resolves to the vertical edge four spaces share, at the
mid-height of the space the coordinate names: different in x and y, identical
in z. A genuine 3D corner is a third member if a rule ever asks for one.

**A Cylinder's height is a plane, not a point.** Centring the origin in z moved
the base 2.5 feet up, which put a bat perched at 10 feet inside a 10-foot-high
Cylinder standing on the floor. SRD locates a Cylinder's origin "at the center
of the circular top or bottom" — horizontally central, vertically on a *face* —
so `boxInShape` takes the origin's lattice coordinate alongside the world point
and reads the height from the plane. That is the one rule in the module that
wants the lattice rather than the geometry, and it is now the only one.

**`space` is the absence, not a value.** `placeArea` originally stored whatever
the caller passed, so a casting that said `anchoring: 'space'` serialised
differently from one that said nothing while meaning the same thing. It is now
normalised away at the point the record is built, and a test folds both and
compares the bytes.

Everything else landed as written. The whole suite passed unchanged at every
step, which is the evidence for the behaviour-preservation argument in §3:
4302 existing tests, no expected value edited, 20 new ones added.
