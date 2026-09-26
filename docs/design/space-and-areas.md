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
named targets chosen from inside an area. **The one exception, ruled on
2026-09-26:** a definition may both keep a point and name a creature when its
area is a *place* perceived by that creature alone — SRD Phantasmal Force's
phantasm, set down beside the goblin whose mind it is in. `SpellArea.standsApart`
says the named target need not stand in the template: the template is where
the phantasm is and the target is who it is for, so the point is placed and
range-checked as any area is, the name is judged as any named target is, and
what reaches the creature later is the trigger's own `within` measured from
the point, narrowed to the pinned `singledOut` by `onlyTarget`. The validator
refuses the field without both of those clauses, which is what keeps it an
exception rather than a fourth case.

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

## The second place

The engine holds one scene, and a creature may be **elsewhere**: off the
lattice in a named kind of nowhere — `ethereal` (Blink, a Ghost's
Etherealness), `extradimensional` (Rope Trick, a familiar's pocket) or
`inside` another creature (a Giant Frog's Swallow) — with the space it left,
the clock, the source that sent it and the rule the way back is checked
against pinned on `CreatureState.elsewhere` when it goes
(`creature-sent-elsewhere`). While away it has no position: every ruler
refuses `not_here` — an `err`, because the fact is settled rather than
missing and no placement can answer it — it is caught by no area and no
aura, and it holds what the record hung under the record's source. A
swallowed creature is at no distance from its host and at none from anybody
else, which is what "Total Cover against effects outside the frog" means.
**The way back is stated, never invented**: `returnFromElsewhere` (and the
boundary, a summoner's recall, a printed line's second use) takes a space the
caller names and checks it against the pinned rule — within N feet of the
space left or the creature the rule names, unoccupied, seen where the book
says so — taking the single space that qualifies where nobody named one and
asking `return_space_required` otherwise. A creature stranded by a casting
that has ended is a debt the turn refuses to advance past, on
`strandedSummons`' pattern; a host's death lifts the Restrained in the fold
and leaves the exit to a command, because where the creature climbs out is a
choice.

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

**A move a stat block prints** is read into one of four records — `movesThen`
on a printed save (a leap onto or a charge through other creatures' spaces,
the save rolled once per creature entered), `jumps` (an allowance a Bonus
Action hangs until the turn ends), `dashes` (a granted move at a fraction of a
named Speed, provoking nothing where the line says so, spent by
`move.using_line`) and `treeStride` (a teleport between two declared Large
objects). **Two surcharges the glossary prints ride `wayOf`:** dragging a
grappled creature costs one extra foot per foot unless it is Tiny or two sizes
smaller (a trait may waive it), and a Prone creature crawls at the climb's
multiplier. **A grappler's move carries what it holds**
(`MoveCommand.carrying`): each held creature lands in a space adjacent to the
destination — stated, or the single qualifying one taken unasked — as forced
movement (no Opportunity Attack against the mover; a barrier stops the
passenger where it stood and the mover's move stands), and a creature attached
with `movesWithTarget` rides in the mover's space. A creature held *inside*
the mover is not charged the drag. Not yet: a passenger's own route is not
read, so Spike Growth cuts the mover and not what it carries.

**The ground's vocabulary is three fields, not one rate.** `costPerFoot` is the
rate, and where two patches overlap the dearer governs, as above. `damagePerFeet`
is ground that *cuts* — SRD Spike Growth's 2d4 for every five feet travelled —
and two cutting patches **each** cut: the glossary prints its non-cumulative
sentence about the rate and prints nothing at all about dice, so a rule that they
did not stack would be one the engine invented. `onlyTowards` narrows a rate to
the **step** rather than to the square — SRD Gust of Wind's "2 feet of movement
for every 1 foot it moves when moving closer to you" — so the patch charges a
step of a stated route only where that step ends nearer the region's origin
creature than it began, read against where that creature stands at the moment of
the step; a move inside one that states no route is asked for one, because two
endpoints do not say which way each step went. A casting lays all three the same
way, off the region its own area resolved, and a casting whose area **turns**
lays them again down the new bearing, because everything a re-aimed Line prints
turns with it.

## Combat

Initiative order, the action budget (action, bonus action, reaction,
movement) and turn advancement live in `combat.ts` and `commands/turns.ts`.
A creature may join a running order (`joinCombat`). Outside combat there is
no action economy to spend, and turn-anchored durations have no meaning, so a
command that needs a turn asks for one rather than inventing six seconds.
