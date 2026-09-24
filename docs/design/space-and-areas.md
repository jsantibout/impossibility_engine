# Space, areas and the combat model

Read before changing `positioning.ts`, `combat.ts`, `commands/movement.ts`,
`commands/teleport.ts`, `commands/scene.ts`, `commands/targeting.ts`,
`fold/areas.ts` or `fold/scene.ts`.

## Positions are declared, never defaulted

A scene is a 5-foot cube lattice with landmarks. A creature's position is
one of three states: placed, declared absent, or **nobody has said** — and
the third is a `needs-context` request, never a default. Distance is
Chebyshev between creature volumes (a creature occupies its size in cubes),
so reach, range and area membership are all measured the same way. Sight and
cover are declared pairwise; a rule that needs one asks for it. A creature
may also **have a sense** — Darkvision, Blindsight, Tremorsense, Truesight,
the glossary's four — granted while a trait or a worn item says so and
consulted by the sight question when no declaration answers it: a declaration
wins, declared Total Cover silences the sense, and then a sight-sense whose
range covers the distance answers. Tremorsense is not among those, because
the glossary says it does not count as a form of sight.

## Areas

Six shapes (`SpellArea`): sphere, cylinder, cone, cube, line, emanation;
directional ones take an aim. An area's origin is a point (placed at the
cast), the caster (carried, moving with them), or an ongoing casting's own
point (Spiritual Weapon, Moonbeam: moved by a later activation). A spell has
an area *or* a target list, never both; `targetsWithin` is the third case,
named targets chosen from inside an area.

A **persistent area** catches creatures at the moments the spell prints
(`AreaTrigger`: start or end of turn, on entry, first-per-turn, on the area
moving onto a creature). The fold detects those moments off the **pinned**
record and raises an `owedAreaEffects` debt; `settleAreaEffects` rolls it.
A move of more than one space through a carried area is refused
`single_steps_required` and comes back as one 5-foot step at a time, so
nothing is caught in a square nobody named — and so no space is entered
before the last one is settled, because a creature the area Restrains stops
walking where it stood.

**Difficult Terrain is a declared fact about the lattice**, held beside
sight and cover: the table declares which ground is expensive, how expensive
(`costPerFoot`, because Plant Growth and Wall of Thorns print four feet per
foot where the glossary prints two), and which casting made it so — and the
engine computes which spaces the region covers, what a crossing costs, and
whether the patch is still there. A patch naming a casting lapses when the
casting does, derived at read time so there is no window in which the webs
are gone and the ground still costs double. Two overlapping patches do not
stack; the dearer governs, as overlapping cover does. A move whose cost the
path decides raises `route_required`, which is the other question rather than
the same one: it wants the spaces named, in order, in the command's own
`route` field, and one command answers it. **The same field answers the
glossary's "Moving around Other Creatures."** `canPassThrough` had encoded the
rule since positioning landed and nothing called it; `checkPassage` reads it
now against every space a stated route crosses — an ally, an Incapacitated
creature, a Tiny one, or one two sizes away may be passed, anybody else is
`blocked_by_creature` — and a move stating no route is asked `route_required`
only when every shortest path crosses somebody it may not pass. Forced
movement is exempt (a shove is not the creature's movement), and a side nobody
has declared is reported in `unverified` rather than ruled on. A `passage`
standing grant widens the size clause — SRD Halfling Nimbleness — summed and
floored at one size of difference, so no grant walks a creature through its
own twin. The carried area's is
`single_steps_required`, and no route will ever answer that one. Both carry
requests of kind `route`; the **code** is what says how to supply what is
missing, and `commands/command.ts` holds the pair with the rule that
separates them.

## Movement and teleportation

`resolveMove` spends movement, checks the passage of every space a route
crosses, provokes Opportunity Attacks from creatures whose reach the mover
leaves (reach read from the weapon in the content), and holds the move open
(`pendingMove`) until every reaction is answered.
`relocateCreature` is a teleport: a position change that spends nothing and
provokes nobody, but still raises the area entry a Web is owed. Mounting is
a position relation; the rider moves when the mount does.

**Forced movement is a rider on a settled outcome**, never a resolver of its
own: a `save` or an attack decides, and the movement is the consequence it
carries, so Heightened Spell's Disadvantage and Careful Spell's sparing reach
it without knowing it exists. Two performers — a **push** along the bearing
from the caster, SRD Thunderwave and Gust of Wind; and a **lift** straight up,
SRD Levitate, on the one axis a bearing cannot name. Neither spends a Speed,
charges Difficult Terrain or provokes anything, and neither refuses: a shove
into a wall or a lift into a ceiling is reported on the casting's `unverified`,
because by the time a rider runs the slot is spent.

A lift is the one movement a casting **keeps**. "Remains suspended there for
the duration" is not a Speed and not a movement mode — it is the elevation the
lattice already holds, plus a `GrantedLift` saying whose magic is holding the
creature there — so `flightLost`'s "held aloft by magic" clause finally has a
record, and a creature with no Fly Speed was never in that rule's way anyway.
SRD's other half is the one ending in this engine that undoes a position:
"the target floats gently to the ground if it is still aloft" is performed by
`releaseCasting` and `releaseOnTarget` off that grant, derived and written
nowhere, exactly as a deadline arriving and a broken Concentration are. It is
not a fall: nothing is declared, nothing is rolled and nobody lands Prone.

## Combat

Initiative order, the action budget (action, bonus action, reaction,
movement) and turn advancement live in `combat.ts` and `commands/turns.ts`.
A creature may join a running order (`joinCombat`). Outside combat there is
no action economy to spend, and turn-anchored durations have no meaning, so a
command that needs a turn asks for one rather than inventing six seconds.
