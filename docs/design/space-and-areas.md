# Space, positioning, areas of effect, and teleportation

The lattice, Chebyshev distance, creature volume, the six area shapes, persistent and carried areas, and teleportation. **Read this before changing positioning, areas of effect, movement geometry, or the combat model.**

> **Authority.** This document is authoritative for its subject. It was
> extracted verbatim from `CLAUDE.md` when that file became the
> constitution and router; the sentences below are the repository's own
> reasoning, unchanged. `docs/IMPOSSIBILITY_ENGINE_DOCTRINE.md` outranks it,
> and `CLAUDE.md` outranks it on anything it still states directly.

---
## Positioning: Coordinates, Authored But Never Defaulted

Positions are real coordinates, so distance is subtraction and area of effect
is an exact point-in-shape test.

**"Refuse, don't guess" does not apply here.** That rule governs things with a
right answer — dice, damage, save DCs — where a guess is simply wrong. Where
the ogre is standing has no right answer until someone decides. A DM asked how
far away it is says "about thirty feet" instantly; inventing a reasonable
position *is the job*, not a failure of rigour.

The competitor bug behind this design — a monster described as appearing in a
tavern, then reported 1000 feet away — was **not** caused by inventing a
position. It was caused by a position appearing that **nobody chose** and that
**contradicted the narration**. The failure is incoherence, not invention.

So the guards are about coherence, not permission:

- **No silent defaults.** `position` is `Point | null`; null is a normal state.
  There is no origin and no fallback coordinate. A position exists only because
  something deliberately placed it, and that act is recorded.
- **Placement is always relative to something established** ("beside the
  fighter", "20 feet from the bar"). The model never types raw coordinates, so
  a placement cannot drift away from what was just narrated.
- **Once placed, binding.** A creature does not relocate between turns without
  movement being spent; a contradiction is caught rather than absorbed.
- **Scenes declare their extent.** A 60x40 tavern cannot contain a 1000-foot
  gap.

**An unplaced creature is an engine-to-model signal, never player-facing.** The
engine tells Maestro the ogre has no position; Maestro places it and continues.
The player sees "the ogre lurches out from behind the bar" and never learns a
round trip happened. Nothing here should ever surface as "sorry, that creature
has no position".

**Areas of effect are exact.** All six SRD shapes are geometric tests, and two
details are easy to lose: a **Sphere and Cylinder include their point of
origin** while a **Cone, Cube, Line and Emanation do not** (unless the caster
says otherwise), and a **Cone's width at any distance equals that distance** —
so its radius there is half of it, not the full width.

**Sharing a space has three separate rules with three different exception
lists**, and conflating them is the easy mistake:

| Rule | Exceptions |
|---|---|
| May pass through | ally, Incapacitated, Tiny (either party), two sizes apart |
| Costs Difficult Terrain | *not* ally, *not* Tiny — an Incapacitated ogre is passable but still costly |
| Prone on ending there | Tiny, or larger than the occupant |

Ending a move in an occupied space is forbidden only when *willing*, so forced
movement passes `forced: true` and the result reports who is being shared with
and whether the mover is Prone. Applying the condition is the caller's job.

Passing *through* is exposed as a predicate rather than derived, because there
are no waypoints to trace — same reasoning as cover.

**Everything is on a lattice of 5-foot cubes, and distance is Chebyshev.**
SRD: "Each square represents 5 feet", and entering a *diagonally* adjacent
square costs the same one square as an orthogonal one. So a diagonal neighbour
is 5 feet away, not 7.07, every distance is an integer multiple of 5, and
nobody ever hears "seven and a half feet". The lattice is an internal
representation — nothing is rendered, and Maestro still speaks in feet from
landmarks.

**Placement uses the same metric as measurement.** Projecting a bearing
trigonometrically and then measuring the result with Chebyshev made the two
disagree: a creature asked for at 30 feet on a diagonal landed 20 feet away by
the engine's own ruler. `project` normalises the direction by its Chebyshev
norm, so the dominant axis carries the full distance and a diagonal at 30 feet
offsets (30, 30).

**Occupancy is tested by volume, not by anchor.** Comparing anchor cubes let a
Medium creature be placed *inside* a Large one simply by having a different
anchor, while ranges were already measured between volumes. Both now ask the
same question.

**Placing is not relocating.** `placeCreature` refuses a creature that already
has a position — that is what `moveCreature` is for, and movement is spent.
Otherwise a stray placement teleports something mid-combat.

**One metric, used everywhere — so a radius is a square.** That is not a
simplification, it is what Chebyshev means. Measuring areas geometrically while
measuring distance by the grid would let a creature be 20 feet from a blast by
one rule and outside its 20-foot radius by another. Two metrics is how a system
ends up contradicting itself. Cone, Line and Cube are directional, have no
Chebyshev shorthand, and are the one approximation here: they resolve against
cube centres.

**How wide that square is depends on where the origin sits, and the engine will
not choose for you.** An earlier version of this line claimed a 20-foot radius
formed a 40-foot square; it forms a *45*-foot one, nine cubes across, because
the origin was always read as a cube. That is not a bug — it is one of two
right answers, and the code was silently picking one while this file described
the other.

A coordinate cannot say which it is: the lattice corner and the cube's minimum
corner are the same three numbers. So the *thing holding* the coordinate says,
and `AreaPoint` is that one bit:

| | Resolves to | A 20-foot radius | A 5-foot-wide Line |
|---|---|---|---|
| `{ space: p }` | the cube's centre | 9 cubes, 45 feet | 1 cube wide |
| `{ intersection: p }` | the edge four cubes share | **8 cubes, 40 feet** | 2 cubes wide |

The rule that falls out is general and names no spell: **an even-cube footprint
wants an intersection, an odd-cube footprint wants a cube.** SRD 5.2.1 mandates
neither — its "Playing on a Grid" sidebar covers squares, Speed, entering a
square, corners and ranges and says nothing whatever about areas of effect, and
the intersection convention comes from a 2014 optional rule. So `space` is the
default because that is what every casting already meant, `CastSpellRequest`
carries `anchoring` for a caster who wants the other, and `OngoingSpell` keeps
it so a Web catches the same creatures an hour later that it caught at the cast.
Absent means `space`, which is why every log written before this folds
unchanged.

**An intersection is horizontal, deliberately.** It is the vertical edge four
cubes share, taken at the mid-height of the cube the coordinate names. The
convention it transcribes is about squares on a map, and nothing gives a
vertical stack an intersection. Reading the `z` as a floor *plane* instead
would drop every origin half a cube below every creature standing on that
floor — which for a 5-foot-wide Line is the whole of its half-width. A
three-dimensional corner is a third member if a rule ever asks for one; none
does.

**Both ends of a directional template are read in one frame.** `inShape` used
to take an origin its one caller had already centred and a `towards` it centred
itself — correct, and correct only because there was exactly one caller. The
moment a second origin convention existed that became a 2.5-foot-per-axis tilt,
which at five feet is 26 degrees. Both endpoints are now resolved by the same
function before any predicate sees them, and `placeArea` reads a single
anchoring for the whole shape, so the axis is always the difference of two
coordinates written the same way.

**The radial shapes measure to cube centres, and that changed no answer.** For
an origin on a cube, "Chebyshev from that cube's centre to the nearest centre
of the target's volume" and the old box-to-box Chebyshev are the same number:
touching spans give 0 by both, adjacent spans 5, a gap of `g` gives `g + 5`. A
box is a product of intervals and Chebyshev is a max, so the per-axis minima
compose. The whole suite passes unchanged, which is the evidence.

A Cylinder is the exception that proves the origin is not simply a point: SRD
puts its origin "at the center of the circular top or bottom" — horizontally
central, vertically on a **face**. So its height is measured from the lattice
plane the origin sits on, never from a cube's mid-height, which would leave a
40-foot Cylinder straddling cube boundaries and covering seven of them.

**An Emanation radiates from the creature, not from a point inside it.** SRD:
it "extends in straight lines from a creature or an object in all directions",
so it starts at the boundary — a 10-foot Emanation around a Gargantuan creature
covers vastly more ground than one around a Medium, and is not skewed toward
the corner cube the creature is anchored at. A Sphere is the opposite: centred
on a *point*, so a large caster standing at that point does not widen it.

**Creatures occupy volume, not a point.** A footprint from the SRD's Creature
Size and Space table, rising from the feet to a height. Treating them as points
made a tall creature mechanically flat — a blast at head height missed it
entirely — and put a Huge creature's only point seven feet inside its own body,
out of a fighter's reach. Creatures are anchored at a cube and extend from it — centring a Large creature
would put its edges on half cubes, which the game has no notion of.

**Nothing is ever measured centre to centre.** SRD: "count squares from a
square adjacent to one of them and stop counting in the space of the other
one." There is exactly one distance function and it counts cubes between
volumes.

**Height is declared, never inferred.** The SRD gives every creature a space
but never a height, and size category is a poor proxy — a giraffe and a
hippopotamus are both Large. Height is fiction, so Maestro says. The footprint
fallback exists so the geometry keeps working when nobody has said; it is not a
claim the engine knows how tall anything is, and `isHeightDeclared`
distinguishes the two so a tool surface can ask when it would change the answer.

Sphere, Emanation and Cylinder test the box exactly. Cone, Line and Cube are
directional with no closed form, so they sample the box's corners and centre —
documented as an approximation rather than dressed up as exact.

**Riding is a relationship, not an offset.** SRD Mounted Combat covers a
*willing* creature at least one size larger, within 5 feet, at half the rider's
Speed. It says nothing about leaping onto a hostile dragon, which is among the
most-attempted moves at any table — so that is permitted and recorded as
`willing: false` rather than refused. Whether the character got up there is a
check the DM calls for; the engine only tracks that they did.

The rider sits **one foot** above the mount, not at a size-derived height.
Realism would put a rogue 15 feet up a Huge dragon and thereby stop them
meleeing the dragon they are clinging to, which destroys the entire point. How
high it looks is narration. What the small offset buys: not sharing a space (so
nothing knocks them Prone), staying in reach of the mount, and travelling with
it when it moves or flies.

**Cover and line of sight stay declared, not ray-cast.** Computing them from
geometry means modelling walls, pillars and doorways as obstacles, and that is
where a rules engine becomes a VTT. The model says "behind the bar,
three-quarters cover"; the engine applies exactly +5 AC and +5 to Dexterity
saves. Exactness where it is cheap, judgement where geometry is expensive.

## A Teleport Is A Position Change And Not A Move

This file said *"No command teleports"* for as long as the tracked bucket has
existed, and that is the longest-standing instance of its most persistent
finding: `moveCreature` charges a budget and `placeCreature` refuses a creature
that already has a position, so a spell that relocates somebody had nothing
authoritative to call. Misty Step's thirty feet, its unoccupied space and its
line of sight all went unchecked. `relocateCreature` in `commands/teleport.ts`
is the command, and the `teleport` effect kind is what a spell reaches it
through.

**What it is not comes from the SRD rather than from taste.** None of Speed,
Difficult Terrain, Opportunity Attacks, Disengage or Grappled applies, because
the book applies none of them to a teleport: an Opportunity Attack is offered
only when a creature "leaves your reach using its action, its Bonus Action, its
Reaction, or **one of its speeds**", and Misty Step is none of those. That is
the reasoning `relocateOrigin` already records for a spell's point, and it is
why this is its own command rather than a flag on `resolveMove` — routing it
through that one would import every one of those rules silently.

**What it *is* is an authoritative position change, so it writes the same
`creature-moved` a walk writes.** Every consequence the reducer derives from
one then follows for free, and the one that matters is the area entry:
`raiseAreaEntries` fires on the position having changed and does not ask how,
which is the SRD's reading of arriving inside a Web. **No new event type and no
flag on the old one** — the event already means "this creature's authoritative
position changed", and a field nothing branches on is the speculative member
the format's own sweeps exist to refuse. `forced` is a field because the
*reducer* branches on it, to permit an occupied space; a teleport asks for no
such permission, since SRD Misty Step names "an unoccupied space" and Dimension
Door's own answer to an occupied one is 4d6 Force damage.

**A teleport crosses nothing, so it is never asked for a route.** `moveWithin`
asks a carrier of an Emanation which spaces it passed through, because two
points do not imply the line between them — and a teleport has no line at all.
Whoever is standing at the destination is caught by the carrier arriving;
nobody in between is, because the area was never in between.

**It is guarded by `mayAct` and it is not a spender**, which is the one
combination worth stating rather than leaving to be inferred. It takes no
Action, Bonus Action, Reaction, movement or pool use, so the action-economy
sweep never classifies it and no exemption list has anything to say about it —
and it is guarded anyway, because it *raises* area debts. It refuses a pending
move and a held attack for the same reason `resolveMove` does — both are about
a **position** rather than about an economy neither of them spends, and a
teleport out from under a declared move is a relocation `completeIfSettled`
would silently undo. Two operations that both move a creature must not
disagree about whether the world has to be settled first, and saying so is not
enough: an independent review found them disagreeing while the sentence stood.

### Where it goes is the caster's, and it is stated or refused

`CastSpellRequest.teleportTo` is an ordinary `Placement` — measured from a
landmark, a creature or a point already established, because the model never
types raw coordinates — and it is **the fourth fact a casting states rather
than derives**, in exactly the shape of the other three: required by a spell
that teleports (`destination_required`), refused for one that does not
(`no_teleport_clause`), and both before a slot is spent. The engine validates
the destination and never chooses one, which is the boundary `eligibleTargets`
draws for targeting.

**It is pinned on a declaration**, beside the targets, the origin and the
damage type, because settlement takes no fresh request: a Dimension Door
declared at the far end of the hall must not settle beside its caster.

**And it has one home in the definition**, which `checkTeleportPlacement`
enforces: a `teleport` written in an area trigger's effect list or an
activation's would fire off an `OngoingSpell` that carries no destination, so
it is refused at authoring — the rule `advantageIfFought` already obeys, for
the same reason.

### Sight is declared, and a destination is a coordinate

SRD Misty Step prints "an unoccupied space **you can see**"; SRD Dimension Door
prints the opposite in as many words — "a place you can see, one you can
visualize, or one you can describe by stating distance and direction" — so
`requiresSight` is a per-effect clause rather than a property of teleporting.

What the engine can read is the **anchor** the placement is measured from:
"beside the ogre" is a space the teleporter can see if they can see the ogre,
and that is a pairwise declaration. Anchored on a landmark or a bare point
there is none, and nothing it could read instead — the gap this file already
records for Arcane Sword's "a spot you can see" — so the clause goes unchecked
and says so in `unverified` rather than passing silently. Three values, and the
third written down.

**`teleportTo` is its own pre-flight, and that is what makes a declared
casting able to settle.** `castOrRelease` runs it over every target with the
targets settled and **before the slot, the action and the first die**,
discarding the events — it is pure and rolls nothing, so asking twice costs a
caller nothing and asking *once* would cost them the action. SRD Counterspell
makes that action "wasted" whatever follows, so a Misty Step declared at a
space 120 feet away would spend it and then fail at every settlement for ever,
with `resolveTurn` refusing `casting_pending` behind it. Every refusal the
resolver can give is therefore reachable before anything is spent: the
distance, the occupied space, the scene's extent and the declared sight alike.
A pre-flight over the sight alone would have left the other three at the
settlement, which is the defect an independent review caught. The caveat is
`creatureTypeNeeds`' own — the pre-flight reads the world as it stands rather
than the world the casting's earlier effects leave, and no definition puts a
teleport behind one.

### Two spells, and the one that is honestly partial

Misty Step is executed and verified; every clause of its one sentence is a rule
the engine now owns. Dimension Door executes its first paragraph and carries
two clauses it does not finish, each filed under a shape that already existed:
the **willing creature** who comes along arrives "within 5 feet of your
destination space", which is a second destination for a second creature where a
casting applies one effect list to every target; and the **4d6 Force damage**
on a failed arrival is damage with neither an attack roll nor a save. The
engine refuses an occupied destination before the slot is spent, which is the
validate-before-rolling discipline and is *not* what the book does — SRD spends
the slot and hurts everybody travelling.

**Tree Stride is tracked, and teleportation was never what blocked it.** Every
clause of its ability hangs on being *inside a tree* — a state the world model
has no room for, the same place Meld into Stone's whole paragraph hangs from —
and the relocation it performs is one the SRD charges 5 feet of movement for,
which is the opposite of what a teleport costs.

### The shape was retired, and the six left over were never blocked on it

`teleportation` blocked eight spells in `missing-shapes.ts` and finished two,
so re-reading the other six is the content work that map insists on when a
shape is built — and **not one of them turned out to be blocked on a teleport
the engine could perform**:

| | |
|---|---|
| Forbiddance, Magic Circle, Hallow | print a ward that **stops** a teleport — "creatures can't teleport into the area" — which is an area that suppresses magic rather than one that performs it |
| Teleport, Teleportation Circle | send the party to a destination "on the same plane" and off the scene entirely, which is `a-second-place-to-put-a-creature`; one of the two had never recorded it |
| Blink | returns its caster "to an unoccupied space of your choice ... within 10 feet", which this build performs; what is left is the Ethereal Plane and a 1d6 |

So the id has no claimants and is gone, which is the third time a build has
retired one. It is IE-017's lesson from the other direction: a count is only as
good as the shape it counts, and building one is how anybody finds out.

### `sceneFor` has one home, because a third copy arrived

It was written privately in `commands/scene.ts` and copied whole into
`commands/movement.ts`, prose included; IE-016's builder and its reviewer both
recorded that a third copy would be the moment to hoist it. It is in
`commands/command.ts` now, beside the two creature readers and for their
reason: it is a question every domain that is about a *place* has to ask, and
answering it in any one of them would make that domain a dependency of the
others. The evidence that it is one helper and not three spelled alike is a
mutation — emptying it reddens the scene family, the movement family and the
teleport family together.

## A Persistent Area Catches You At A Moment The Spell Names

Twenty-odd SRD spells fill a patch of ground and then go on doing something to
whoever is standing in it. A taxonomy audit read them all and found that
"an area trigger" is **not one mechanic** — it is at least eight, and this
builds two of them:

| | SRD wording | Detected at |
|---|---|---|
| **A turn boundary** | "starts its turn there" / "ends its turn there" | `turn-advanced` |
| **Entering** | "enters the area" | the creature's own authoritative position change |

An area that *moves onto* a creature is a third, and is built — see "An Area
Can Arrive At A Creature Standing Still". Everything else the audit named is
still out: a path or a distance travelled, an aura the holder carries, an
activation that blasts a point, a barrier. Each is a different detection with
different evidence, and one generic "trigger system" would have been a
framework built from one example.

### The clauses are transcribed, not taxonomised

`AreaTrigger` has three fields and each is one sentence out of the book. The
three frequency behaviours everyone talks about fall out of the combinations
rather than being an enum somebody invented:

| Spell | `at` | `onEntry` | `oncePerTurn` | Comes to |
|---|---|---|---|---|
| Insect Plague | end | first-per-turn | **yes** | one save a turn, whichever clause reached them |
| Web | **start** | first-per-turn | — | the entry is capped; the boundary is not |
| Grease | end | every-entry | — | nothing is capped at all |
| Black Tentacles | end | every-entry | **yes** | one save a turn |
| Stinking Cloud | **start** | *(none)* | — | the boundary and nothing else |

**Stinking Cloud is the one that writes a single clause**, which is what makes
it the floor of the table rather than a fifth variation: "Each creature that
starts its turn in the Sphere" is the whole of it, so `onEntry` and
`oncePerTurn` are both absent and walking into the gas costs nothing until your
own turn comes round. A neighbouring cloud must not lend it either field, and
the guard that says so is the prose check below rather than this row.

**Web against Insect Plague is the pair that proves the difference is real.**
"The first time a creature enters the webs on a turn **or** starts its turn
there" caps the *entering*; a creature that began its turn in the webs has not
entered, so tearing free and walking back in is still that turn's first entry
and saves again. Insect Plague's "a creature makes this save **only once per
turn**" caps the *creature*. One per-turn stamp serving both would be Insect
Plague's rule wearing Web's name, and every single-spell fixture passes under
either reading.

**A cloud next door must not lend a spell a clause it does not print.** The
guard is not a comment: each definition's own SRD prose is read out of the
parsed book and the three fields are held against it, the same technique
`spell-tracking.test.ts` uses. Stinking Cloud names no entry clause; nothing
can quietly give it one.

### The debt is not a `PendingSave`, and the difference is the rule

`OwedAreaEffect` is the fourth debt of this shape and it was worth not folding
into the third:

| | `PendingSave` | `OwedAreaEffect` |
|---|---|---|
| Presupposes | a condition or timer already on the target | nothing; the target may be untouched |
| What the roll does | releases an effect that is already running | applies the spell for the first time |
| On success | the effect ends on that creature | whatever the spell says — often half damage |
| Keyed by | the timer it belongs to | the casting and the creature |

Forcing Web's "save or be Restrained" into a shape that exists to let a
Restrained creature *stop* being Restrained would have inverted the rule.

**It holds facts and never behaviour** — a casting id, a creature and a moment.
No predicate, no callback, no copy of the spell: settlement looks the
definition up through the casting's own `spellId` and runs it at the level and
route the casting was made with, through the same machinery an ordinary
casting uses. There is no second save calculator and no second damage
resolver, and the caller supplies no DC, no roll and no outcome.

**Three facts and not a fourth.** It carried the turn it was raised on and
nothing ever read it: the once-per-turn caps are `state.areaTriggers`' business
and are stamped where the debt is raised, and settlement orders by the moment,
then the casting, then the target. A number on a debt that nothing reads is a
second place for a cap to be got wrong, which is precisely the distinction Web
and Insect Plague exist to keep apart.

**A list, not a keyed record**, which is the one place it differs from
`pendingSaves` in storage as well as meaning: a save is keyed by effect and
turn so that one boundary raises one of it, while Grease caps nothing and a
creature that walks in three times owes three.

### The two moments in one `turn-advanced` are a round apart

One event carries the finishing creature's end and the next creature's start,
and they are **not simultaneous**.

**Ordering the settlements is not enough**, and the first version of this made
exactly that mistake: it raised both sets of debts in the same fold and then
sorted them. Sorting settles them in order; it does not *determine* them in
order. Whether the next creature is caught at its start is a question about the
world the previous creature's end left behind — and that world does not exist
while the end is still owed.

So `turn-advanced` raises the end and records `pendingTurnStart`; a derived
pass reaches the start once nothing the end owed is outstanding, and raises the
start debts from *that* state. Derived rather than emitted for the usual
reason: nobody decides that a moment has arrived. A replay reconstructs both
because the fold does — the same log leaves the same debts outstanding at the
same points.

The common case passes straight through inside the fold of `turn-advanced`
itself, so a boundary that owes nothing behaves exactly as it always did and no
caller learns there were two moments. A caller with no generator can stop
between them: the end stays owed, the start has not happened, and the creature
whose turn it is may not act until both are settled.

Settlement still orders — end, then entry, then start — and re-reads the queue
on every pass rather than snapshotting it, because settling the end is what
brings the start about.

**The end of a turn belongs to the turn that is ending**, and `turnsTaken` has
already moved on by the time the reducer sees the event. Stamping the end with
the new number put a creature's entry and the end of the very turn it entered
on into two different turns, and Insect Plague's cap caught it twice.

**Settled before the Death Saving Throw**, deliberately. Both are "at the start
of your turn" and the SRD orders neither, but only one order leaves room for a
start-of-turn *heal* to matter — Aura of Life's shape — and an ordering that
makes a future rule unreachable is the wrong one to pick by accident.

### A spell already cast does not change when its caster does

`OngoingSpell` stored the *route* — a name — and every later use resolved it
against the caster's **current** sheet and derived the numbers again. A Cleric
who levelled between conjuring a Web and somebody walking into it moved the
save DC; so did an Ability Score Improvement, a new proficiency bonus, or
preparing the same spell through a second class.

So the numbers are pinned at the casting, and there are four of them rather
than a snapshot of the sheet:

| | Read by |
|---|---|
| `saveDc` | every save the spell calls for, and every escape check it offers |
| `attackModifier` | a later spell attack — Spiritual Weapon, Vampiric Touch, Flame Blade |
| `spellcastingModifier` | "plus your spellcasting ability modifier" on damage, healing and Temporary Hit Points |
| `casterLevel` | a cantrip's upgrade steps, read off the caster rather than off the slot |

What goes on being read live is everything about the creature it is happening
*to*, and everything about the caster that is genuinely current — a Bless on
them now applies now.

**A casting can outlive its caster, and the pinned numbers are why that works.**
SRD Grease runs its minute whether or not the wizard does, and a save it calls
for afterwards is still owed; forgiving it because the DC could not be
recovered would be the engine losing a rule to its own bookkeeping. What
genuinely cannot happen is an effect that throws dice *from a sheet that has
left*, so `resolveEffects` takes a nullable caster and is loud rather than
quiet about it. A saving throw needs no sheet, and every non-Concentration area
trigger in the book is a bare saving throw — asserted, not assumed. A
Concentration spell never reaches the question, because its caster leaving ends
it.

### A mandatory effect blocks everybody; an un-arrived start blocks one creature

`mayAct` is the one policy, called by every command that spends an Action, a
Bonus Action, movement, the turn's free object interaction or a feature's use:
Dash, Disengage, Dodge, Ready, feature activation and extension, the three pool
commands, an effect check, an attack, a move, a mount and a dismount, the free
interaction, a casting, an activation, and the turn.

**The list is derived, not recalled.** `invariants.test.ts` reads every module
under `commands/` and `rest.ts` — as one string, because the closure crosses
them — and computes the transitive closure of the **six** action-economy
primitives in `combat.ts` and the two events whose reducer takes a resource
away — `resource-spent` for a pool use, `spell-cast` for a slot.
`useFreeInteraction` is the sixth and was missing from the seeds until
something called it: a turn budget has six fields and it consumes one of them,
so a command spending it spends exactly as much as one spending a Bonus
Action. Every exported
declaration in that closure must either be run against a world owing a
mandatory area effect and be refused `area_effect_owed`, or appear on an
allowlist with the sentence that exempts it, and never both. A command added
without the guard is in neither list and fails there rather than in play, which
is what the third whole-engine audit (2026-09-13) found was not true: the only
test was a hand-written case list covering nine of sixteen spenders, and
`extendFeature` spent a Bonus Action with no guard at all.

The allowlist is nine: five Reactions, two settlements of a window the engine is
already holding open, `castSpell` — the low-level half beneath `resolveSpell`
that leaves the economy to its caller — and `endRest`. `resolveCast` was the
tenth and is guarded now; its exemption said in its own words that it was a
named debt, and a sweep that asserts the list in both directions is what made
discharging it a one-line deletion rather than a search.

`endRest` is an **open question rather than a decision**. A rest
is not an action in the turn economy — SRD spends no Action, Bonus Action or
Reaction on one, and the Hit Dice it spends are the rest's own payout rather
than something taken during a turn — but whether an outstanding area effect
should stop a creature ending a rest is a question neither the SRD nor this
engine has ever asked. It is written down where the next person to read the
list will meet it.

Both sweeps are driven over a synthetic sample they must catch, so the analysis
cannot quietly stop seeing anything, and every case is asserted twice — refused
with the debt outstanding, and *not* refused once it is settled, because a
fixture in which a command was never reachable would prove nothing.

**An owed area effect is global engine debt, and getting that wrong is
instructive.** It was per-creature for one commit, on the reasoning that a
goblin's unmade Web save says nothing about the wizard across the room. The
counterexample is three moves long and every move is an existing mechanic:

1. a Cleric concentrates on Hold Person, and a goblin is Paralyzed by it;
2. the Cleric is shoved into an Insect Plague and owes its damage;
3. a third creature attacks the goblin.

Settling step 2 can drop the Cleric, break the Concentration and free the
goblin — so step 3 is an attack against a creature who may already be free, and
that is not a small difference: Paralyzed within 5 feet is Advantage and an
automatic Critical Hit. **The engine does not work out which actions happen to
be independent**, because it does not need to: settle the mandatory mechanical
fact first. That is exactly why `pendingDamage`, `pendingTest` and
`pendingSaves` are global, and this belongs with them.

**A turn whose start has not arrived stays per-creature**, and the difference
is that *nothing has been raised yet*: what is unresolved is whether this
creature is about to be caught, and their budget has already refreshed. No
mechanic makes that anybody else's problem, and no evidence says otherwise.

**Reactions are not routed through either**, nor is `settleAreaEffects`, nor
are the commands that close a window somebody else opened. A guard that refused
its own settlement would be a deadlock wearing a rule's clothes.

**After the duplicate check, never before it** — the sixth instance of that trap
in this file. A retry arrives at the debt its own first run raised.

### Causing a condition and owning it are two different links

The engine had one mechanism for both: the casting id inside the condition's
source. That is right for every condition a spell *sustains* — Hold Person's
Paralyzed "for the duration", Web's Restrained "while in the webs", Black
Tentacles' "until the spell ends". SRD Grease sustains nothing: "or have the
Prone condition", and Prone ends when the creature stands up.

So the casting ending was lifting a condition the book leaves standing, and a
Dispel Magic aimed at a greased creature stood them up. `outlivesCasting` on the
effect records the condition under the spell's **bare name**: the log still says
what caused it, the casting's cleanup walks past it, and the casting is not
*on* the creature.

That last part made the two halves of `on` agree at last. **A casting is on a
creature while it has a live effect there that the casting owns** — the rule
`alsoOn` already applied when a triggered effect landed a minute later, now
applied at the cast as well. Damage alone is not being on somebody: the swarm
bit you and is carrying nothing of yours.

### Entering is a position that actually changed

Raised from `creature-moved`, `mounted` and `dismounted` — never from a
declared move. A declaration is an intent an Opportunity Attack can end, and
raising there would charge a creature for walking into a Web it never reached.

**Every creature whose position changed, not the one the event names.**
`moveCreature` carries riders with their mount, so a rider crosses into a Web
with no event mentioning them at all. Reading `event.id` is a bug only a
mounted fixture catches.

**Placement is not entry, and that is structural.** A creature being put into
the scene is not in the previous scene's positions at all, so it has no outside
to have come from and the diff cannot fire for it. There is no guard saying so
because there is nothing to guard: a mutation that calls the detector from
`creature-placed` changes no behaviour. The same goes for an unplaced creature,
which is in no area.

**Settlement is its own command**, and the reason is `declineOpportunity`: it
completes somebody else's declared move and has no generator to roll a save
with. A debt only the moving command could settle would wedge the fight on
exactly that path.

### What it cannot see, stated rather than guessed

**The path.** Movement records where a move started and where it ended and
nothing in between, so a creature that walks clean across a Web and out the
far side transitions outside → outside and nothing fires. Inferring the
crossing from a straight line between the endpoints would be the engine
inventing a route nobody took. SRD lets a creature break its movement into
segments and each segment is a move this *does* see, which is the operational
answer until movement records a path — and it is why Spike Growth ("2d4 for
every 5 feet it travels") is not attempted at all.

**Outside combat nothing is capped.** There is no turn to be once-per, so every
entry fires — the reading the one-slot-per-turn rule and every once-per-turn
feature already take, preserved rather than invented.

### `OngoingSpell.on` grows, and now it shrinks as well

SRD Dispel Magic ends "any ongoing spell ... **on the target**", and `on` was
written once, at the resolution, because that was the only moment a casting
could reach anybody. A persistent area breaks that: Web restrains a creature
that walks in a minute later, and a Dispel Magic aimed at *them* has to find
it.

So `on` grows, derived, on the link every other cleanup already uses: **a
casting is on a creature while it has a live effect there that the casting
owns.** Deliberately not "everyone the area has ever touched" — a creature
Insect Plague damaged carries nothing of the swarm's, so the swarm is not on
them.

**The asymmetry is closed: `expireEffects` shrinks it.** When a condition
instance lapses on its own deadline, the casting stops being on that creature —
**if that was the last thing it owned there**. One rule read in both
directions, rather than a list that only ever grew: a stale name in `on` let a
creature dispel a spell that was no longer on them. The "last thing" test is
the same four links `releaseCasting` walks — the conditions, the bonuses, the
Armour Class and the roll modifiers — asked of one creature, so a Hold Person
still holding somebody stays on them whatever else lapsed. Scheduled damage is
deliberately not one of them: a hit still owed is the casting's debt, not
something it is doing to the creature, which is the same reading that keeps a
creature Insect Plague merely damaged off the list.

**No executed spell reaches it yet**, and that is worth writing down rather
than dressing a fixture up as one. A condition needs a deadline *of its own*,
and the three definitions that give one — Ray of Sickness, Color Spray,
Sunbeam — are Instantaneous twice over and Range: Self the third time, so the
first two leave no record and the third is on its caster. The test drives it
through `applyConditionTo`, which has taken a per-condition `Duration` since
durations landed and carries the casting in its source like every linked
effect.

**Web's Restrained is not the case this reaches, and is worse than it.** It is
not independently timed — it hangs on the casting's own deadline, so the
casting's timer ends first and takes it along. And what the SRD actually gives
it is "while in the webs": a condition that ends when its holder walks *out of
an area* has no shape here at all, so it runs until the casting ends or the
creature breaks free, and the definition says so in `unmodelled`.

**One finding worth carrying:** Grease's Prone is linked to its casting, so the
engine lifts it when the Grease ends. SRD leaves Prone standing until the
creature gets up. That was true before this batch and `on` growing makes it
reach further; it is a fix to Grease's definition, not to `on`.

#### And it cannot be derived from that rule alone, which is a measurement

`on` is a **stored derivation kept in step by three passes** — written at the
cast, grown by `alsoOn`, shrunk by `expireEffects`, edited by `withoutTarget` —
and that is the shape this file keeps finding wrong. The rule is one sentence
and `holdsNothingOf` already computes it, so replacing the three passes with a
question asked of the world reads like the obvious move.

**It is not, and `derived-on.test.ts` is the gate that says so.** Written
before anything was removed, which is the whole of why the answer is worth
anything: it folds a log one event at a time and compares the stored value
against the derivation at every live record.

| | |
|---|---|
| `golden-log-2.json` | **869 checkpoints, 0 mismatches** |
| `golden-log.json` | **0 checkpoints** — it predates the record and holds none |
| the suite, with the comparison wired into `applyEvent` | **disagreements, in two populations** |

The second row is why the first is not evidence on its own, and it is pinned
rather than left as a green tick beside its neighbour: two passing assertions
there are one piece of evidence, not two.

**No count is given for the third row, and that is deliberate.** It was one
instrumented run of a probe that is not in the tree, so a digit here would be a
number nothing regenerates — this file's own most-repeated finding — and it
would be worse than merely stale: the two subsets below are counted under
*different* derivations, so they do not add up to anything. What is durable is
the **shapes**, and those are three fixtures in `derived-on.test.ts` rather
than a total.

**Two populations disagree, and they pull in opposite directions.**

| | What the stored value says | What the rule alone says |
|---|---|---|
| A **tracked** spell cast at a creature — Darkvision, Fly, Tongues, Jump, Message, Spider Climb, Water Walk, Water Breathing, True Seeing, Telepathic Bond, Nondetection | on them, which is how Darkvision stays dispellable | **nobody** — it resolves nothing, so it owns nothing there, for ever |
| A target the casting was **released on** — Bless, Hold Person, Black Tentacles, Charm Person, Suggestion, Hypnotic Pattern, Stoneskin, Sunbeam | gone | gone — and a derivation seeded from the *cast-time* list, which is what would rescue the row above, puts them back |

So neither reading is available: the cast-time list is necessary for the first
row and wrong for the second. **What separates them is a fact nothing in state
holds** — whether the casting has *ever* owned anything on that creature — and
recovering it means either a second field on the record or a different value
written at the cast, both of which change what `spell-ongoing` carries and need
a compatibility story for two frozen logs. That is a decision rather than an
implementation detail, so the removal stopped here.

**And the gate found the bug it was written to prevent, already live.**
`expireEffects` shrinks `on` in its **condition** branch and in no other — so a
`grants` deadline arriving takes the Resistance off the creature and leaves the
casting claiming to be on them. `holdsNothingOf` says otherwise in the same
breath, and `ongoingSpellsOn` reports a Stoneskin that a Dispel Magic aimed at
that fighter would then end. It is the same stale name this section says the
shrink exists to remove, arriving through the fourth `EffectTarget` member,
which was built after the shrink was written and threaded into none of it.

**It is latent, and saying so is the difference between a finding and an
alarm.** A `grants` timer has exactly one runtime writer — the `speed-change`
rider's own `lasts`, scheduled beside the grant — and the only definition in
the catalogue that writes one is Ray of Frost, a **cantrip**, whose casting is
over the instant it resolves and which therefore leaves no ongoing record for
a name to go stale in. So no registered spell can reach it today and the
fixture hand-writes the `effect-scheduled`. What makes it worth recording is
that the next `speed-change` rider on a spell that *does* run — or any second
writer of a `grants` deadline — arrives into a shrink that cannot see it.

It is **characterised rather than corrected**, because the correction changes
what the Dispel readers answer and which mechanism should own that answer is
the question the measurement has opened. What the test asserts is the
*disagreement* — two parts of the engine giving different answers to one
question — rather than either answer being right.

### A test that passes for the wrong reason is what mutation testing is for

"A move that never leaves the area" passed against a *mutation that should have
broken it*, because the landmark it walked to was outside Grease's Cube —
Grease is a **10-foot** square and Web a 20-foot one, and a spot chosen for the
larger left the smaller. The assertion was right, the fixture was wrong, and
nothing but a deliberate break could have said so.

**And a fixture that enumerates what the runtime derives will drift.**
`spell-catalogue.test.ts` decided whether to drive a spell in combat by listing
the effect kinds that can carry a turn-anchored rider — `save`, `attack`,
`save-damage` — where `riderDurations` is the derivation the command layer
already uses to answer the same question. It had missed `condition`, which has
carried a rider since the standalone kind landed, so a definition of that shape
with a turn-anchored rider would have been driven *outside* combat and refused
for a reason belonging to the fixture rather than to the spell. The list is the
derivation now. Nothing was wrong in the catalogue; the next definition is what
it would have been wrong about.

## An Area Can Arrive At A Creature Standing Still

SRD Moonbeam writes three trigger clauses in one sentence, and the first is
not a way of saying the other two:

> "A creature also makes this save **when the spell's area moves into its
> space** and when it enters the spell's area or ends its turn there. A
> creature makes this save only once per turn."

| | SRD wording | The authoritative operation |
|---|---|---|
| **A turn boundary** | "ends its turn there" | `turn-advanced` |
| **A creature entering** | "enters the spell's area" | the creature's own position change |
| **An area arriving** | "the spell's area moves into its space" | the **area's** position change |

Cloudkill, Incendiary Cloud and Spirit Guardians print the same pair; Insect
Plague, Web, Grease and Black Tentacles print no such clause and their areas
never move. **A neighbouring spell's moving-area sentence lends a fixed area
nothing**, so the clause is a field on the trigger, checked against the spell's
own prose out of the parsed book.

### The operation says what changed; nothing asks whether membership did

`creature-moved` means a creature's membership may have changed;
`spell-origin-moved` means *this casting's area* moved. Two detectors, each
answering the operation that raised it. The weaker question — "did membership
change somehow" — would pass every test in both files and would have erased
the distinction the book drew, which is observable in two places: the caps can
differ, and the log has to say which clause caught somebody.

**The event needed no extension at all.** One casting had one point, and now
that point is somewhere else — which is what `spell-origin-moved` already
said. The detector hangs off its reducer case, derived like every other
consequence, so a replay reconstructs both the point and the debt.

### `area-moved` is a fourth moment, not a fourth cause of `entry`

`entry` is deliberately one value for walking in, being shoved in and being
carried in by a mount, because the SRD writes one clause for all three. An
area arriving is a *different clause*, and two things follow that a shared
value gets wrong:

- **The entry cap must not be spent by it.** `onEntry: 'first-per-turn'` is
  Web's cap on *entering*, and a beam sliding onto a creature standing still
  is not that creature's first entry of the turn. So the stamp field is
  `byCreatureEntry` — named for the cause, because the shorter `byEntry` read
  as true of both — and an area's arrival never sets it.
- **The history must say which happened.** "You walked into the beam" and
  "the beam swept over you" are different answers to why a creature is hurt.

No registered spell prints both clauses today, which is exactly when the narrow
reading is cheap to write down and impossible to reconstruct later. What the
two *share* is the consequence: one `OwedAreaEffect`, one queue, one
settlement, no second save calculator.

### The movement allowance is the action, not a rider on one

Two SRD sentences, two fields, and collapsing them would make a movement-only
action indistinguishable from a rider that was declined:

| | SRD | Field |
|---|---|---|
| Spiritual Weapon | "move the force up to 20 feet **and** repeat the attack" | `CastingOrigin.movableBy` |
| Moonbeam | "take a **Magic action** ... to move the Cylinder up to 60 feet" | `SpellActivation.movesArea` |

So Moonbeam's activation carries no range, no effects and no targets, and a
caller who names a destination is required rather than optional — a Magic
action spent moving nothing is not something the spell offers. Giving it a
`CastingOrigin.reach` instead would have been inventing a distance the book
never prints, purely to make it fit the other spell's shape.

**Range is where an area may first be put; the allowance is how far it then
travels.** Moonbeam reaches 120 feet and moves 60, from wherever the beam now
is — so a beam walked steadily away ends up further from its caster than the
spell's Range, and re-checking against the caster would wrongly forbid it.

### Two points do not imply the line between them

**This is the part that could not be hand-waved.** A beam that steps twenty
feet passes over the space in between by any route a person would draw, and
the engine has no route: Chebyshev distance says how far an origin moved, never
which way it went. Drawing a straight line would be the same invention
`raiseAreaEntries` already refuses about a creature's own movement, and a
displacement is in any case only a *lower bound* on the distance travelled.

So the route is the caller's to state. `ActivateSpellCommand.via` carries the
spaces the area passed through, each consecutive pair is one authoritative
relocation with its own `spell-origin-moved`, and the allowance caps the **sum
of the legs** — which is what "up to 60 feet" measures, so a beam walked round
three sides of a square has spent all three. With no waypoints there is one
leg and the sum is the displacement, so every existing caller is untouched.

A leg one space long has nothing in between to be unknown. **Any longer leg is
a question**, and asking is the third option that the two obvious ones hide:
draw a line nobody drew, execute the move while silently skipping whoever it
crossed, or go and get the fact. The first two are the same failure in
different clothes.

So a coarse leg comes back as `needs-context` with a `route` request, and
nothing is spent — no action, no die, no debt, no movement. Only where a rule
reads the route: a casting whose area triggers on nothing as it travels has no
route to be wrong about, which is every Spiritual Weapon, and giving it the
requirement because Moonbeam has it would be a neighbouring spell's clause
lending it a rule again.

Not a path *finder*. Nothing searches, smooths, or checks that consecutive
waypoints are adjacent: a waypoint is a fact the caller supplies. Spike
Growth's "2d4 for every 5 feet **it travels**" is a creature's distance and a
different primitive, and is still not attempted.

### `via` is adjudicated, and asking for it is not a refusal

A player says "move the beam onto the ogre". Which way it goes — through the
other two ogres, around the paladin, straight there — is judgement about intent
and fiction, and **Maestro owns it**, because Maestro is the layer that reads
the fiction. The engine validates the route and never chooses it: the same
boundary `eligibleTargets` draws for targeting, where the shortlist is a
shortlist and never a substitution.

| | |
|---|---|
| Maestro decides | which spaces the area passes through, whether to sweep through enemies, whether to keep off allies, what the player's words already settled |
| The engine decides | that every waypoint is on the lattice and in the scene, that the legs add up to the allowance, who the area arrives on, and what that costs them |

**The engine is blind to sides, deliberately.** A route that catches the
caster's own party catches them, because that is the route it was given.
Sparing allies would be the engine overriding the command it was sent, which is
the targeting failure in another costume.

`route` is a new `ContextRequest.kind` and the odd one in that union: every
other kind is satisfied by *declaring a fact* through a command of its own, and
this one by *re-sending the same command with a field filled in*. `satisfyWith`
says which, as it does for all of them.

**Never describe this as the engine rejecting a turn.** Nothing here reaches a
player. It is the collaboration boundary the whole `needs-context` channel
exists to be: the engine refuses to invent the missing fact, Maestro supplies
the judgement, the engine resumes the action the player meant.

### A route settles as the area reaches each space, not once it is over

SRD Moonbeam: a creature makes the save "when the spell's area moves into its
space" — at that point in the route. That is not a nicety, and the case that
proves it is three moves long:

1. the druid is concentrating on Moonbeam and sweeps it onto their own space;
2. the save lands, the damage lands, the Concentration save fails;
3. Moonbeam ends — so the waypoints after that **never happen**.

An implementation that emitted every leg and settled afterwards gives the same
answers right up until a consequence changes what the rest of the route may do,
and then gives the wrong one silently. So each leg is moved, settled, and only
then followed by the next: `spell-origin-moved`, the `area-effect-settled` it
caused, the next `spell-origin-moved`. The settlement is `settleAreaEffects` —
the same command a turn boundary and a creature's own move already use, reached
with the generator the action already holds, so there is no second resolver and
no caller-supplied save, DC, damage or Concentration decision.

**A casting that ends mid-route is a successful action, not an invalid one.**
Nothing is rolled back: the action was spent, the beam moved, and what it did
to the caster is why there is nothing left to move. The command returns the
events that actually occurred, and its identity is recorded so a retry reruns
neither the movement nor the damage.

**That moved `spell-activated` above its own content.** It used to be written
after the movement; an event saying the caster took the spell's later action,
written after the casting it names has gone, is the log arriving in the wrong
order. The stamp still rides on it, because it still always happens.

**And it sharpened the duplicate check once more.** A retry of a route that
ended its own casting finds no such casting — so a `not_ongoing` refusal above
the duplicate check would tell a caller their command was impossible when it
had in fact succeeded. Seventh instance in this file; same shape every time.

### Creation is not movement

A casting's first record says where its area is and raises nothing: the
creatures standing there are caught by "when the Cylinder appears", which is
the casting's own effect. Only a move of an area that already exists reaches
the detector, and that is structural rather than guarded — `spell-origin-moved`
throws for a casting that holds no point.

### One action is one move, which is why the same-turn repeat lives in a route

The caster has one Magic action a turn, so a beam cannot be swung twice by two
activations without a turn passing between them — and the cap is per turn. The
creature that *can* meet two clauses inside one global turn is therefore the
caster itself: it moves the beam onto itself, and then its own turn ends with
it still standing in it. A stated route is the other case, because a route may
arrive on a creature, leave, and arrive again.

**A beam that drops its own caster's Concentration ends the spell**, and a
fixture that lets that happen goes on asserting things about a Moonbeam that is
no longer there. Half damage on a made save is still damage, and is what those
tests read instead.

## An Area Can Be Carried, And Then Its Origin Is Not A Point

SRD's glossary settles this in one sentence, and it is not a Spirit Guardians
rule but the definition of the shape:

> "An Emanation **moves with the creature or object that is its origin** unless
> it is an instantaneous or a stationary effect."

So a casting's area sits at a point *or* on a creature, and which it is was
decided at the casting by the definition:

| | `area.origin` | Read from | Spells |
|---|---|---|---|
| A point the casting keeps | `point` | `record.origin` | Web, Grease, Insect Plague, Black Tentacles, Moonbeam |
| The caster, wherever they now are | `self` | `record.caster` | Spirit Guardians |

**`OngoingSpell` needed no new field for this**, and that is the finding. Both
facts were already there: the definition says `origin: 'self'`, the record says
who cast it, and `creaturesInArea` has taken `{ creature }` since positioning
landed. A copied point would have been a second answer to "where is the aura",
kept in step by remembering to update it — and the first operation that moved
the caster by a route that forgot would leave the aura frozen where it was.
Deriving it is not an optimisation; it is the difference between one fact and
two facts that can disagree.

The same reading is what makes a carrier who *leaves* behave correctly: an
Emanation whose origin creature has no position catches nobody, rather than
hanging in the air at the last place they stood.

**An Emanation measures from the whole carrier and excludes it.** Both were
already true of `creaturesInArea` and both are load-bearing here: a Huge
carrier's 15-foot Emanation reaches 30 feet from the anchor where a Medium
carrier's reaches 15, and a cleric is never hurt by the spirits they are
carrying.

### A carrier walking is the area arriving, not the creature entering

One authoritative fact — a creature's position changed — and two rules read it,
because the SRD writes two clauses in one sentence: "whenever the **Emanation
enters a creature's space** and whenever **a creature enters the Emanation**".

| | Whose position changed | Who is caught | Moment |
|---|---|---|---|
| `raiseAreaEntries` | the creature that is caught | creatures that moved | `entry` |
| `raiseCarriedArrivals` | the **carrier** | creatures that did **not** move | `area-moved` |

A creature that moved has entered; a creature that stood still has been entered
upon. Asking the weaker question — "did membership change somehow" — would pass
every test in both files and erase the distinction the book drew, and the two
clauses can be capped differently.

**The carrier is whoever actually moved, never whoever the event names.**
`moveCreature` carries riders with their mount, so a cleric on a horse takes
their aura with them on an event that mentions only the horse. Reading
`event.id` is a bug only a mounted fixture catches — the same lesson the
creature-side detector already learned, arriving a second time.

### The carrier's route is the same question, from the other side

Moonbeam asks to move an *area* thirty feet; a carrier asks to move a
*creature*, and the area comes along. Either way the engine holds two endpoints
and no route, and either way the creatures who would be caught are the ones who
did nothing. So the answer is the same answer: a move of more than one space
comes back as `needs-context` with a `route` request naming the casting, the
carrier, both ends and what to send instead.

**It reuses movement rather than adding a route field**, and that is deliberate.
A creature move is already authoritative, already segmentable, and the global
area-debt guard already stops the next voluntary action until what a step
raised has been settled — so a Maestro-adjudicated sequence of five-foot steps
already settles as it goes. A `MovePath` here would have been a second
mechanism for something movement can express, built for symmetry with Moonbeam
rather than because a rule asked for it.

### Two clauses the geometry must not quietly absorb

**Designating creatures unaffected is a choice, and never allegiance.** SRD:
"When you cast this spell, you can designate creatures to be unaffected by it."
Alarm prints the same shape, which is what makes it a transcribed clause rather
than a general area filter. It is chosen once and kept, so it outlives every
later move; it is filtered inside `creaturesInCastingArea`, so the one decision
reaches every sentence that reads the area; and it is **explicit**, because a
cleric may spare an enemy and may decline to spare an ally. Substituting `side`
would be the engine answering the question the caster was asked.

**A damage type the SRD decides on a fact the engine does not hold is stated,
not guessed.** "3d8 Radiant damage (if you are good or neutral) or 3d8 Necrotic
damage (if you are evil)." Alignment is held for a character the engine built
from choices and for nobody else — not a monster, not a declared NPC — and
side, class and deity are none of them alignment. So the casting states which,
the engine refuses anything the spell does not print, and the answer is pinned
on the casting exactly as the save DC is. Picking Radiant because most clerics
are good is where a Necrotic-immune Undead finds the engine out. This is the
discipline declared cover and declared sight already follow, and it is **not**
an alignment system: building one needs a second user.

### Coverage needed a third word

`verified` says a test drives the spell end to end; `untested` says nothing
does. **Neither word says whether the spell finishes**, and Spirit Guardians is
where that stopped being a distinction nobody needed: its Emanation, three
clauses, cap, save and damage all run under a suite of their own, and the
**halved Speed inside the Emanation** is a rule the engine owns and has not
written. That is a standing spatial effect rather than a trigger: it wants a
Speed derived from where a creature is standing, and mutating a base Speed on
entry and exit would be correct only while every enter and leave paired up
perfectly.

So `PARTIAL_SPELLS` is the third state, and a spell listed there must say in
`unmodelled` what it is missing — otherwise it becomes the place claims come to
be quietly parked. Same move the adjudication map made when `table` and a
missing shape could not express `engine`. It is not kept by hand at all: the
list *is* the spells with a clause adjudicated to a missing shape — see "The
same guard, pointed at the spells the engine executes" — and Spirit Guardians
turned out to have a great many companions. **How many is `COVERAGE.md`'s**,
which regenerates; this sentence said fifty-two and was wrong by five before
anybody noticed, which is the argument for not writing a digit here.

## Combat Model

**The zone graph described here was never built.** The plan was a
`Zone { id, name, adjacent[], cover, terrain }` graph with ranges resolving as
bands — same zone melee, adjacent ~30ft, two hops 60ft+ — and this section said
so for long enough that `ZoneId` survived in `ids.ts` as its only trace. It has
been removed; this note replaces it so the next reader does not go looking.

What shipped instead is **a lattice of 5-foot cubes with Chebyshev distance**,
and it is documented at length under "Positioning: Coordinates, Authored But
Never Defaulted". Zones were abandoned because the thing they were meant to
avoid — geometry — turned out to be the cheap part, while the thing they forced
was expensive: every area of effect becomes a judgement about which zone it
catches, and "does Fireball get two goblins or three" is the most consequential
positional call in the game. Exactness is cheap where the answer is arithmetic.

**The boundary the original note was protecting still holds**, and it is worth
keeping in those words: resist scope creep toward a VTT. The lattice is an
internal representation, nothing is rendered, Maestro speaks in feet from
landmarks, and cover and line of sight stay *declared* rather than ray-cast —
because computing them needs walls, and walls are where a rules engine becomes
a map editor. Rendering a battlemap later is a presentation change, not an
engine change.
