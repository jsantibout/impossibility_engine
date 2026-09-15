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
cover are declared pairwise; a rule that needs one asks for it.

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
A move of more than one space through a carried area must state its route
(`route_required`), so nothing is caught in a square nobody named.

## Movement and teleportation

`resolveMove` spends movement, provokes Opportunity Attacks from creatures
whose reach the mover leaves (reach read from the weapon in the content),
and holds the move open (`pendingMove`) until every reaction is answered.
`relocateCreature` is a teleport: a position change that spends nothing and
provokes nobody, but still raises the area entry a Web is owed. Mounting is
a position relation; the rider moves when the mount does.

## Combat

Initiative order, the action budget (action, bonus action, reaction,
movement) and turn advancement live in `combat.ts` and `commands/turns.ts`.
A creature may join a running order (`joinCombat`). Outside combat there is
no action economy to spend, and turn-anchored durations have no meaning, so a
command that needs a turn asks for one rather than inventing six seconds.
