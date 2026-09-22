# Light, obscurement and the sight question

Read before changing the sight half of `positioning.ts` (`sightBetween`,
`sensesReaching`), `canSee` / `canSomehowSee` / `sensesOf` in `standing.ts`,
`commands/scene.ts`, the Hide command in `commands/actions.ts`, or any
definition that prints Bright Light, Dim Light, Darkness or an obscured area.

**Status: ruled by the owner on 2026-09-21, all five decisions, as written.
Built as P3-S.** This note says what "it" is, what it deliberately is not, and
what it costs. The five decisions are at the end, now as rulings rather than
questions; a change to any of them is a change to this note first.

## What exists

Sight is a pairwise declared fact (`sight-declared`, three-valued: seen,
unseen, nobody has said). A creature may hold a sense — the glossary's four,
as `{ sense, feet }` — and `sightBetween` consults it only where nobody has
declared anything: self → declaration → declared Total Cover silences →
a sight-sense in range → `null`. Two questions sit on it: `canSee` (every
"a creature you can see") and `canSomehowSee` (Invisible's clause; Truesight
and Blindsight answer it, Darkvision does not — owner, 2026-09-20). The
engine holds no Bright, Dim or Darkness, which `senses.test.ts` says outright,
so Darkvision has never had the thing it is a rule *about*.

Difficult Terrain is the precedent this note generalises from: a **declared
patch on the lattice** — a region in the area vocabulary, a rate, and a
`source` naming the casting that made it, so the patch lapses when the
casting leaves `state.ongoing`, derived at read time (`DifficultPatch`,
`livePatches`). The table declares the ground it sees; a casting pins the
ground it makes. Light is the second consumer of exactly that shape.

## The choice

Three ways to give the engine light. Two are refused.

- **Derive it** from walls and sources: refused. That is the line
  `space-and-areas.md` draws — computing sight needs obstacle geometry, and
  that is where a rules engine becomes a VTT.
- **Declare it per creature** ("Dain is in darkness"): cheaper, and refused,
  because no casting can write it. Darkness would stay a handover, Daylight
  could never overlap it, and the ledger would not move.
- **Declare it on the lattice**, as Difficult Terrain is declared: the table
  names the ambient light and the patches it sees; a casting pins its own
  patch with its `source`. **This is the choice.** One precedent with the
  lifecycle, the geometry vocabulary, the overlap rule and the DM tool already
  built; the sight question gains one step.

## The vocabulary — rules, not catalogue

Three light levels — `bright`, `dim`, `darkness` — and two degrees of
obscurement — `lightly`, `heavily` — are the rules glossary's words, held in
the engine as the fifteen conditions and four senses are. Which spell sheds
what, and how far, is content and is pinned on the cast event exactly as an
area is. The glossary's own mapping is a rule: Dim Light is Lightly
Obscured; Darkness is Heavily Obscured. Sunlight is Bright Light with a flag
(`sunlight: true`), not a fourth level, because the SRD's only use of the
distinction is Sunlight Sensitivity and the vampires.

Two records on `PositionState`, beside `terrain`:

- `light: Record<name, LightPatch>` — `{ region, level, source?, magical?:
  { spellLevel }, sunlight? }`.
- `obscurement: Record<name, ObscuringPatch>` — `{ region, degree, source? }`.
  Fog Cloud, foliage, smoke: obscurement that is not a light level.

And one scene-wide fact, `ambient: LightLevel | null`, on `scene-set`. **Null
is "nobody has said."** An undeclared scene answers exactly as today.

Two events, `light-declared` and `obscurement-declared`, overwrite by name as
`difficult-terrain-declared` does; two DM-door tools, `declare_light` and
`declare_obscurement`; `set_scene` gains `light`. A definition writes
`sheds?: { bright: feet, dim: feet } | 'darkness'` and `obscures?: degree`,
with the area origins that already exist — a point, or carried by a
creature (`self`). Light on a carried torch is a patch carried by the
creature; Light on a thrown rock is a point the table re-declares when the
rock moves. A point is a point until a mechanic proves it needs more.

## The query

`lightAt(space)`: the strongest of the ambient and the patches over the
space, with one rule from the book — magical darkness is not lit by
nonmagical light. `obscurementAt(space)`: the greater of what was declared
and what the light level implies.

`sightBetween` gains one step, **between the declaration and the sense**:

1. a creature sees itself;
2. a declaration answers as declared — it still outranks everything;
3. declared Total Cover silences every sense and answers `null`;
4. **the obscurement at the target's space, read against the looker's
   senses**: Heavily Obscured answers `false` unless a sense of the looker
   defeats it — Blindsight and Truesight in range defeat any; Darkvision
   turns *nonmagical* darkness into dim, which is seen; Devil's Sight (a
   standing grant, `sees-through`) defeats magical darkness too; nothing but
   Blindsight and Truesight defeats fog. Lightly Obscured does not change the
   answer; it gives Disadvantage on a Perception check that relies on sight;
5. a sight-sense reaching → `true`;
6. `null` — homework, as now.

The SRD's sentence is about the *target's* space ("while trying to see
something in that area"), so a creature standing in darkness sees a lit
target perfectly, and the query reads the target's square, never the
looker's. `canSomehowSee` is the same function with the shorter list and is
untouched; the Invisible ruling stands.

Consumers, all through `canSee` and its table: targeting, teleport,
Opportunity Attacks, Dodge, the ranged-at-close-quarters clause; the Hide
command's `obscured` flag becomes derivable where a patch says so and stays
declarable where none does; Perception's `requiresSight`; Sunlight
Sensitivity as a `StandingRequirement` reading `lightAt` at the target's
space. Blinded itself changes nothing: a Blinded creature already fails sight.

## What it reaches

Darkness, Fog Cloud, Light, Daylight, Continual Flame, Dancing Lights,
Produce Flame's light, Faerie Fire's and Starry Wisp's dim light, Moonbeam's;
Sunlight Sensitivity on the Kobold, Specter, Wight and Wraith; Devil's
Sight; Sacred Weapon's light; the six Illumination traits, Shadow Stealth,
Sunlight Weakness and Vampire Spawn's Sunlight. Mirror Image, Blur and the
Darkvision spell are the attacker-side sense reading (P2-T16), not this.

## Not built, on purpose

Occlusion and walls; distance falloff; colour; fuel; what a creature *knows*
(state stays omniscient — a creature in the dark is a query-side projection
if it is ever needed); the Blinded condition applied by the fold to creatures
in darkness (sight is derived at the question, never written as a condition).
The Daylight-against-Darkness mutual dispel is a second step: on pinning a
patch, an overlapping opposite patch whose `source` casting is of level ≤ N
is ended through `endOngoingSpell`, which exists. Do it in P3-S if it is
cheap; it is not a prerequisite for anything above.

## What it costs

- **Replay.** Two new event types and two optional fields; no existing event
  changes shape; `ambient` absent folds to `null`. `persistence.test.ts` and
  `persistence-2.test.ts` fold byte-identically because no frozen log holds a
  patch, and `scenario.test.ts` is unchanged.
- **The content boundary.** Five glossary words live in the engine; every
  radius, level and spell level is content, pinned on the cast event by rule
  5. The sweep in `spell-schema.test.ts` is untouched: no spell id enters the
  engine.
- **Number-free model.** `declare_light` takes a level word and a region;
  `set_scene` a word. The radius is the room's, the class of number
  `declare_difficult_terrain` already takes on the DM's door.
- **Determinism.** Derived on every read, as `livePatches` is.
- **The tests that prove the cost was not paid**, to be written first: (1)
  nothing declared → `canSee` answers as today; (2) a dwarf thirty feet from
  an orc in declared nonmagical darkness sees her, in a Darkness casting does
  not, with Devil's Sight does, and with `declare_sight seen: true` does
  regardless; (3) a Rogue in a Fog Cloud Hides with no `obscured: true`; (4)
  a Darkness patch is gone the read after Concentration breaks; (5) the
  Kobold's Disadvantage bites only where the target stands in sunlight; (6)
  the two frozen fixtures.

## The five rulings (owner, 2026-09-21)

Put to the owner as questions at G1 and answered yes to all five, as written.

1. **Light on the lattice** (the third way), at the cost above.
2. **No default ambient.** An undeclared scene is undeclared, not bright.
   The cost is one field in Infinite Realms' scene setup (I-A4, code not
   model). The alternative — assume bright — is a silent default of a
   consequential fact, which the doctrine forbids.
3. Magical darkness defeats Darkvision and nonmagical light (the SRD's own
   sentence); Devil's Sight defeats it; nonmagical darkness is dim to
   Darkvision.
4. Sunlight is bright light with a flag.
5. The mutual dispel is in P3-S's scope or deferred; recommended in scope.
